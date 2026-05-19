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

// 파일 경로 휴리스틱. 도메인 신호가 강하면 차단 플래그가 거의 확실.
const PATH_PATTERNS: ReadonlyArray<{ pattern: RegExp; flag: RiskFlag }> = [
  { pattern: /payment|billing|refund|invoice|checkout/i, flag: 'payment-domain' },
  { pattern: /\bauth\b|\bauthn\b|\bauthz\b|login|session|jwt|oauth/i, flag: 'auth-domain' },
  { pattern: /migrat(ion|e)|schema\.sql|drizzle\/migrations/i, flag: 'migration' },
  { pattern: /password|secret|credential|\.env|crypto/i, flag: 'security-sensitive' },
];

// diff 본문 휴리스틱. 신규 외부 호출은 LLM이 더 정확하지만 1차 거르기용.
const DIFF_PATTERNS: ReadonlyArray<{ pattern: RegExp; flag: RiskFlag }> = [
  {
    pattern: /^\+.*\b(fetch|axios|got|undici|http\.(get|post|request))\b/m,
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
    for (const { pattern, flag } of PATH_PATTERNS) {
      if (pattern.test(path)) flags.add(flag);
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
