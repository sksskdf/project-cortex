import { createHmac, timingSafeEqual } from 'node:crypto';

// GitHub은 'sha256=<hex>' 형식으로 X-Hub-Signature-256 헤더에 보냄.
// secret + raw body로 HMAC-SHA256 계산 후 비교. 타이밍 공격 회피.
export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.slice('sha256='.length);

  if (expected.length !== provided.length) return false;

  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;

  return timingSafeEqual(expectedBuf, providedBuf);
}
