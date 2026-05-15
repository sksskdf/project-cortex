import type { GaugeTier, PRTag, ReasonTone, TagTone } from '@/lib/types';

// 위험 플래그 → UI 태그(라벨 + 톤). DB는 canonical key, UI는 한국어 표시.
const FLAG_TAG: Record<string, PRTag> = {
  'payment-domain': { label: '결제 모듈', tone: 'red' },
  'auth-domain': { label: '인증', tone: 'red' },
  migration: { label: '마이그레이션', tone: 'red' },
  'security-sensitive': { label: '보안 민감', tone: 'red' },
  'external-api-new': { label: '외부 API', tone: 'purple' },
  'low-coverage': { label: '테스트 부족', tone: 'yellow' },
  'large-change': { label: '큰 변경', tone: 'yellow' },
  'db-schema': { label: 'DB 스키마', tone: 'purple' },
  'ui-change': { label: 'UI 변경', tone: 'sky-blue' },
  dependency: { label: '의존성', tone: 'gray' },
  documentation: { label: '문서', tone: 'gray' },
};

export function flagToTag(flag: string): PRTag {
  return FLAG_TAG[flag] ?? { label: flag, tone: 'gray' };
}

export function flagsToTags(flags: ReadonlyArray<string>): ReadonlyArray<PRTag> {
  return flags.map(flagToTag);
}

const ALERT_FLAGS = new Set(['payment-domain', 'auth-domain', 'migration', 'security-sensitive']);

export function reasonTone(confidence: number, flags: ReadonlyArray<string>): ReasonTone {
  if (flags.some((f) => ALERT_FLAGS.has(f))) return 'alert';
  if (confidence < 70 || flags.includes('large-change') || flags.includes('external-api-new')) {
    return 'warn';
  }
  return 'info';
}

export function gaugeTierFromConfidence(confidence: number): GaugeTier {
  if (confidence >= 90) return 'success';
  if (confidence >= 70) return 'blue';
  if (confidence >= 50) return 'warning';
  return 'error';
}

// 임시 ageText 포맷 — Phase 2에선 mock과 동일한 시점 결과를 위해 고정값 매핑.
// 실시간 계산은 lib/format-time.ts에서 별도 도입 (CONVENTIONS §14).
export function formatRelativeAge(createdAtMs: number, nowMs: number = Date.now()): string {
  const diffMin = Math.floor((nowMs - createdAtMs) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

export function tagClassName(tone: TagTone): string {
  const map: Record<TagTone, string> = {
    red: 'ds-tag--red',
    yellow: 'ds-tag--yellow',
    purple: 'ds-tag--purple',
    green: 'ds-tag--green',
    gray: 'ds-tag--gray',
    'sky-blue': 'ds-tag--sky-blue',
    cyan: 'ds-tag--cyan',
  };
  return `ds-tag ds-tag--md ${map[tone]}`;
}
