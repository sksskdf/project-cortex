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

// 다중 App — 들어온 webhook 이 어느 App 것인지 본문 신뢰 전엔 모르므로, 후보 secret
// (등록된 App 들 + env) 중 하나라도 맞으면 통과. 후보가 0개면 거부.
export function verifyGithubSignatureAny(
  rawBody: string,
  signatureHeader: string | null,
  secrets: ReadonlyArray<string>,
): boolean {
  if (secrets.length === 0) return false;
  return secrets.some((s) => verifyGithubSignature(rawBody, signatureHeader, s));
}
