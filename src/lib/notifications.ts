import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, notifications, prs, projects } from '@/db/schema';
import type { NotificationRow } from '@/db/schema';
import { broadcastNotification } from './events';

// 헤더 알림 드롭다운에 보이는 행 한 줄.
export type NotificationKind = NotificationRow['kind'];

export type NotificationView = {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  ageText: string;
  createdAt: Date;
};

// 드롭다운에 한 번에 보여줄 최대 개수. 너무 많으면 스크롤 + 운영 부담 — 일단 30.
const LIST_LIMIT = 30;

// kind 별 클릭 시 이동할 href 매핑. clusterId / prId 가 같이 들어오면 prId 우선.
function buildHref(row: {
  kind: NotificationKind;
  prId: number | null;
  clusterId: number | null;
}): string | null {
  if (row.prId !== null) return `/pr/${row.prId}`;
  if (row.clusterId !== null) return `/cluster/${row.clusterId}`;
  return null;
}

function formatAge(createdAt: Date): string {
  const diffMs = Date.now() - createdAt.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const week = Math.floor(day / 7);
  return `${week}주 전`;
}

export function listRecentNotifications(): NotificationView[] {
  // createdAt 은 초 단위 — 같은 초 내 여러 행은 id DESC 로 안정 정렬.
  const rows = db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(LIST_LIMIT)
    .all();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: buildHref(row),
    read: row.readAt !== null,
    ageText: formatAge(row.createdAt),
    createdAt: row.createdAt,
  }));
}

export function unreadNotificationCount(): number {
  const result = db
    .select({ n: sql<number>`count(*)` })
    .from(notifications)
    .where(isNull(notifications.readAt))
    .get();
  return result?.n ?? 0;
}

export function markNotificationsRead(ids: ReadonlyArray<number>): { updated: number } {
  if (ids.length === 0) return { updated: 0 };
  const result = db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(inArray(notifications.id, [...ids]), isNull(notifications.readAt)))
    .run();
  return { updated: result.changes };
}

export function markAllNotificationsRead(): { updated: number } {
  const result = db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(isNull(notifications.readAt))
    .run();
  return { updated: result.changes };
}

// 이벤트 발생 hook 의 진입점. 호출 측 (auto-merge.ts, sync.ts, clustering.ts) 가
// kind 와 컨텍스트만 넘기면 메시지 구성은 여기서.
export type CreateNotificationInput =
  | { kind: 'auto-merged'; prId: number }
  | { kind: 'auto-merge-failed'; prId: number; reason: string }
  | { kind: 'ci-failed'; prId: number }
  | { kind: 'cluster-created'; clusterId: number; size: number }
  | { kind: 'revert-detected'; prId: number };

// PR / cluster 메타를 한 번에 조회. 없으면 알림 자체를 만들지 않음 (orphan 방지).
export function createNotification(input: CreateNotificationInput): {
  kind: 'created' | 'skipped';
  id?: number;
} {
  if (input.kind === 'cluster-created') {
    const cluster = db
      .select({ id: clusters.id, title: clusters.title })
      .from(clusters)
      .where(eq(clusters.id, input.clusterId))
      .get();
    if (!cluster) return { kind: 'skipped' };
    const title = `새 클러스터: ${cluster.title}`;
    const body = `${input.size}개 PR 이 묶였습니다.`;
    const row = db
      .insert(notifications)
      .values({
        kind: 'cluster-created',
        clusterId: input.clusterId,
        title,
        body,
      })
      .returning({ id: notifications.id })
      .get();
    safeBroadcast({
      kind: 'cluster-created',
      title,
      body,
      href: `/cluster/${input.clusterId}`,
    });
    return { kind: 'created', id: row.id };
  }

  // 나머지 kind 는 모두 prId 기반.
  const pr = db
    .select({
      id: prs.id,
      number: prs.number,
      title: prs.title,
      repoId: prs.repoId,
    })
    .from(prs)
    .where(eq(prs.id, input.prId))
    .get();
  if (!pr) return { kind: 'skipped' };

  const project = db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, pr.repoId))
    .get();
  const slug = project?.slug ?? '';

  const titleAndBody = ((): { title: string; body: string | null } => {
    switch (input.kind) {
      case 'auto-merged':
        return {
          title: `자동 머지 완료 · ${slug} #${pr.number}`,
          body: pr.title,
        };
      case 'auto-merge-failed':
        return {
          title: `자동 머지 실패 · ${slug} #${pr.number}`,
          body: input.reason,
        };
      case 'ci-failed':
        return {
          title: `CI 실패 · ${slug} #${pr.number}`,
          body: pr.title,
        };
      case 'revert-detected':
        return {
          title: `Revert 감지 · ${slug} #${pr.number}`,
          body: pr.title,
        };
    }
  })();

  const row = db
    .insert(notifications)
    .values({
      kind: input.kind,
      prId: pr.id,
      projectId: pr.repoId,
      title: titleAndBody.title,
      body: titleAndBody.body,
    })
    .returning({ id: notifications.id })
    .get();
  safeBroadcast({
    kind: input.kind,
    title: titleAndBody.title,
    body: titleAndBody.body,
    href: `/pr/${pr.id}`,
  });
  return { kind: 'created', id: row.id };
}

// broadcast 실패가 DB 흐름을 망가뜨리지 않게 — best-effort.
function safeBroadcast(payload: {
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
}): void {
  try {
    broadcastNotification(payload);
  } catch (err) {
    console.error('notification broadcast failed:', err);
  }
}

// PR title prefix 검사 — GitHub revert UI 가 만드는 PR 은 "Revert " 로 시작.
// 본문에 "This reverts commit <sha>" 가 있으면 추가 신호. 둘 중 하나만 만족해도 감지.
export function isRevertPR(input: { title: string; body: string | null }): boolean {
  if (input.title.startsWith('Revert ')) return true;
  if (input.body && /This reverts commit [0-9a-f]{7,}/.test(input.body)) return true;
  return false;
}
