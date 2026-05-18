// 인박스 우선순위 정렬 — pure function.
// 더 시급한 PR을 앞으로. 기준은 reason tone + 신뢰 점수 + 생성 시각.

import type { PR } from '@/lib/types';

const TONE_RANK: Record<PR['reason']['tone'], number> = {
  alert: 0,
  warn: 1,
  info: 2,
};

function ageMs(pr: PR, now: number): number {
  // PR.ageText는 사람용. 비교는 createdAt 필요하지만 view 모델에 없음.
  // 우선 fallback: ageText 문자열에서 숫자 추출. 정확도 < createdAt 직접 비교.
  // Phase 5.2(integration)에서 lib/inbox가 createdAt을 PR view에 노출하면 그걸 사용.
  void now;
  const m = pr.ageText.match(/(\d+)\s*(분|시간|일)\s*전/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === '분') return n * 60_000;
  if (unit === '시간') return n * 60 * 60_000;
  return n * 24 * 60 * 60_000;
}

// 우선순위:
// 1. reason.tone: alert → warn → info
// 2. gauge.value 오름차순 (낮을수록 위험)
// 3. age 내림차순 (오래된 것 위로 — FIFO)
export function orderInbox(prs: ReadonlyArray<PR>): PR[] {
  const now = Date.now();
  return [...prs].sort((a, b) => {
    const toneDiff = TONE_RANK[a.reason.tone] - TONE_RANK[b.reason.tone];
    if (toneDiff !== 0) return toneDiff;

    const gaugeDiff = a.gauge.value - b.gauge.value;
    if (gaugeDiff !== 0) return gaugeDiff;

    return ageMs(b, now) - ageMs(a, now);
  });
}
