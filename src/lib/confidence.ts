// 신뢰 점수 → 티어 매핑 (DOMAIN.md §3).
// 한 곳만 두고 모두 여기서 import (UI 색·라벨 매핑은 lib/format에).

import type { ConfidenceTier } from '@/lib/types';

export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  if (score >= 50) return 'low';
  return 'critical';
}

// auto-merge 후보 임계치 — lib/triage가 사용.
export const AUTO_MERGE_THRESHOLD = 90;
