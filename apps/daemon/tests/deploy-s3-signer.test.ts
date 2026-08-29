import { describe, expect, it } from 'vitest';

import { canonicalUri, signS3Request } from '../src/deploy/s3-signer.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Vectors come from the AWS "Signature Version 4 Test Suite" examples for S3
 * (docs: Authenticating Requests, Signature Version 4). Matching them byte for
 * byte is the only way to know the hand-rolled signer is correct — a signature
 * that is merely self-consistent still gets rejected by every real bucket.
 */
describe('signS3Request', () => {
  const credentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: new Date('2013-05-24T00:00:00Z'),
  };

  it('matches the AWS GET-with-Range vector', () => {
    const signed = signS3Request({
      ...credentials,
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      payload: Buffer.alloc(0),
      headers: { Range: 'bytes=0-9' },
    });

    expect(signed.headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    expect(signed.headers['x-amz-date']).toBe('20130524T000000Z');
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('matches the AWS PUT-object vector', () => {
    const signed = signS3Request({
      ...credentials,
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test%24file.text',
      payload: Buffer.from('Welcome to Amazon S3.', 'utf8'),
      headers: { 'Date': 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
    });

    expect(signed.headers.Authorization).toContain(
      'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    );
  });

  it('signs a non-default port into host', () => {
    const signed = signS3Request({
      ...credentials,
      method: 'PUT',
      url: 'http://localhost:9000/bucket/index.html',
      payload: Buffer.from('<html>', 'utf8'),
    });
    expect(signed.headers.host).toBe('localhost:9000');
    expect(signed.headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date');
  });
});

describe('canonicalUri', () => {
  it('keeps separators and single-encodes each segment', () => {
    expect(canonicalUri('/od/my project/a+b.html')).toBe('/od/my%20project/a%2Bb.html');
  });

  it('is idempotent on already-encoded input', () => {
    expect(canonicalUri('/test%24file.text')).toBe('/test%24file.text');
    expect(canonicalUri(canonicalUri('/od/my project'))).toBe('/od/my%20project');
  });

  it('signs an empty path as root', () => {
    expect(canonicalUri('')).toBe('/');
  });
});
