import {
  Agent as HttpAgent,
  createServer as createHttpServer,
  request as createHttpRequest,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { Agent as HttpsAgent, request as createHttpsRequest } from "node:https";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";

import {
  SIDECAR_ENV,
  SIDECAR_MESSAGES,
  normalizeWebSidecarMessage,
  type SidecarStamp,
  type WebStatusSnapshot,
} from "@open-design/sidecar-proto";
import {
  createJsonIpcServer,
  type JsonIpcServerHandle,
  type SidecarRuntimeContext,
} from "@open-design/sidecar";

const HOST = process.env.OD_HOST || "127.0.0.1";
if (process.env.OD_HOST != null && !/^[a-zA-Z0-9._\-:[\]@]+$/.test(process.env.OD_HOST)) {
  throw new Error(`OD_HOST contains invalid characters: ${process.env.OD_HOST}`);
}
const DAEMON_HOST = "127.0.0.1";
const DAEMON_PORT_ENV = SIDECAR_ENV.DAEMON_PORT;
const WEB_DIST_DIR_ENV = SIDECAR_ENV.WEB_DIST_DIR;
const WEB_PORT_ENV = SIDECAR_ENV.WEB_PORT;
const TOOLS_DEV_PARENT_PID_ENV = SIDECAR_ENV.TOOLS_DEV_PARENT_PID;
const DAEMON_PROXY_UNAVAILABLE_MESSAGE =
  `connect ECONNREFUSED (${DAEMON_PORT_ENV} is not set; the web runtime has no daemon origin)`;
const SHUTDOWN_TIMEOUT_MS = 3000;

export type WebSidecarHandle = {
  status(): Promise<WebStatusSnapshot>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
};

function resolveWebRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const packageJson = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { name?: unknown };
      if (packageJson.name === "@open-design/web") return current;
    } catch {
      // Keep walking until the package root is found. This must work from both
      // sidecar/*.ts under tsx and dist/sidecar/*.js in packaged installs.
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error("failed to resolve @open-design/web package root");
}

function parsePort(value: string | undefined): number {
  if (value == null || value.trim().length === 0) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`${WEB_PORT_ENV} must be an integer between 0 and 65535`);
  }
  return port;
}

function resolveWebStaticDir(webRoot: string): string {
  const configured = process.env[WEB_DIST_DIR_ENV];
  if (configured == null || configured.trim().length === 0) return join(webRoot, "dist", "web");
  return isAbsolute(configured) ? configured : join(webRoot, configured);
}

function resolveDaemonOrigin(): string | null {
  const port = parsePort(process.env[DAEMON_PORT_ENV]);
  if (port === 0) {
    console.warn(
      `[open-design web] ${DAEMON_PORT_ENV} is not set; /api, /artifacts and /frames will answer ${DAEMON_PROXY_UNAVAILABLE_MESSAGE}`,
    );
    return null;
  }
  return `http://${DAEMON_HOST}:${port}`;
}

function resolveRequestPathname(requestUrl: string | undefined): string | null {
  if (requestUrl == null) return null;

  try {
    return new URL(requestUrl, `http://${HOST}`).pathname;
  } catch {
    return null;
  }
}

function isDaemonProxyPathname(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/artifacts" ||
    pathname.startsWith("/artifacts/") ||
    pathname === "/frames" ||
    pathname.startsWith("/frames/")
  );
}

export function resolveDaemonProxyTarget(
  daemonOrigin: string,
  requestUrl: string | undefined,
): URL | null {
  const target = resolveHttpProxyTarget(daemonOrigin, requestUrl);
  if (target == null || !isDaemonProxyPathname(target.pathname)) return null;
  return target;
}

function resolveHttpProxyTarget(
  origin: string,
  requestUrl: string | undefined,
): URL | null {
  if (requestUrl == null) return null;

  let parsedRequestUrl: URL;
  try {
    parsedRequestUrl = new URL(requestUrl, `http://${HOST}`);
  } catch {
    return null;
  }

  return new URL(`${parsedRequestUrl.pathname}${parsedRequestUrl.search}`, origin);
}

