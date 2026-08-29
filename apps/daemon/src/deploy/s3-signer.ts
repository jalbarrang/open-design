/**
 * Minimal AWS Signature Version 4 signing for S3-compatible object storage.
 *
 * The `s3-compatible` deploy provider talks to Amazon S3, Cloudflare R2, MinIO,
 * Backblaze B2, and DigitalOcean Spaces through the same REST API, so the only
 * vendor-specific piece is the endpoint. Signing is ~80 lines of HMAC, which is
 * why this is hand-rolled rather than pulled in as an AWS SDK dependency: the
 * SDK would add megabytes to the daemon to sign a PUT.
 *
 * Scope is deliberately narrow — single-shot requests with an in-memory payload
 * (`UNSIGNED-PAYLOAD` and chunked uploads are not supported). Deployed artifact
 * files are small enough to buffer.
 */

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

export interface S3SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface S3SigningInput {
  method: string;
  /** Absolute endpoint of the bucket host, e.g. `https://bucket.s3.us-east-1.amazonaws.com`. */
  url: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  payload: Buffer;
  /** Extra headers to sign alongside the required `host`/`x-amz-*` set. */
  headers?: Record<string, string>;
  /** Injectable for deterministic tests; defaults to now. */
  now?: Date;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Percent-encode one path segment per RFC 3986. AWS treats `-`, `_`, `.` and
 * `~` as unreserved; everything else is encoded with UPPERCASE hex, which
 * `encodeURIComponent` does not guarantee for `!'()*`.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * S3 canonical URI keeps `/` separators intact and single-encodes each segment.
 * An empty path signs as `/`.
 *
 * Each segment is decoded before being re-encoded: `URL.pathname` hands back an
 * already-percent-encoded path, and signing that verbatim would escape the `%`
 * itself, producing `%2524` where AWS expects `%24`. Decoding first makes the
 * function idempotent, so it is safe on both raw and encoded input.
 */
export function canonicalUri(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((segment) => {
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        // A malformed escape means the segment is already literal; sign as-is.
      }
      return encodeSegment(decoded);
    })
    .join('/');
}

/** Query string sorted by key, with both key and value percent-encoded. */
export function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  searchParams.forEach((value, key) => pairs.push([key, value]));
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join('&');
}

/**
 * Sign a request and return the headers to send. The returned `headers`
 * include `Authorization`, so the caller passes them straight to `fetch`.
 */
export function signS3Request(input: S3SigningInput): S3SignedRequest {
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15)}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.payload);

  // `host` must be signed; a non-default port is part of the host value.
  const signed: Record<string, string> = {
    ...(input.headers ?? {}),
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  // Canonical headers: lowercase names, trimmed values, sorted by name.
  const entries = Object.entries(signed)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = entries.map(([n, v]) => `${n}:${v}\n`).join('');
  const signedHeaders = entries.map(([n]) => n).join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signingKey = ['aws4_request'].reduce(
    (key, step) => hmac(key, step),
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), SERVICE),
  );
  const signature = hmac(signingKey, stringToSign).toString('hex');

  return {
    url: input.url,
    method: input.method.toUpperCase(),
    headers: {
      ...signed,
      Authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
