import { and, count, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { currentUser } from '@/lib/config';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import { orderInbox } from '@/lib/queue';
import type { PR, PRRowActionState, ReasonTone, SidebarCounts } from '@/lib/types';

// 행 인라인 액션 활성 여부 — installation 있고 적절한 status + CI 통과/없음 일 때만 머지 활성.
// 머지 성공 시 브랜치 자동 삭제이므로 별도 '브랜치 삭제' 액션 없음.
// testsPassed: null=CI 결과 미수신 (대기 중), false=실패 → 머지 막음. true 또는 CI 없는 레포면 통과.
// mergeable_state (dirty/blocked) 는 인박스 행에서 모름 — DB 캐시 없음, GitHub API 호출은 행마다
// 호출하기엔 무거움. CI 가드만으로 가장 흔한 클릭 시 실패 케이스 차단. 충돌 PR 은 클릭 시
// GitHub 에러 메시지로 안내됨 (의도적 단순화).
export function deriveRowActions(
  status: string,
  installationId: number | null,
  testsPassed: boolean | null,
): PRRowActionState {
  const hasInstall = installationId !== null;
  const active = !['merged', 'closed'].includes(status);
  // installation 없는 시드 PR 은 CI 자체가 없으므로 testsPassed 가드 무관 — canMerge=false 로 어차피 막힘.
  // installation 있는 경우 testsPassed === null/false 면 머지 막음.
  const ciOk = !hasInstall || testsPassed === true;
  return {
    canMerge: hasInstall && active && ciOk,
    canClose: hasInstall && active,
    // ciPending: PR 상세의 mergeBlockedByCI 와 같은 신호 — UI 가 disabled 사유 노출에 사용.
    mergeBlockedByCI: hasInstall && active && !ciOk,
  };
}

export type InboxCategoryId =
  | 'all'
  | 'flagged'
  | 'large'
  | 'migration'
  | 'cluster'
  | 'mentioned'
  | 'done';

export type InboxCategory = {
  id: InboxCategoryId;
  count: number;
};

export type InboxProject = {
  id: string;
  name: string;
  count: number;
  dot: 'blue' | 'green' | 'yellow';
};

export type InboxClusterBanner = {
  id: string;
  title: string;
  description: string;
};

// SQLite 의 timestamp 컬럼은 Drizzle 이 Date 로 변환하지만, 일부 경로에서 number
// (epoch seconds) 가 그대로 흘러옴 — 두 경우 모두 ms 로 통일.
function toMs(t: Date | number | null | undefined): number {
  if (t === null || t === undefined) return 0;
  return t instanceof Date ? t.getTime() : Number(t) * 1000;
}

const PROJECT_DOT: Record<string, InboxProject['dot']> = {
  'cortex-web': 'blue',
  'payments-api': 'green',
  'data-pipeline': 'yellow',
};

export async function getSidebarCounts(): Promise<SidebarCounts> {
  const inboxCount = db
    .select({ n: count() })
    .from(prs)
    .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId)))
    .get();

  const projectsCount = db.select({ n: count() }).from(projects).get();
  const clustersCount = db
    .select({ n: count() })
    .from(clusters)
    .where(eq(clusters.status, 'open'))
    .get();

  // 에이전트 카운트 — agent_runs 없이 활성 PR의 distinct authorKind='agent' authorId로 근사.
  const agents = db
    .selectDistinct({ id: prs.authorId })
    .from(prs)
    .where(eq(prs.authorKind, 'agent'))
    .all();

  return {
    inbox: inboxCount?.n ?? 0,
    projects: projectsCount?.n ?? 0,
    agents: agents.length,
    clusters: clustersCount?.n ?? 0,
  };
}

