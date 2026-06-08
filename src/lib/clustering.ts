// 클러스터 관리 — 활성 클러스터 해체(`dissolveCluster`)와 일괄 머지(`mergeCluster`).
//
// 자동 클러스터링(자카드 유사도 기반 `tryClusterPR`, 임계값 상수들)은 검수 P2-9 에서 삭제:
// 사용자 시그널 누적상 자동 묶임이 가치 대비 컨텍스트 부담 컸음(설명 X 데이터 X 통계 0). 단,
// 기존에 만들어진 클러스터의 **수동 조회/해체/머지** 는 그대로 유지(사이드바 외부 라우트 유지).
// 자동화 트리거가 없어 새 클러스터는 안 생기고, 기존 것만 자연 소진된다.

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { clusters, projects, prs } from '@/db/schema';
import { deletePRHeadBranch, mergePR } from './github';
import { createNotification } from './notifications';

// 클러스터 해체 — 활성 PR (open/review-needed/auto-mergeable) 만 clusterId/status 를
// 인박스로 되돌리고, merged/closed PR 은 그대로 둔다 (해체로 인해 되살아나면 안 됨).
// 사람이 cluster 화면에서 "해체" 버튼 눌렀을 때.
export function dissolveCluster(clusterId: number): { released: number } {
  // 해체 시점 박제 — 과거엔 자동 재클러스터링 cooldown 가드였음. 자동 트리거가 사라진 지금은
  // 단순 감사 흔적(언제 사람이 해체했는지). 컬럼은 보존(스키마 변경 회피 + 후속 부활 시 활용).
  const dissolvedAt = new Date();
  const released = db
    .update(prs)
    .set({
      clusterId: null,
      status: 'review-needed',
      clusterDissolvedAt: dissolvedAt,
      updatedAt: dissolvedAt,
    })
    .where(
      and(
        eq(prs.clusterId, clusterId),
        inArray(prs.status, ['open', 'review-needed', 'auto-mergeable']),
      ),
    )
    .returning({ id: prs.id })
    .all();

  db.update(clusters)
    .set({ status: 'dissolved', closedAt: dissolvedAt })
    .where(eq(clusters.id, clusterId))
    .run();

  return { released: released.length };
}

// 일괄 머지 결과 — 사람이 cluster 화면에서 "전체 머지" 버튼 눌렀을 때.
// PR 별 결과를 details 에 모아 UI 가 부분 실패도 명확히 보여줄 수 있게 한다.
// branches 는 머지 성공 PR 들에 대한 head 브랜치 삭제 결과 — fork/cross-repo 는 skip.
export type ClusterMergeResult = {
  merged: number;
  failed: number;
  skipped: number;
  total: number;
  details: ReadonlyArray<ClusterMergePRResult>;
  branches: {
    deleted: number;
    skipped: number;
    failed: number;
  };
};

export type ClusterMergePRResult =
  | { prId: number; number: number; kind: 'merged'; sha: string }
  | { prId: number; number: number; kind: 'skipped'; reason: ClusterMergeSkipReason }
  | { prId: number; number: number; kind: 'failed'; reason: string };

export type ClusterMergeSkipReason =
  | 'already-merged'
  | 'pr-closed'
  | 'no-installation'
  | 'no-project';

// PR 1건씩 GitHub 머지 호출 — 부분 실패를 허용하고 클러스터 status 를 결과에 맞게 갱신.
// 전부 성공 → 'merged', 일부 성공 → 'partially-merged', 전부 실패 → 'open' 유지.
export async function mergeCluster(clusterId: number): Promise<ClusterMergeResult> {
  const rows = db
    .select({ pr: prs, project: projects })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .where(eq(prs.clusterId, clusterId))
    .all();

  const details: ClusterMergePRResult[] = [];
  for (const { pr, project } of rows) {
    if (pr.status === 'merged') {
      details.push({ prId: pr.id, number: pr.number, kind: 'skipped', reason: 'already-merged' });
      continue;
    }
    if (pr.status === 'closed') {
      details.push({ prId: pr.id, number: pr.number, kind: 'skipped', reason: 'pr-closed' });
      continue;
    }
    if (project.installationId === null) {
      details.push({
        prId: pr.id,
        number: pr.number,
        kind: 'skipped',
        reason: 'no-installation',
      });
      continue;
    }

    const [owner, repo] = project.slug.split('/');
    try {
      // commitTitle 미전송 — GitHub default ('<PR title> (#<number>)') 그대로.
      const result = await mergePR(project.installationId, { owner, repo }, pr.number, {
        method: 'squash',
      });
      if (!result.merged) {
        details.push({
          prId: pr.id,
          number: pr.number,
          kind: 'failed',
          reason: 'GitHub 머지 거부 — merged=false 반환.',
        });
        continue;
      }
      db.update(prs)
        .set({ status: 'merged', updatedAt: new Date() })
        .where(eq(prs.id, pr.id))
        .run();
      details.push({ prId: pr.id, number: pr.number, kind: 'merged', sha: result.sha });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      details.push({ prId: pr.id, number: pr.number, kind: 'failed', reason: message });
    }
  }

  const merged = details.filter((d) => d.kind === 'merged').length;
  const failed = details.filter((d) => d.kind === 'failed').length;
  const skipped = details.filter((d) => d.kind === 'skipped').length;
  const total = details.length;

  // 머지 결과에 따른 클러스터 status 갱신.
  // total === 0 이면 클러스터에 PR 자체가 없는 비정상 — open 유지.
  if (total > 0 && merged === total) {
    db.update(clusters)
      .set({ status: 'merged', closedAt: new Date() })
      .where(eq(clusters.id, clusterId))
      .run();
  } else if (merged > 0) {
    db.update(clusters).set({ status: 'partially-merged' }).where(eq(clusters.id, clusterId)).run();
  }

  // 머지 성공한 PR 의 head 브랜치 일괄 삭제. fork/cross-repo skip.
  // 성공 시 prs.branchDeletedAt 기록 — PR 상세 재방문 시 버튼 disable 일관성.
  const branches = { deleted: 0, skipped: 0, failed: 0 };
  const mergedRows = details.filter(
    (d): d is Extract<ClusterMergePRResult, { kind: 'merged' }> => d.kind === 'merged',
  );
  for (const m of mergedRows) {
    const row = rows.find((r) => r.pr.id === m.prId);
    if (!row || row.project.installationId === null) {
      branches.skipped++;
      continue;
    }
    // 브랜치 자동 삭제 토글 OFF 면 건너뜀 (회사 레포 보호). 디폴트 OFF.
    if (!row.project.autoDeleteBranchEnabled) {
      branches.skipped++;
      continue;
    }
    const [owner, repo] = row.project.slug.split('/');
    try {
      const r = await deletePRHeadBranch(row.project.installationId, { owner, repo }, m.number);
      if (r.kind === 'deleted') {
        db.update(prs).set({ branchDeletedAt: new Date() }).where(eq(prs.id, m.prId)).run();
        branches.deleted++;
      } else {
        branches.skipped++;
      }
    } catch (err) {
      console.error(`deletePRHeadBranch failed for PR ${m.prId}:`, err);
      branches.failed++;
    }
  }

  return { merged, failed, skipped, total, details, branches };
}