export function normalizeDaemonProxyOriginHeader(options: {
  daemonOrigin: string;
  origin: string | undefined;
  requestHost?: string | string[];
  webPort: number;
}): string | undefined {
  if (options.origin == null || options.origin.length === 0) return options.origin;

  const schemes = ["http", "https"];
  const loopbackHosts = ["127.0.0.1", "localhost", "[::1]", HOST];
  const allowedWebOrigins = new Set(
    schemes.flatMap((scheme) => loopbackHosts.map((host) => `${scheme}://${host}:${options.webPort}`)),
  );

  if (allowedWebOrigins.has(options.origin)) return options.daemonOrigin;

  const parsedOrigin = parseHttpOrigin(options.origin);
  if (
    parsedOrigin != null &&
    isSameBrowserHostOrigin({
      origin: parsedOrigin,
      requestHost: options.requestHost,
      webPort: options.webPort,
    })
  ) {
    return options.daemonOrigin;
  }

  return options.origin;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseHostHeader(value: string | string[] | undefined): URL | null {
  const raw = firstHeaderValue(value)?.trim();
  if (raw == null || raw.length === 0) return null;
  try {
    return new URL(`http://${raw}`);
  } catch {
    return null;
  }
}

function parseHttpOrigin(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function parseAllowedDevHost(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${trimmed}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

function configuredAllowedDevHosts(): Set<string> {
  return new Set(
    (process.env.OD_ALLOWED_DEV_ORIGINS ?? "")
      .split(",")
      .map(parseAllowedDevHost)
      .filter((host): host is string => host != null),
  );
}

function isAllowedDevHost(hostname: string, allowedHosts: Set<string>): boolean {
  const host = hostname.toLowerCase();
  if (allowedHosts.has(host)) return true;

  for (const allowedHost of allowedHosts) {
    if (!allowedHost.startsWith("*.")) continue;
    const suffix = allowedHost.slice(1);
    if (host.endsWith(suffix) && host.length > suffix.length) return true;
  }

  return false;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  const octets = parts.map((part) => Number(part));
  if (!octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) return null;
  return octets as [number, number, number, number];
}

function isPrivateLanIpv4(value: string): boolean {
  const octets = parseIpv4(value);
  if (octets == null) return false;
  const [a, b] = octets;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isLoopbackOrPrivateLanHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0" ||
    host === "::" ||
    isPrivateLanIpv4(host)
  );
}

function defaultPortForProtocol(protocol: string): string {
  return protocol === "https:" ? "443" : "80";
}

function isSameBrowserHostOrigin(options: {
  origin: URL;
  requestHost?: string | string[];
  webPort: number;
}): boolean {
  const requestHost = parseHostHeader(options.requestHost);
  if (requestHost == null) return false;

  const originPort = options.origin.port || defaultPortForProtocol(options.origin.protocol);
  const requestPort = requestHost.port || "80";
  if (originPort !== String(options.webPort) || requestPort !== originPort) return false;
  if (requestHost.hostname.toLowerCase() !== options.origin.hostname.toLowerCase()) return false;

  const allowedDevHosts = configuredAllowedDevHosts();
  const originHost = options.origin.hostname.toLowerCase();
  return isLoopbackOrPrivateLanHost(originHost) || isAllowedDevHost(originHost, allowedDevHosts);
}

/**
 * Explicit keep-alive pool for proxied upstream requests.
 *
 * Invariant: a pooled idle socket must be destroyed strictly before either
 * upstream's server-side keep-alive window can close it — the daemon holds
 * kept-alive sockets for 120s (`apps/daemon/src/server.ts`) while a proxied
 * development backend can use a shorter default — so the proxy should not
 * pick up an idle socket its upstream is concurrently closing. On a keep-alive Agent the
 * `timeout` option destroys pooled sockets after that idle period; sockets
 * with an in-flight request only emit an (unobserved) `timeout` event, so
 * long-lived streams such as SSE are unaffected.
 */
const PROXY_FREE_SOCKET_IDLE_MS = 3_000;
const proxyHttpAgent = new HttpAgent({
  keepAlive: true,
  scheduling: "lifo",
  timeout: PROXY_FREE_SOCKET_IDLE_MS,
});
const proxyHttpsAgent = new HttpsAgent({
  keepAlive: true,
  scheduling: "lifo",
  timeout: PROXY_FREE_SOCKET_IDLE_MS,
});

/**
 * Requests whose body is fully buffered under this cap AND whose method is
 * idempotent may be replayed once after a reused-socket connection reset.
 * Larger bodies and non-idempotent methods keep the streaming pass-through
 * path and are never replayed.
 */
const PROXY_REPLAY_BODY_LIMIT_BYTES = 512 * 1024;
const IDEMPOTENT_PROXY_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

type ProxyRequestBody =
  | { replayable: true; body: Buffer }
  | { replayable: false; prefix: Buffer[]; stream: IncomingMessage };

function captureProxyRequestBody(request: IncomingMessage): Promise<ProxyRequestBody> {
  const method = (request.method ?? "GET").toUpperCase();
  if (!IDEMPOTENT_PROXY_METHODS.has(method)) {
    return Promise.resolve({ replayable: false, prefix: [], stream: request });
  }
  return new Promise((resolveBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (body: ProxyRequestBody) => {
      if (settled) return;
      settled = true;
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("close", onError);
      resolveBody(body);
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > PROXY_REPLAY_BODY_LIMIT_BYTES) {
        request.pause();
        settle({ replayable: false, prefix: [...chunks], stream: request });
      }
    };
    const onEnd = () => settle({ replayable: true, body: Buffer.concat(chunks) });
    // A client that aborts mid-body gets the same truncated-stream behavior
    // as the previous pipe-through implementation (and is never replayed).
    const onError = () => settle({ replayable: false, prefix: [...chunks], stream: request });
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    // A disconnect can surface as a bare "close" with neither "end" nor
    // "error"; "end" always fires first on complete bodies, so this only
    // catches genuinely truncated requests.
    request.on("close", onError);
  });
}

/**
 * The daemon can close a kept-alive socket at the same moment the proxy
 * reuses it (keep-alive window expiry, restart) — the write then fails with a
 * connection reset and, before this guard, surfaced to the browser as a 502
 * the daemon never sent. Replaying is safe exactly when the request is
 * idempotent with a fully buffered body, no response bytes have arrived, and
 * the failed attempt ran on a REUSED pooled socket; the retry takes a fresh
 * connection so it cannot hit another stale pool entry.
 */
function shouldReplayProxyRequest(input: {
  attempt: number;
  body: ProxyRequestBody;
  error: unknown;
  reusedSocket: boolean;
  response: ServerResponse;
}): boolean {
  if (input.attempt > 0 || !input.body.replayable) return false;
  if (input.response.headersSent || !input.reusedSocket) return false;
  const code = input.error instanceof Error
    ? (input.error as NodeJS.ErrnoException).code
    : undefined;
  return code === "ECONNRESET" || code === "EPIPE";
}

async function proxyHttpRequest(
  target: URL,
  request: IncomingMessage,
  response: ServerResponse,
  options: { daemonWebPort?: number } = {},
): Promise<void> {
  const secure = target.protocol === "https:";
  const proxyRequestFactory = secure ? createHttpsRequest : createHttpRequest;
  const headers = { ...request.headers, host: target.host };
  if (options.daemonWebPort != null) {
    const origin = normalizeDaemonProxyOriginHeader({
      daemonOrigin: target.origin,
      origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
      requestHost: request.headers.host,
      webPort: options.daemonWebPort,
    });
    if (origin == null || origin.length === 0) {
      delete headers.origin;
    } else {
      headers.origin = origin;
    }
  }

  const body = await captureProxyRequestBody(request);

  await new Promise<void>((resolveProxy) => {
    const sendAttempt = (attempt: number): void => {
      const proxyRequest = proxyRequestFactory(
        target,
        {
          headers,
          method: request.method,
          // The replay must prove the failure was a stale pooled socket, so
          // it bypasses the pool and dials a fresh connection.
          agent: attempt === 0 ? (secure ? proxyHttpsAgent : proxyHttpAgent) : false,
        },
        (proxyResponse) => {
          response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
          proxyResponse.pipe(response);
          proxyResponse.on("end", resolveProxy);
        },
      );

      proxyRequest.on("error", (error) => {
        if (
          shouldReplayProxyRequest({
            attempt,
            body,
            error,
            reusedSocket: proxyRequest.reusedSocket === true,
            response,
          })
        ) {
          sendAttempt(attempt + 1);
          return;
        }
        if (!response.headersSent) {
          response.statusCode = 502;
          response.setHeader("content-type", "text/plain; charset=utf-8");
        }
        response.end(error instanceof Error ? error.message : String(error));
        resolveProxy();
      });

      if (body.replayable) {
        proxyRequest.end(body.body);
      } else {
        for (const chunk of body.prefix) proxyRequest.write(chunk);
        body.stream.pipe(proxyRequest);
      }
    };
    sendAttempt(0);
  });
}


async function listen(server: HttpServer, port: number, host = HOST): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host, port }, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address() as AddressInfo | string | null;
  if (address == null || typeof address === "string") {
    throw new Error("failed to resolve web server address");
  }
  return address.port;
}

