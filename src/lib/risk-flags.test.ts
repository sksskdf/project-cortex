import { describe, expect, it } from 'vitest';
import {
  detectFlagsFromDiff,
  detectFlagsFromPaths,
  isLargeChange,
  isLowCoverage,
  precomputeFlags,
} from './risk-flags';

describe('detectFlagsFromPaths', () => {
  it('detects payment-domain from path keywords', () => {
    const f = detectFlagsFromPaths(['src/payment/service.ts', 'src/billing/api.ts']);
    expect(f.has('payment-domain')).toBe(true);
  });

  it('detects auth-domain', () => {
    expect(detectFlagsFromPaths(['src/auth/session.ts']).has('auth-domain')).toBe(true);
    expect(detectFlagsFromPaths(['src/login/page.tsx']).has('auth-domain')).toBe(true);
    expect(detectFlagsFromPaths(['lib/jwt.ts']).has('auth-domain')).toBe(true);
  });

  it('detects migration', () => {
    expect(detectFlagsFromPaths(['drizzle/migrations/0001.sql']).has('migration')).toBe(true);
    expect(detectFlagsFromPaths(['db/schema.sql']).has('migration')).toBe(true);
  });

  it('detects security-sensitive', () => {
    expect(detectFlagsFromPaths(['src/password-reset.ts']).has('security-sensitive')).toBe(true);
    expect(detectFlagsFromPaths(['.env.example']).has('security-sensitive')).toBe(true);
  });

  // 회귀(리뷰 발견): `\bauth\b` 는 'authentication'/'authorization'/'authGuard' 를 못 잡아
  // auth 변경이 무검토 자동 머지됐다.
  it('detects auth-domain for authentication/authorization/oauth/camelCase', () => {
    expect(detectFlagsFromPaths(['src/authentication/verify.ts']).has('auth-domain')).toBe(true);
    expect(detectFlagsFromPaths(['src/lib/authorization.ts']).has('auth-domain')).toBe(true);
    expect(detectFlagsFromPaths(['src/middleware/authGuard.ts']).has('auth-domain')).toBe(true);
    expect(detectFlagsFromPaths(['src/lib/oauth.ts']).has('auth-domain')).toBe(true);
  });

  // 회귀: 'author'/'authorId'(이 코드베이스 도처)는 auth-domain 오매칭하면 안 됨(over-block 방지).
  it('does NOT flag author/authorId as auth-domain', () => {
    expect(detectFlagsFromPaths(['src/lib/authorId.ts']).has('auth-domain')).toBe(false);
    expect(detectFlagsFromPaths(['src/components/AuthorName.tsx']).has('auth-domain')).toBe(false);
    expect(detectFlagsFromPaths(['src/lib/pr-author.ts']).has('auth-domain')).toBe(false);
  });

  it('detects migration from drizzle schema source (db/schema.ts)', () => {
    expect(detectFlagsFromPaths(['src/db/schema.ts']).has('migration')).toBe(true);
  });

  it('returns empty set for benign paths', () => {
    expect(detectFlagsFromPaths(['src/components/Button.tsx', 'src/ui/icon.svg']).size).toBe(0);
  });
});

describe('detectFlagsFromDiff', () => {
  it('detects external-api-new from added fetch/axios lines', () => {
    const diff = '+ const data = await fetch("https://api.example.com");';
    expect(detectFlagsFromDiff(diff).has('external-api-new')).toBe(true);
  });

  it('does not flag fetch references in deleted lines', () => {
    const diff = '- const data = await fetch("https://api.example.com");';
    expect(detectFlagsFromDiff(diff).has('external-api-new')).toBe(false);
  });

  it('detects axios.get usage (client.method 형태)', () => {
    expect(detectFlagsFromDiff('+  const r = await axios.get(url);').has('external-api-new')).toBe(
      true,
    );
  });

  // 회귀(리뷰 발견): `+++ b/path` 헤더 줄을 추가 content 로 오인. 경로에 client 이름이 들어가면
  // 코드 변경 없이 false 차단됐다.
  it('does NOT flag the `+++ b/path` diff header (even if path contains a client name)', () => {
    const diff = '+++ b/src/forgot-password/got.ts';
    expect(detectFlagsFromDiff(diff).has('external-api-new')).toBe(false);
  });

  // 회귀: 'got' 영어 단어 충돌 — 호출/import 가 아니면 flag 안 함.
  it('does NOT flag the English word "got" (comment/identifier)', () => {
    expect(detectFlagsFromDiff('+ // we got the result back').has('external-api-new')).toBe(false);
  });
  it('DOES flag got() call / got import', () => {
    expect(detectFlagsFromDiff("+ const r = got('https://x');").has('external-api-new')).toBe(true);
    expect(detectFlagsFromDiff("+import got from 'got';").has('external-api-new')).toBe(true);
  });

  it('returns empty set for benign diff', () => {
    expect(detectFlagsFromDiff('+ const x = 1;').size).toBe(0);
  });
});

describe('isLargeChange', () => {
  it('true when added+removed > 500', () => {
    expect(isLargeChange(300, 250)).toBe(true);
  });
  it('false at threshold', () => {
    expect(isLargeChange(250, 250)).toBe(false);
  });
});

describe('isLowCoverage', () => {
  it('true when coverage < 0.7', () => {
    expect(isLowCoverage(0.58)).toBe(true);
  });
  it('false at or above threshold', () => {
    expect(isLowCoverage(0.7)).toBe(false);
    expect(isLowCoverage(0.95)).toBe(false);
  });
  it('false when coverage is null (not measured)', () => {
    expect(isLowCoverage(null)).toBe(false);
  });
});

describe('precomputeFlags integration', () => {
  it('combines path + diff + meta heuristics', () => {
    const result = precomputeFlags({
      paths: ['src/payment/refund.ts'],
      diffText: '+ const res = await fetch("https://api.stripe.com");',
      linesAdded: 600,
      linesRemoved: 50,
      coverage: 0.55,
    });
    expect(result.sort()).toEqual(
      ['payment-domain', 'external-api-new', 'large-change', 'low-coverage'].sort(),
    );
  });

  it('returns empty array when no signals', () => {
    expect(
      precomputeFlags({
        paths: ['src/utils/format.ts'],
        diffText: '+ return n * 2;',
        linesAdded: 5,
        linesRemoved: 2,
        coverage: 0.95,
      }),
    ).toEqual([]);
  });
});
