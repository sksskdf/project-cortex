// Phase 20 — PR 확인(READ)/미확인 마킹. 자동 머지가 늘면서 "이미 머지됐지만 내가 아직 안 본"
// PR 을 추적하기 위함. notifications 의 readAt 패턴과 동일. mark 는 명시적 토글(PR 상세) +
// (후속) 모달에서 앞뒤로 넘기며 READ 처리.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs } from '@/db/schema';

// PR 1건을 확인/미확인으로 표시. read=true → readAt=now, false → readAt=null.
export function markPRRead(prId: number, read: boolean): { updated: number } {
  const result = db
    .update(prs)
    .set({ readAt: read ? new Date() : null, updatedAt: new Date() })
    .where(eq(prs.id, prId))
    .run();
  return { updated: result.changes };
}

// 미확인 머지 PR 수 — "최근 머지" 글랜스 배지용. 머지됐지만 readAt 이 null 인 것만.
export function unreadMergedCount(): number {
  const result = db
    .select({ n: sql<number>`count(*)` })
    .from(prs)
    .where(and(eq(prs.status, 'merged'), isNull(prs.readAt)))
    .get();
  return result?.n ?? 0;
}

// 여러 PR 을 한 번에 확인 처리 (후속 모달에서 일괄/넘김 처리용). 이미 읽은 건 건드리지 않음.
export function markPRsRead(ids: ReadonlyArray<number>): { updated: number } {
  if (ids.length === 0) return { updated: 0 };
  const result = db
    .update(prs)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(prs.id, [...ids]), isNull(prs.readAt)))
    .run();
  return { updated: result.changes };
}
