// notes 검색 preview 헬퍼. DB import X — 클라이언트 + 서버 양쪽 사용 가능.
// notes.ts 가 @/db/client (node:fs) 를 끌고 와서 클라이언트 컴포넌트에서 직접
// 임포트 불가. 순수 문자열 함수만 별도 파일.

export function previewWithMatch(body: string, query: string): string {
  if (!query) return body.slice(0, 120);
  const lower = body.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx < 0) return body.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + query.length + 80);
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
}