async function closeServer(server: HttpServer): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => (error == null ? resolveClose() : rejectClose(error)));
  });
}

async function settleShutdownTask(task: Promise<unknown> | undefined): Promise<void> {
  if (task == null) return;
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task.catch(() => undefined),
      new Promise<void>((resolveTimeout) => {
        timeout = setTimeout(resolveTimeout, SHUTDOWN_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout != null) clearTimeout(timeout);
  }
}

function stopThenExit(stop: () => Promise<void>): void {
  const hardExit = setTimeout(() => process.exit(0), SHUTDOWN_TIMEOUT_MS + 1000);
  hardExit.unref();
  void stop().finally(() => {
    clearTimeout(hardExit);
    process.exit(0);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function attachParentMonitor(stop: () => Promise<void>): void {
  const parentPid = Number(process.env[TOOLS_DEV_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) return;
    clearInterval(timer);
    stopThenExit(stop);
  }, 1000);
  timer.unref();
}

async function createWebSidecarHandle(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  httpServer: HttpServer,
  closeRuntime: () => Promise<void> | void,
  isRuntimeRunning?: () => boolean,
): Promise<WebSidecarHandle> {
  const port = await listen(httpServer, parsePort(process.env[WEB_PORT_ENV]));
  const state: WebStatusSnapshot = {
    pid: process.pid,
    state: "running",
    updatedAt: new Date().toISOString(),
    url: `http://${HOST}:${port}`,
  };
  let ipcServer: JsonIpcServerHandle | null = null;
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolveStop) => {
    resolveStopped = resolveStop;
  });

  function refreshRuntimeState(): void {
    if (stopped || isRuntimeRunning == null || isRuntimeRunning()) return;
    state.state = "stopped";
    state.url = null;
    state.updatedAt = new Date().toISOString();
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    state.state = "stopped";
    state.updatedAt = new Date().toISOString();
    await settleShutdownTask(ipcServer?.close());
    await settleShutdownTask(closeServer(httpServer));
    await settleShutdownTask(Promise.resolve().then(closeRuntime));
    resolveStopped();
  }

  attachParentMonitor(stop);

  ipcServer = await createJsonIpcServer({
    socketPath: runtime.ipc,
    handler: async (message: unknown) => {
      const request = normalizeWebSidecarMessage(message);
      switch (request.type) {
        case SIDECAR_MESSAGES.STATUS:
          refreshRuntimeState();
          return { ...state };
        case SIDECAR_MESSAGES.SHUTDOWN:
          setImmediate(() => {
            stopThenExit(stop);
          });
          return { accepted: true };
      }
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopThenExit(stop);
    });
  }

  return {
    async status() {
      refreshRuntimeState();
      return { ...state };
    },
    stop,
    waitUntilStopped() {
      return stoppedPromise;
    },
  };
}

export function createDaemonProxyHandler(
  daemonOrigin: string | null,
  fallback: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    const daemonProxyTarget = daemonOrigin == null ? null : resolveDaemonProxyTarget(daemonOrigin, request.url);
    if (daemonProxyTarget != null) {
      const localPort = request.socket.localPort;
      void proxyHttpRequest(daemonProxyTarget, request, response, {
        daemonWebPort: typeof localPort === "number" ? localPort : 0,
      }).catch((error: unknown) => {
        response.statusCode = 502;
        response.end(error instanceof Error ? error.message : String(error));
      });
      return;
    }

    // Daemon-routed pathnames must never fall through to the SPA shell: the
    // static/Vite SPA fallback answers every path with 200 text/html, which
    // browser callers parse as JSON and crash on. With no daemon origin there is no
    // proxy target, so answer as the connection-level outage it is.
    if (
      daemonOrigin == null &&
      isDaemonProxyPathname(resolveRequestPathname(request.url) ?? "")
    ) {
      response.statusCode = 502;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(DAEMON_PROXY_UNAVAILABLE_MESSAGE);
      return;
    }

    void fallback(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  };
}


const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function resolveStaticRequestPath(staticDir: string, requestUrl: string | undefined): string | null {
  if (requestUrl == null) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, `http://${HOST}`).pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  const candidate = resolve(staticDir, `.${pathname}`);
  const boundary = `${resolve(staticDir)}${sep}`;
  if (candidate !== resolve(staticDir) && !candidate.startsWith(boundary)) return null;
  return candidate;
}

