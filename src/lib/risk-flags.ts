// 위험 플래그 휴리스틱 (DOMAIN.md §2 + §4).
// LLM 호출 전 로컬에서 빠르게 결정 가능한 플래그를 먼저 잡음.
// LLM 결과는 lib/pre-review에서 이 결과와 union으로 합쳐 저장.

export type RiskFlag =
  | 'payment-domain'
  | 'auth-domain'
  | 'migration'
  | 'security-sensitive'
  | 'external-api-new'
  | 'low-coverage'
  | 'large-change';

// 파일 경로 휴리스틱. 도메인 신호가 강하면 차단 플래그가 거의 확실. 한 flag 에 여러 패턴 —
// 하나라도 매칭하면 flag. (auth 처럼 단일 정규식으론 정확히 잡기 어려운 경우 분리.)
const PATH_PATTERNS: ReadonlyArray<{ patterns: ReadonlyArray<RegExp>; flag: RiskFlag }> = [
  { patterns: [/payment|billing|refund|invoice|checkout|stripe|paypal/i], flag: 'payment-domain' },
  {
    // auth-domain: authentication/authorization/oauth/login/session/jwt 등. 예전 `\bauth\b` 는
    // 'authentication'·'authorization'·'authGuard' 를 못 잡아 auth 변경이 무검토 자동 머지됐다
    // (리뷰 발견). 동시에 'author'·'authorId'(이 코드베이스 도처) 오매칭은 피해야 한다.
    patterns: [
      // 충돌 없는 명시 토큰 (대소문자 무관).
      /\b(?:authentication|authorization|authn|authz|oauth2?|login|logout|signin|session|jwt|sso|saml|oidc)\b/i,
      // 경로 세그먼트 'auth' (`src/auth/`, `auth.ts`) — 'author.ts' 는 뒤가 'or' 라 제외.
      /(?:^|[/\\._-])auth(?:[/\\._-]|$)/i,
      // camelCase authGuard/authMiddleware — /i 없이(대문자 경계). 'author'(소문자 o)는 제외.
      /auth[A-Z]/,
    ],
    flag: 'auth-domain',
  },
  // migration: 마이그레이션 파일 + drizzle schema 소스(이 레포의 DB 스키마 단일 소스). schema.ts
  // 만 변경하고 .sql 미동반인 PR 도 잡도록 db/schema 추가(리뷰 발견).
  { patterns: [/migrat(ion|e)|\.sql\b|db\/schema|drizzle\//i], flag: 'migration' },
  // security-sensitive: 비밀번호·시크릿·자격증명 + **자격증명 파일류**(리뷰 발견 미탐 보강). apiKey·
  // private-key·.pem/.p12/keystore·signing-key 등 명확히 자격증명인 이름만 추가(저-오탐). bare
  // 'token' 은 영어/페이지네이션 충돌이 커 제외(블로킹 플래그라 over-block 위험). 자격증명 변경은
  // 자동 머지 차단 = 의도된 안전.
  {
    patterns: [
      /password|secret|credential|\.env|crypto/i,
      /api[_-]?key|private[_-]?key|signing[_-]?key|\.pem\b|\.p12\b|\.pfx\b|keystore/i,
    ],
    flag: 'security-sensitive',
  },
];

// diff 본문 휴리스틱. 신규 외부 호출은 LLM이 더 정확하지만 1차 거르기용.
// `^\+(?!\+)` — 추가된 content line 만(헤더 `+++ b/path` 제외). 예전엔 `^\+` 라 `+++` 헤더의
// 경로에 든 client 이름(got/axios 등)을 코드 변경으로 오인해 false 차단했다(리뷰 발견).
// 'got' 은 영어 단어 충돌이 심해 호출(`got(`)/import 형태만 인정.
const DIFF_PATTERNS: ReadonlyArray<{ pattern: RegExp; flag: RiskFlag }> = [
  {
    pattern:
      /^\+(?!\+).*(?:\b(?:fetch|axios|undici)\b|\bhttp\.(?:get|post|request)\b|\bgot\s*\(|(?:from |require\()['"]got['"])/m,
    flag: 'external-api-new',
  },
];

// 큰 변경 임계치 — DOMAIN.md 명시는 없지만 ROADMAP과 prototype을 보면 ~500줄 기준.
const LARGE_CHANGE_THRESHOLD = 500;
// 커버리지 부족 임계치 — Phase 4 PreReview의 coverage 필드와 비교.
export const LOW_COVERAGE_THRESHOLD = 0.7;

export function detectFlagsFromPaths(paths: ReadonlyArray<string>): Set<RiskFlag> {
  const flags = new Set<RiskFlag>();
  for (const path of paths) {
    for (const { patterns, flag } of PATH_PATTERNS) {
      if (patterns.some((p) => p.test(path))) flags.add(flag);
    }
  }
  return flags;
}

export function detectFlagsFromDiff(diffText: string): Set<RiskFlag> {
  const flags = new Set<RiskFlag>();
  for (const { pattern, flag } of DIFF_PATTERNS) {
    if (pattern.test(diffText)) flags.add(flag);
  }
  return flags;
}

export function isLargeChange(linesAdded: number, linesRemoved: number): boolean {
  return linesAdded + linesRemoved > LARGE_CHANGE_THRESHOLD;
}

export function isLowCoverage(coverage: number | null): boolean {
  if (coverage === null) return false;
  return coverage < LOW_COVERAGE_THRESHOLD;
}

// 모든 휴리스틱 통합 — diff/paths/메타 정보로 lib/pre-review가 부른다.
export function precomputeFlags(input: {
  paths: ReadonlyArray<string>;
  diffText: string;
  linesAdded: number;
  linesRemoved: number;
  coverage: number | null;
}): RiskFlag[] {
  const flags = new Set<RiskFlag>([
    ...detectFlagsFromPaths(input.paths),
    ...detectFlagsFromDiff(input.diffText),
  ]);
  if (isLargeChange(input.linesAdded, input.linesRemoved)) flags.add('large-change');
  if (isLowCoverage(input.coverage)) flags.add('low-coverage');
  return [...flags];
}
