import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature } from './webhook-verify';

const SECRET = 'test-secret';

function sign(body: string, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyGithubSignature', () => {
  it('returns true for valid signature', () => {
    const body = '{"hello":"world"}';
    expect(verifyGithubSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = '{"hello":"world"}';
    expect(verifyGithubSignature('{"hello":"x"}', sign(body), SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{}';
    expect(verifyGithubSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });

  it('returns false when header missing', () => {
    expect(verifyGithubSignature('{}', null, SECRET)).toBe(false);
  });

  it('returns false for missing sha256= prefix', () => {
    const body = '{}';
    const hash = sign(body).slice('sha256='.length);
    expect(verifyGithubSignature(body, hash, SECRET)).toBe(false);
  });

  it('returns false for malformed signature length', () => {
    expect(verifyGithubSignature('{}', 'sha256=short', SECRET)).toBe(false);
  });
});