function cacheControlForStaticPath(filePath: string): string {
  return filePath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

async function sendStaticFile(
  filePath: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => null);
  if (fileStat == null || !fileStat.isFile()) return false;

  response.statusCode = 200;
  response.setHeader("content-type", CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream");
  response.setHeader("content-length", String(fileStat.size));
  response.setHeader("cache-control", cacheControlForStaticPath(filePath));
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  await new Promise<void>((resolveStream, rejectStream) => {
    const stream = createReadStream(filePath);
    stream.once("error", rejectStream);
    response.once("close", resolveStream);
    stream.once("end", resolveStream);
    stream.pipe(response);
  });
  return true;
}

function createStaticSpaHandler(staticDir: string) {
  const indexPath = join(staticDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`missing Vite web build at ${indexPath}; run pnpm --filter @open-design/web build`);
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const requestedPath = resolveStaticRequestPath(staticDir, request.url);
    if (requestedPath != null && await sendStaticFile(requestedPath, request, response)) return;
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    await sendStaticFile(indexPath, request, response);
  };
}

function createViteMiddlewareHandler(vite: ViteDevServer) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    await new Promise<void>((resolveMiddleware, rejectMiddleware) => {
      vite.middlewares(request, response, (error?: unknown) => {
        if (error != null) {
          rejectMiddleware(error);
          return;
        }
        if (!response.writableEnded) {
          response.statusCode = 404;
          response.end("not found");
        }
        resolveMiddleware();
      });
    });
  };
}

