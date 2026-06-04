// Phase 4.7 — 위험 플래그 휴리스틱 **회귀 평가 세트(regression eval corpus)**.
//
// 목적: risk-flags 의 경로/diff 휴리스틱 정확도(오탐/미탐)를 라벨된 케이스 표로 박제해, 패턴을
// 손볼 때 회귀(이전에 맞던 게 틀어짐)를 즉시 잡는다. 각 케이스는 "현실적 입력 → 기대 플래그"
// 이며, 특히 과거 리뷰에서 발견된 오탐/미탐(author/got/foo..bar/authorization/credential 파일)을
// 고정 사례로 포함한다.
//
// 범위: 결정적 휴리스틱(detectFlagsFromPaths/Diff)만. LLM 출력 품질 채점은 claude CLI 런타임이
// 필요해 별도(사용자 머신). 이 표가 "프롬프트/모델 튜닝과 무관하게 1차 거르기가 정확한가"를 지킨다.

import { describe, expect, it } from 'vitest';
import { detectFlagsFromPaths, detectFlagsFromDiff, type RiskFlag } from './risk-flags';

// 경로 휴리스틱 라벨 케이스 — { 설명, 경로들, 기대 플래그 집합(정확히 일치) }.
type PathCase = { desc: string; paths: string[]; expect: RiskFlag[] };

const PATH_CORPUS: PathCase[] = [
  // ── payment ──
  { desc: 'payment dir', paths: ['src/payment/charge.ts'], expect: ['payment-domain'] },
  { desc: 'billing', paths: ['src/billing/invoice.ts'], expect: ['payment-domain'] },
  { desc: 'stripe 통합', paths: ['src/lib/stripe.ts'], expect: ['payment-domain'] },
  { desc: 'checkout', paths: ['app/checkout/page.tsx'], expect: ['payment-domain'] },

  // ── auth (오탐/미탐 핵심) ──
  { desc: 'auth dir', paths: ['src/auth/index.ts'], expect: ['auth-domain'] },
  {
    desc: 'authentication (미탐 회귀)',
    paths: ['src/authentication/verify.ts'],
    expect: ['auth-domain'],
  },
  {
    desc: 'authorization (미탐 회귀)',
    paths: ['src/lib/authorization.ts'],
    expect: ['auth-domain'],
  },
  { desc: 'authGuard camelCase', paths: ['src/middleware/authGuard.ts'], expect: ['auth-domain'] },
  { desc: 'oauth', paths: ['src/lib/oauth.ts'], expect: ['auth-domain'] },
  { desc: 'jwt', paths: ['src/lib/jwt.ts'], expect: ['auth-domain'] },
  { desc: 'login page', paths: ['app/login/page.tsx'], expect: ['auth-domain'] },
  // 오탐 방지(이 코드베이스 도처의 author* 는 auth 아님)
  { desc: 'authorId (오탐 방지)', paths: ['src/lib/authorId.ts'], expect: [] },
  { desc: 'AuthorName 컴포넌트 (오탐 방지)', paths: ['src/components/AuthorName.tsx'], expect: [] },
  { desc: 'pr-author (오탐 방지)', paths: ['src/lib/pr-author.ts'], expect: [] },

  // ── migration ──
  { desc: '.sql 마이그레이션', paths: ['src/db/migrations/0001_x.sql'], expect: ['migration'] },
  { desc: 'drizzle schema 소스 (미탐 회귀)', paths: ['src/db/schema.ts'], expect: ['migration'] },

  // ── security (자격증명 파일 미탐 보강) ──
  { desc: 'password reset', paths: ['src/password-reset.ts'], expect: ['security-sensitive'] },
  { desc: '.env', paths: ['.env.production'], expect: ['security-sensitive'] },
  { desc: 'apiKey (미탐 회귀)', paths: ['src/lib/apiKey.ts'], expect: ['security-sensitive'] },
  {
    desc: 'private-key (미탐 회귀)',
    paths: ['config/private-key.ts'],
    expect: ['security-sensitive'],
  },
  { desc: '.pem 파일 (미탐 회귀)', paths: ['certs/server.pem'], expect: ['security-sensitive'] },
  {
    desc: 'keystore (미탐 회귀)',
    paths: ['android/app/release.keystore'],
    expect: ['security-sensitive'],
  },

  // ── 복합/음성 ──
  {
    desc: 'auth + payment 동시',
    paths: ['src/auth/session.ts', 'src/payment/refund.ts'],
    expect: ['auth-domain', 'payment-domain'],
  },
  { desc: '평범한 UI (플래그 없음)', paths: ['src/components/Button.tsx'], expect: [] },
  { desc: 'foo..bar 정상 경로 (오탐 방지)', paths: ['src/srv/foo..bar/util.ts'], expect: [] },
  { desc: 'docs (플래그 없음)', paths: ['docs/ROADMAP.md', 'README.md'], expect: [] },
];

// diff 본문 휴리스틱 라벨 케이스.
type DiffCase = { desc: string; diff: string; expect: RiskFlag[] };

const DIFF_CORPUS: DiffCase[] = [
  { desc: 'fetch 추가', diff: '+ const r = await fetch(url);', expect: ['external-api-new'] },
  { desc: 'axios.get 추가', diff: '+  await axios.get(u);', expect: ['external-api-new'] },
  { desc: 'got() 호출', diff: "+ const r = got('https://x');", expect: ['external-api-new'] },
  { desc: 'got import', diff: "+import got from 'got';", expect: ['external-api-new'] },
  { desc: 'http.post', diff: '+ http.post(u, body);', expect: ['external-api-new'] },
  // 음성(오탐 방지)
  { desc: '삭제 라인은 무시', diff: '- await fetch(url);', expect: [] },
  { desc: '"got" 영어 단어 (오탐 방지)', diff: '+ // we got the result', expect: [] },
  {
    desc: '+++ 헤더의 경로 client 이름 (오탐 방지)',
    diff: '+++ b/src/forgot-password/got.ts',
    expect: [],
  },
  { desc: '평범한 추가 (플래그 없음)', diff: '+ const x = 1;', expect: [] },
];

function sortedFlags(s: Set<RiskFlag>): RiskFlag[] {
  return [...s].sort();
}

describe('risk-flags 회귀 평가 세트 (경로)', () => {
  for (const c of PATH_CORPUS) {
    it(c.desc, () => {
      expect(sortedFlags(detectFlagsFromPaths(c.paths))).toEqual([...c.expect].sort());
    });
  }
});

describe('risk-flags 회귀 평가 세트 (diff)', () => {
  for (const c of DIFF_CORPUS) {
    it(c.desc, () => {
      expect(sortedFlags(detectFlagsFromDiff(c.diff))).toEqual([...c.expect].sort());
    });
  }
});
