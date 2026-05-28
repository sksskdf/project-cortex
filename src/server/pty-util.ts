// Phase 13.4 — pty.ts 의 순수 헬퍼 분리 (node-pty/ws/db 의존 없음 → 단위 테스트 가능).
// pty.ts 는 이 모듈을 import 해서 동일하게 동작한다 (런타임 변경 없는 순수 리팩터).

// 세션 이름 최대 길이 (문자).
export const MAX_NAME = 60;
// 터미널 cols/rows 클램프 상한.
export const MAX_DIM = 500;

// 제어문자 제거 + 트림 + 길이 제한. 비면 빈 문자열 (호출측이 기본값 처리).
export function sanitizeName(raw: string | null, maxLen: number = MAX_NAME): string {
  if (!raw) return '';
  // eslint-disable-next-line no-control-regex
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLen);
}

// 정수 클램프 — 유한수가 아니면 fallback, 그 외 [1, max] 로 제한 (floor 후).
export function clampInt(n: number, fallback: number, max: number = MAX_DIM): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

// 문자열 dim 파싱 후 클램프 — null/비숫자는 fallback 으로.
export function clampDim(raw: string | null, fallback: number, max: number = MAX_DIM): number {
  return clampInt(raw === null ? Number.NaN : Number(raw), fallback, max);
}

// 세션 메타 정렬 — 최근 활동(lastActivityAt) 순, 활성 세션이 위로. 입력을 변형하지 않는다.
export function sortSessionMetaByActivity<T extends { lastActivityAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