// 카테고리별 in-memory 필터링. all 외에는 raw 행에서 flag/tone 기준 거름.
// cluster / mentioned 는 인박스 페이지가 별도 라우트 / disable 처리하므로 여기엔 안 잡힘.
// done 은 SQL 단에서 다른 status 로 필터링하므로 통과만.
function passesCategory(
  item: PR,
  raw: { flags: ReadonlyArray<string> },
  category: InboxCategoryId,
): boolean {
  switch (category) {
    case 'all':
    case 'done':
      return true;
    case 'flagged':
      return item.reason.tone === 'alert';
    case 'large':
      return raw.flags.includes('large-change');
    case 'migration':
      return raw.flags.includes('migration');
    case 'mentioned':
      // PR body 에 @<currentUser.githubLogin> 매칭. PR 검색은 SQL where 단계에서 처리하므로
      // 여기는 통과 처리만 — 실제 필터는 baseWhere 에서.
      return true;
    case 'cluster':
      // 인박스 흐름 밖이라 빈 결과. UI 가 사용하지 않음.
      return false;
  }
}

export async function listInboxQueue(
  category: InboxCategoryId = 'all',
  search: string = '',
): Promise<PR[]> {
  // 카테고리에 따라 SQL where 분기:
  // - done: status IN ('merged','closed'), clusterId 무관 (클러스터로 머지된 PR 도 노출).
  // - mentioned: PR body 에 @<currentUser.githubLogin> 매칭 (단순 LIKE — review comments 는 후속).
  // - 그 외: status='review-needed' + 비-클러스터 (인박스 큐 룰).
  const baseWhere =
    category === 'done'
      ? inArray(prs.status, ['merged', 'closed'])
      : category === 'mentioned'
        ? and(
            eq(prs.status, 'review-needed'),
            isNull(prs.clusterId),
            like(prs.body, `%@${currentUser.githubLogin}%`),
          )
        : and(eq(prs.status, 'review-needed'), isNull(prs.clusterId));

  // 검색은 PR 제목 + repo slug 부분 일치 (대소문자 무시 — SQLite 기본 LIKE).
  // 빈 문자열이면 검색 안 함. 트림 후 빈 것도 동일.
  const trimmed = search.trim();
  const whereClause =
    trimmed.length > 0
      ? and(baseWhere, or(like(prs.title, `%${trimmed}%`), like(projects.slug, `%${trimmed}%`)))
      : baseWhere;

  const baseQuery = db
    .select({
      pr: prs,
      preReview: preReviews,
      triage: triageDecisions,
      repoSlug: projects.slug,
      installationId: projects.installationId,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    // 같은 PR 의 과거 SHA 의 preReview 들이 join 결과를 N배로 늘리는 걸 방지 —
    // 현재 PR.headSha 와 매칭되는 preReview (= 최신) 1건만 join.
    .leftJoin(preReviews, and(eq(preReviews.prId, prs.id), eq(preReviews.headSha, prs.headSha)))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(whereClause);
  // done 은 최근 머지/닫힘 순. 다른 카테고리는 orderInbox 가 후처리 정렬.
  const rows = category === 'done' ? baseQuery.orderBy(desc(prs.updatedAt)).all() : baseQuery.all();

  type Decorated = { item: PR; flags: ReadonlyArray<string> };
  const decorated: Decorated[] = rows.map((row) => {
    const confidence = row.preReview?.confidence ?? 0;
    const flags = row.preReview?.flags ?? [];
    // 머지/닫힘 PR (done 카테고리) 은 이미 처리 끝났으므로 위험 강조 stripe 표시 안 함 —
    // 항상 'info' 강제. review-needed 만 reasonTone 로 위험도 표시.
    const isDone = row.pr.status === 'merged' || row.pr.status === 'closed';
    const tone: ReasonTone = isDone ? 'info' : row.triage ? reasonTone(confidence, flags) : 'info';
    // ageText 는 "마지막 활동 시점" — 새 push (synchronize webhook) 시 updatedAt
    // 만 갱신되므로 updatedAt 우선. updatedAt 이 어떤 이유로 빈 행은 createdAt 폴백.
    const activityMs = toMs(row.pr.updatedAt) || toMs(row.pr.createdAt);

    const item: PR = {
      id: `pr-${row.pr.id}`,
      title: row.pr.title,
      repo: row.repoSlug,
      number: row.pr.number,
      author: { name: row.pr.authorId, kind: row.pr.authorKind },
      tags: flagsToTags(flags),
      reason: {
        text: row.triage?.reason ?? row.preReview?.summary ?? '',
        tone,
      },
      additions: row.pr.linesAdded,
      deletions: row.pr.linesRemoved,
      fileCount: row.pr.filesChanged,
      ageText: formatRelativeAge(activityMs),
      gauge: {
        value: confidence,
        tier: gaugeTierFromConfidence(confidence),
      },
      // 행 인라인 액션 활성 여부 — installation 있고 적절한 status + CI 통과일 때만.
      actions: deriveRowActions(row.pr.status, row.installationId, row.pr.testsPassed),
    };
    return { item, flags };
  });

  const filtered = decorated.filter((d) => passesCategory(d.item, { flags: d.flags }, category));
  const items = filtered.map((d) => d.item);
  // done 은 SQL 단에서 updatedAt DESC 정렬 — 입력 순서 유지.
  if (category === 'done') return items;
  // 우선순위 정렬: tone (alert > warn > info) > gauge 낮은 순 > age 오래된 순.
  return [...orderInbox(items)];
}

export async function getInboxCategories(): Promise<InboxCategory[]> {
  const queue = await listInboxQueue();
  const total = queue.length;
  const flagged = queue.filter((p) => p.reason.tone === 'alert').length;
  const large = queue.filter((p) => p.tags.some((tag) => tag.label === '큰 변경')).length;
  const migration = queue.filter((p) => p.tags.some((tag) => tag.label === '마이그레이션')).length;

  const clusterPrs = db
    .select({ n: count() })
    .from(prs)
    .innerJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(triageDecisions.decision, 'cluster'))
    .get();

  const donePrs = db
    .select({ n: count() })
    .from(prs)
    .where(inArray(prs.status, ['merged', 'closed']))
    .get();

  const mentionedPrs = db
    .select({ n: count() })
    .from(prs)
    .where(
      and(
        eq(prs.status, 'review-needed'),
        isNull(prs.clusterId),
        like(prs.body, `%@${currentUser.githubLogin}%`),
      ),
    )
    .get();

  return [
    { id: 'all', count: total },
    { id: 'flagged', count: flagged },
    { id: 'large', count: large },
    { id: 'migration', count: migration },
    { id: 'cluster', count: clusterPrs?.n ?? 0 },
    { id: 'mentioned', count: mentionedPrs?.n ?? 0 },
    { id: 'done', count: donePrs?.n ?? 0 },
  ];
}

export async function getInboxProjects(): Promise<InboxProject[]> {
  const rows = db
    .select({
      slug: projects.slug,
      name: projects.name,
      n: count(prs.id),
    })
    .from(projects)
    .leftJoin(prs, eq(prs.repoId, projects.id))
    .groupBy(projects.id, projects.slug, projects.name)
    .orderBy(desc(count(prs.id)))
    .all();

  return rows
    .filter((r) => r.n > 0)
    .map((r) => ({
      id: r.slug,
      name: r.slug,
      count: r.n,
      dot: PROJECT_DOT[r.slug] ?? 'blue',
    }));
}

export async function getInboxClusterBanner(): Promise<InboxClusterBanner | null> {
  const cluster = db
    .select()
    .from(clusters)
    .where(eq(clusters.status, 'open'))
    .orderBy(desc(clusters.createdAt))
    .get();

  if (!cluster) return null;

  const prCount = db.select({ n: count() }).from(prs).where(eq(prs.clusterId, cluster.id)).get();

  const total = prCount?.n ?? 0;

  return {
    id: `cluster-${cluster.id}`,
    title: `${cluster.title} — ${total}건이 묶였어요`,
    description: `평균 신뢰 ${cluster.avgConfidence} · 한 번의 결정으로 ${total}개 PR을 처리할 수 있습니다`,
  };
}
