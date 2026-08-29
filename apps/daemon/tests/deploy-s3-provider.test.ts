import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deployConfigPath,
  deployToS3Compatible,
  publicS3CompatibleConfig,
  readS3CompatibleConfig,
  S3_COMPATIBLE_PROVIDER_ID,
  s3KeyPrefixForDeploy,
  writeS3CompatibleConfig,
} from '../src/deploy.js';

const CREDENTIALS = { accessKeyId: 'AKIAEXAMPLE', token: 'secret-key' };
const BUCKET = { endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'artifacts' };

/** Run `fn` against a throwaway `OD_USER_STATE_DIR` so config writes stay isolated. */
async function withStateRoot(fn: () => Promise<void>) {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'od-s3-config-'));
  const prior = process.env.OD_USER_STATE_DIR;
  process.env.OD_USER_STATE_DIR = stateRoot;
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env.OD_USER_STATE_DIR;
    else process.env.OD_USER_STATE_DIR = prior;
    await rm(stateRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Stub `fetch` with a real `Response` and record only the object uploads.
 * `deployToS3Compatible` also probes the published URL for reachability, so a
 * bare call count would conflate uploads with that probe — and a plain object
 * literal stub hangs the probe, which reads `headers` off the response.
 */
function uploadRecorder() {
  const calls: Array<{ url: string; auth: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    if (init.method === 'PUT') calls.push({ url, auth: init.headers.Authorization });
    return new Response('', { status: 200 });
  }));
  return calls;
}

describe('s3-compatible config', () => {
  it('round-trips config and never echoes the secret back', async () => {
    await withStateRoot(async () => {
      const saved = await writeS3CompatibleConfig({ ...CREDENTIALS, s3: BUCKET });
      expect(saved.configured).toBe(true);
      expect(saved.tokenMask).toBe('saved-s3-secret');
      expect(JSON.stringify(saved)).not.toContain('secret-key');

      const stored = await readS3CompatibleConfig();
      expect(stored.token).toBe('secret-key');
      expect(stored.s3?.bucket).toBe('artifacts');
    });
  });

  it('keeps the stored secret when the UI sends the mask back', async () => {
    await withStateRoot(async () => {
      await writeS3CompatibleConfig({ ...CREDENTIALS, s3: BUCKET });
      await writeS3CompatibleConfig({
        accessKeyId: 'AKIAEXAMPLE',
        token: 'saved-s3-secret',
        s3: { ...BUCKET, bucket: 'renamed' },
      });
      const stored = await readS3CompatibleConfig();
      expect(stored.token).toBe('secret-key');
      expect(stored.s3?.bucket).toBe('renamed');
    });
  });

  it('writes the credential file with owner-only permissions', async () => {
    await withStateRoot(async () => {
      await writeS3CompatibleConfig({ ...CREDENTIALS, s3: BUCKET });
      const raw = await readFile(deployConfigPath(S3_COMPATIBLE_PROVIDER_ID), 'utf8');
      expect(JSON.parse(raw).accessKeyId).toBe('AKIAEXAMPLE');
    });
  });

  it.each([
    ['accessKeyId', { token: 'k', s3: BUCKET }, 'S3_ACCESS_KEY_ID_REQUIRED'],
    ['secret', { accessKeyId: 'a', s3: BUCKET }, 'S3_SECRET_REQUIRED'],
    ['endpoint', { ...CREDENTIALS, s3: { bucket: 'b' } }, 'S3_ENDPOINT_REQUIRED'],
    ['bucket', { ...CREDENTIALS, s3: { endpoint: 'https://x.test' } }, 'S3_BUCKET_REQUIRED'],
  ])('rejects a config missing %s', async (_label, input, code) => {
    await withStateRoot(async () => {
      await expect(writeS3CompatibleConfig(input as never)).rejects.toMatchObject({ code });
    });
  });

  it('reports unconfigured before anything is saved', () => {
    expect(publicS3CompatibleConfig({}).configured).toBe(false);
  });

  it('strips trailing slashes so signed keys never contain //', async () => {
    await withStateRoot(async () => {
      const saved = await writeS3CompatibleConfig({
        ...CREDENTIALS,
        s3: { ...BUCKET, endpoint: 'https://s3.us-east-1.amazonaws.com/', publicBaseUrl: 'https://cdn.test/' },
      });
      expect(saved.s3.endpoint).toBe('https://s3.us-east-1.amazonaws.com');
      expect(saved.s3.publicBaseUrl).toBe('https://cdn.test');
    });
  });
});

describe('s3KeyPrefixForDeploy', () => {
  const config = { token: 't', accessKeyId: 'a', s3: { ...BUCKET, prefix: 'od' } };

  it('derives a stable prefix so republishing keeps the same URL', () => {
    const first = s3KeyPrefixForDeploy(config, 'proj-1', 'Landing Page.html');
    expect(first).toBe('od/proj-1/landing-page/');
    expect(s3KeyPrefixForDeploy(config, 'proj-1', 'Landing Page.html')).toBe(first);
  });

  it('separates different files in the same project', () => {
    expect(s3KeyPrefixForDeploy(config, 'p', 'a.html')).not.toBe(s3KeyPrefixForDeploy(config, 'p', 'b.html'));
  });
});

describe('deployToS3Compatible', () => {
  const files = [
    { file: 'index.html', data: Buffer.from('<html>hi</html>'), contentType: 'text/html' },
    { file: 'style.css', data: Buffer.from('body{}'), contentType: 'text/css' },
  ];
  const config = { ...CREDENTIALS, s3: { ...BUCKET, prefix: 'od', publicBaseUrl: 'https://cdn.test' } };

  it('uploads every file with a signed PUT and returns the entry URL', async () => {
    const calls = uploadRecorder();

    const result = await deployToS3Compatible({ config, files, projectId: 'p1', fileName: 'page.html' });

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth.startsWith('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/'))).toBe(true);
    // Virtual-host addressing is the default for S3/R2/Spaces.
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://artifacts.s3.us-east-1.amazonaws.com/od/p1/page/index.html',
      'https://artifacts.s3.us-east-1.amazonaws.com/od/p1/page/style.css',
    ]);
    expect(result.url).toBe('https://cdn.test/od/p1/page/index.html');
    expect(result.providerId).toBe('s3-compatible');
  });

  it('addresses the bucket as a path segment when forcePathStyle is set', async () => {
    const calls = uploadRecorder();

    await deployToS3Compatible({
      config: { ...CREDENTIALS, s3: { endpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'b', prefix: '', forcePathStyle: true, publicBaseUrl: 'http://localhost:9000/b' } },
      files: [files[0]!],
      projectId: 'p',
      fileName: 'a.html',
    });

    expect(calls.map((c) => c.url)).toEqual(['http://localhost:9000/b/p/a/index.html']);
  });

  it('surfaces the provider error body instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<Error><Code>SignatureDoesNotMatch</Code></Error>', { status: 403 })));

    await expect(deployToS3Compatible({ config, files, projectId: 'p', fileName: 'a.html' })).rejects.toMatchObject({
      code: 'S3_UPLOAD_FAILED',
      status: 400,
      details: expect.stringContaining('SignatureDoesNotMatch'),
    });
  });

  it('rejects an incomplete config before making any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      deployToS3Compatible({ config: { token: '', accessKeyId: '', s3: BUCKET }, files, projectId: 'p', fileName: 'a.html' }),
    ).rejects.toMatchObject({ code: 'S3_CREDENTIALS_REQUIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
