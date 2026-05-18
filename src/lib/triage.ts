// 트라이아지 결정 — DOMAIN.md §4 자동 머지 정책의 한 곳 구현.
// 외부 의존 0 — pure function.

import type { TriageDecisionRow } from '@/db/schema';

export type TriageDecision = TriageDecisionRow['decision'];

export type TriageResult = {
  decision: TriageDecision;
  reason: string;
};

export type TriageInput = {
  authorKind: 'agent' | 'human';
  confidence: number;
  flags: ReadonlyArray<string>;
  testsPassed: boolean | null;
  autoMergeEnabled: boolean;
};

// 자동 머지 차단 플래그 (DOMAIN.md §4 룰 3).
const BLOCKING_FLAGS = new Set([
  'payment-domain',
  'auth-domain',
  'migration',
  'security-sensitive',
  'external-api-new',
]);

// 자동 머지 조건은 AND. 하나라도 어기면 human-review.
// 각 거부 사유는 한국어 한 줄로 반환 (UI 노출용).
export function decideTriage(input: TriageInput): TriageResult {
  if (input.authorKind === 'human') {
    return {
      decision: 'human-review',
      reason: '사람 작성 PR — 자동 머지 정책에서 항상 제외됩니다.',
    };
  }

  if (!input.autoMergeEnabled) {
    return {
      decision: 'human-review',
      reason: '레포의 자동 머지 정책이 꺼져 있습니다.',
    };
  }

  const blocker = input.flags.find((f) => BLOCKING_FLAGS.has(f));
  if (blocker) {
    return {
      decision: 'human-review',
      reason: blockerReason(blocker),
    };
  }

  if (input.testsPassed === false) {
    return {
      decision: 'human-review',
      reason: '테스트 실패 — 사람 검토가 필요합니다.',
    };
  }

  if (input.testsPassed === null) {
    return {
      decision: 'human-review',
      reason: '테스트 결과가 없습니다 — 사람 검토가 필요합니다.',
    };
  }

  if (input.confidence < 90) {
    return {
      decision: 'human-review',
      reason: `신뢰 점수 ${input.confidence}점으로 자동 머지 기준(90+) 미달.`,
    };
  }

  return {
    decision: 'auto-merge',
    reason: '모든 자동 머지 조건 충족.',
  };
}

function blockerReason(flag: string): string {
  switch (flag) {
    case 'payment-domain':
      return '결제 도메인 변경 — 정책상 사람 검토가 필요합니다.';
    case 'auth-domain':
      return '인증 도메인 변경 — 정책상 사람 검토가 필요합니다.';
    case 'migration':
      return '마이그레이션 포함 — 사람 승인이 필수입니다.';
    case 'security-sensitive':
      return '보안 민감 영역 — 사람 검토가 필요합니다.';
    case 'external-api-new':
      return '신규 외부 API 호출 — 보안 검토를 권장합니다.';
    default:
      return `${flag} 위험 플래그 — 사람 검토가 필요합니다.`;
  }
}