async function startViteDevSidecar(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  webRoot: string,
): Promise<WebSidecarHandle> {
  let requestHandler: (request: IncomingMessage, response: ServerResponse) => void = (_request, response) => {
    response.statusCode = 503;
    response.end("Vite dev server is starting");
  };
  const httpServer = createHttpServer((request, response) => requestHandler(request, response));
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: webRoot,
    appType: "spa",
    configFile: join(webRoot, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
  });
  requestHandler = createDaemonProxyHandler(resolveDaemonOrigin(), createViteMiddlewareHandler(vite));

  try {
    return await createWebSidecarHandle(runtime, httpServer, async () => {
      await vite.close();
    });
  } catch (error) {
    await vite.close().catch(() => undefined);
    throw error;
  }
}

async function startStaticSidecar(
  runtime: SidecarRuntimeContext<SidecarStamp>,
  webRoot: string,
): Promise<WebSidecarHandle> {
  const fallback = createStaticSpaHandler(resolveWebStaticDir(webRoot));
  const httpServer = createHttpServer(createDaemonProxyHandler(resolveDaemonOrigin(), fallback));
  return await createWebSidecarHandle(runtime, httpServer, () => undefined);
}

export async function startWebSidecar(runtime: SidecarRuntimeContext<SidecarStamp>): Promise<WebSidecarHandle> {
  const webRoot = resolveWebRoot();
  const dev = process.env.OD_WEB_PROD !== "1" && runtime.mode === "dev";
  return dev
    ? await startViteDevSidecar(runtime, webRoot)
    : await startStaticSidecar(runtime, webRoot);
}
