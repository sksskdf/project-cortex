// Phase 6.1 — 새 PR 이 들어오면 비슷한 최근 PR 과 자카드 유사도를 비교해
// 3건 이상 매칭되면 자동으로 클러스터를 생성/조인한다.
// 임베딩 기반 의미 유사도는 Phase 6.2 후속.

import { and, eq, gte, inArray, ne, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, preReviews, prs } from '@/db/schema';

// 클러스터링에서 제외해야 하는 차단 플래그 — DOMAIN §4 와 동일.
// payment-domain 등 강한 위험이 있는 PR 은 개별 검토.
const NON_CLUSTERABLE_FLAGS = new Set([
  'payment-domain',
  'auth-domain',
  'migration',
  'security-sensitive',
  'external-api-new',
]);

// 자카드 유사도 임계치 — ROADMAP DoD.
export const SIMILARITY_THRESHOLD = 0.85;
// 클러스터 형성 최소 PR 수 — ROADMAP DoD.
export const MIN_CLUSTER_SIZE = 3;
// 후보 검색 시간 윈도우 (밀리초) — ROADMAP DoD: 24시간.
export const CLUSTER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function jaccardSimilarity(a: ReadonlyArray<string>, b: ReadonlyArray<string>): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersect = 0;
  for (const x of sa) if (sb.has(x)) intersect++;
  const union = sa.size + sb.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function hasBlockingFlag(flags: ReadonlyArray<string>): boolean {
  return flags.some((f) => NON_CLUSTERABLE_FLAGS.has(f));
}

export type TryClusterResult =
  | { kind: 'clustered'; clusterId: number; size: number }
  | { kind: 'joined'; clusterId: number; size: number }
  | {
      kind: 'skipped';
      reason: 'no-pr' | 'no-pre-review' | 'blocking-flag' | 'already-clustered' | 'no-similar-prs';
    };

// PR 1건에 대해 클러스터 자동 시도. 멱등 — 이미 클러스터된 PR 은 skip.
// 호출 시점: sync.ts 의 runTriage 후, human-review 결정일 때.
export async function tryClusterPR(prId: number): Promise<TryClusterResult> {
  const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
  if (!pr) return { kind: 'skipped', reason: 'no-pr' };
  if (pr.clusterId !== null) return { kind: 'skipped', reason: 'already-clustered' };

  const preReview = db
    .select()
    .from(preReviews)
    .where(and(eq(preReviews.prId, prId), eq(preReviews.headSha, pr.headSha)))
    .get();
  if (!preReview) return { kind: 'skipped', reason: 'no-pre-review' };

  if (hasBlockingFlag(preReview.flags)) {
    return { kind: 'skipped', reason: 'blocking-flag' };
  }

  // 후보: 같은 레포 · 같은 작성자 · 24시간 이내 · 미클러스터 · open 또는 review-needed.
  const windowStart = new Date(Date.now() - CLUSTER_WINDOW_MS);
  const candidates = db
    .select({ pr: prs, preReview: preReviews })
    .from(prs)
    .innerJoin(preReviews, and(eq(preReviews.prId, prs.id), eq(preReviews.headSha, prs.headSha)))
    .where(
      and(
        eq(prs.repoId, pr.repoId),
        eq(prs.authorId, pr.authorId),
        ne(prs.id, prId),
        gte(prs.createdAt, windowStart),
        inArray(prs.status, ['open', 'review-needed']),
        isNull(prs.clusterId),
      ),
    )
    .all();

  const similar = candidates.filter((c) => {
    if (hasBlockingFlag(c.preReview.flags)) return false;
    return (
      jaccardSimilarity(preReview.changedPaths, c.preReview.changedPaths) >= SIMILARITY_THRESHOLD
    );
  });

  // 자기 자신 + 유사한 후보 = 총 클러스터 크기.
  const totalSize = similar.length + 1;
  if (totalSize < MIN_CLUSTER_SIZE) {
    return { kind: 'skipped', reason: 'no-similar-prs' };
  }

  // 후보 중 이미 클러스터에 속한 PR 이 있는지 다시 확인 (race 방어).
  // 후보 쿼리는 isNull(clusterId) 라서 거의 발생 안 함 — 멱등 안전망.
  const existingCluster = similar.find((c) => c.pr.clusterId !== null)?.pr.clusterId ?? null;

  if (existingCluster !== null) {
    db.update(prs)
      .set({ clusterId: existingCluster, updatedAt: new Date() })
      .where(eq(prs.id, prId))
      .run();
    return { kind: 'joined', clusterId: existingCluster, size: totalSize };
  }

  // 새 클러스터 생성. 평균 신뢰도 + 대표 path 로 title 구성.
  const allConfidences = [preReview.confidence, ...similar.map((c) => c.preReview.confidence)];
  const avgConfidence = Math.round(
    allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length,
  );
  const representativePath = preReview.changedPaths[0] ?? 'changes';
  const pattern = `auto-${pr.repoId}-${Date.now()}`;
  const title = `${representativePath} 외 ${totalSize - 1}건 유사 변경`;

  const newCluster = db
    .insert(clusters)
    .values({
      pattern,
      title,
      avgConfidence,
      status: 'open',
    })
    .returning({ id: clusters.id })
    .get();

  const idsToAssign = [prId, ...similar.map((c) => c.pr.id)];
  db.update(prs)
    .set({ clusterId: newCluster.id, updatedAt: new Date() })
    .where(inArray(prs.id, idsToAssign))
    .run();

  return { kind: 'clustered', clusterId: newCluster.id, size: totalSize };
}

// 클러스터 해체 — 모든 PR 의 clusterId 를 null 로, 클러스터 status='dissolved'.
// 사람이 cluster 화면에서 "해체" 버튼 눌렀을 때.
export function dissolveCluster(clusterId: number): { released: number } {
  const released = db
    .update(prs)
    .set({ clusterId: null, status: 'review-needed', updatedAt: new Date() })
    .where(eq(prs.clusterId, clusterId))
    .returning({ id: prs.id })
    .all();

  db.update(clusters)
    .set({ status: 'dissolved', closedAt: new Date() })
    .where(eq(clusters.id, clusterId))
    .run();

  return { released: released.length };
}
