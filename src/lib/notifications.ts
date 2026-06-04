import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, notifications, prs, projects } from '@/db/schema';
import type { NotificationRow } from '@/db/schema';
import { broadcastNotification } from './events';

// workspace-pulled/failed 중복 알림 dedupe 창 — 이 안의 같은 kind+project 알림은 1건으로 collapse.
const WORKSPACE_DEDUPE_MS = 2 * 60 * 1000;

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
  | { kind: 'revert-detected'; prId: number }
  // 자동화별 전용 알림 — 기존엔 모두 'auto-merge-failed' 재사용이라 무엇이 실패/성공했는지
  // 구분 불가했음. 성공 알림은 "Cortex 가 무언가 자동으로 했다"는 가시성 (이전엔 조용).
  | { kind: 'analysis-failed'; prId: number; reason: string }
  | { kind: 'conflict-resolved'; prId: number }
  | { kind: 'conflict-resolve-failed'; prId: number; reason: string }
  | { kind: 'tests-fixed'; prId: number }
  | { kind: 'test-fix-failed'; prId: number; reason: string }
  | { kind: 'review-addressed'; prId: number }
  | { kind: 'review-fix-failed'; prId: number; reason: string }
  // 머지 후 워크스페이스 자동 git pull 결과 — 조용히 돌던 걸 표면화(가시성).
  | { kind: 'workspace-pulled'; prId: number }
  | { kind: 'workspace-pull-failed'; prId: number; reason: string };

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
      case 'analysis-failed':
        return {
          title: `AI 사전 리뷰 실패 · ${slug} #${pr.number}`,
          body: input.reason,
        };
      case 'conflict-resolved':
        return {
          title: `충돌 자동 해결됨 · ${slug} #${pr.number}`,
          body: pr.title,
        };
      case 'conflict-resolve-failed':
        return {
          title: `충돌 자동 해결 실패 · ${slug} #${pr.number}`,
          body: input.reason,
        };
      case 'tests-fixed':
        return {
          title: `테스트 자동 수정됨 · ${slug} #${pr.number}`,
          body: pr.title,
        };
      case 'test-fix-failed':
        return {
          title: `테스트 자동 수정 실패 · ${slug} #${pr.number}`,
          body: input.reason,
        };
      case 'review-addressed':
        return {
          title: `리뷰 자동 반영됨 · ${slug} #${pr.number}`,
          body: pr.title,
        };
      case 'review-fix-failed':
        return {
          title: `리뷰 자동 반영 실패 · ${slug} #${pr.number}`,
          body: input.reason,
        };
      case 'workspace-pulled':
        return {
          title: `워크스페이스 자동 업데이트 · ${slug}`,
          body: `머지 후 로컬 워크스페이스를 git pull 했습니다.`,
        };
      case 'workspace-pull-failed':
        return {
          title: `워크스페이스 자동 pull 실패 · ${slug}`,
          body: input.reason,
        };
    }
  })();

  // workspace-pulled/failed 는 per-repo 부작용 — 같은 repo 의 여러 PR 이 연달아 머지되면 동일한
  // git 상태에 대해 같은 알림이 반복돼 인박스를 스팸한다(리뷰 발견: 5 PR 머지 → 5 알림). 최근
  // WORKSPACE_DEDUPE_MS 안에 같은 kind+project 알림이 있으면 skip. (prId 가 달라 id 기준 dedupe
  // 로는 안 잡혀 project 단위로 본다.) 다른 kind(per-PR 알림)는 prId 가 달라 자연히 구분됨.
  if (input.kind === 'workspace-pulled' || input.kind === 'workspace-pull-failed') {
    const since = new Date(Date.now() - WORKSPACE_DEDUPE_MS);
    const recent = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.kind, input.kind),
          eq(notifications.projectId, pr.repoId),
          gte(notifications.createdAt, since),
        ),
      )
      .get();
    if (recent) return { kind: 'skipped' };
  }

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
