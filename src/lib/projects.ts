// 등록된 프로젝트 (레포) 의 자동 머지 정책 토글 + Phase 8 의 /projects 화면용 통계.
// installation 있는 프로젝트만 노출 (seed 데이터 제외).

import { and, asc, avg, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects } from '@/db/schema';
import { attemptAutoMerge } from './auto-merge';
import { runTriage } from './triage';

export type ProjectAutoMergeRow = {
  id: number;
  slug: string;
  name: string;
  autoMergeEnabled: boolean;
};

// settings UI 에 노출할 목록 — installation 있는 프로젝트만.
// 시드/데모 프로젝트는 자동 머지가 의미 없어 (GitHub API 호출 불가) 숨김.
export function listAutoMergeProjects(): ProjectAutoMergeRow[] {
  return db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      autoMergeEnabled: projects.autoMergeEnabled,
    })
    .from(projects)
    .where(isNotNull(projects.installationId))
    .orderBy(asc(projects.slug))
    .all();
}

// 단건 토글. installation 없는 행은 의도적으로 거부 (UI 가 애초에 노출 안 함).
// retriagedPrIds — 토글 ON 으로 바뀐 경우 활성 PR 들 재트라이아지 수. 토글 OFF 일 땐 0.
export type ToggleAutoMergeResult =
  | { kind: 'updated'; row: ProjectAutoMergeRow; retriagedPrIds: number[] }
  | { kind: 'not-found' };

export async function setProjectAutoMerge(
  id: number,
  enabled: boolean,
): Promise<ToggleAutoMergeResult> {
  const existing = db
    .select({ installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.id, id))
    .get();
  if (!existing || existing.installationId === null) {
    return { kind: 'not-found' };
  }
  const row = db
    .update(projects)
    .set({ autoMergeEnabled: enabled })
    .where(eq(projects.id, id))
    .returning({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      autoMergeEnabled: projects.autoMergeEnabled,
    })
    .get();

  // ON 으로 바뀌면 활성 PR (open · review-needed · auto-mergeable) 들을 일괄 재트라이아지
  // → triage_decisions.reason 갱신 + 5조건 통과 시 즉시 auto-merge 시도. OFF 일 땐 안 함
  // (다음 webhook 에서 자연스럽게 review-needed 로 떨어짐).
  const retriagedPrIds: number[] = [];
  if (enabled) {
    const activePRs = db
      .select({ id: prs.id })
      .from(prs)
      .where(
        and(eq(prs.repoId, id), inArray(prs.status, ['open', 'review-needed', 'auto-mergeable'])),
      )
      .all();
    for (const pr of activePRs) {
      try {
        const triage = await runTriage(pr.id);
        retriagedPrIds.push(pr.id);
        if (triage.kind === 'decided' && triage.decision === 'auto-merge') {
          await attemptAutoMerge(pr.id);
        }
      } catch (err) {
        console.error(`re-triage failed for PR ${pr.id} after auto-merge toggle:`, err);
      }
    }
  }

  return { kind: 'updated', row, retriagedPrIds };
}

// Phase 8 — /projects 화면용 프로젝트 통계.
// 각 프로젝트 별 PR 카운트 / 머지 카운트 / 평균 신뢰 점수.
export type ProjectStatsRow = {
  id: number;
  slug: string;
  name: string;
  installationId: number | null;
  autoMergeEnabled: boolean;
  autoDeleteBranchEnabled: boolean;
  // 활성 PR (open/review-needed/auto-mergeable) — 인박스 + 클러스터 합계.
  activePRs: number;
  // 머지된 PR 누적.
  mergedPRs: number;
  // 분석된 PR 들의 평균 신뢰 점수 (0 이면 분석된 PR 없음).
  avgConfidence: number;
};

export function listProjectsWithStats(): ProjectStatsRow[] {
  const rows = db
    .select({
      id: projects.id,
      slug: projects.slug,
      name: projects.name,
      installationId: projects.installationId,
      autoMergeEnabled: projects.autoMergeEnabled,
      autoDeleteBranchEnabled: projects.autoDeleteBranchEnabled,
    })
    .from(projects)
    .orderBy(asc(projects.slug))
    .all();

  return rows.map((r) => {
    const activeRow = db
      .select({ n: count() })
      .from(prs)
      .where(
        and(eq(prs.repoId, r.id), inArray(prs.status, ['open', 'review-needed', 'auto-mergeable'])),
      )
      .get();

    const mergedRow = db
      .select({ n: count() })
      .from(prs)
      .where(and(eq(prs.repoId, r.id), eq(prs.status, 'merged')))
      .get();

    // 평균 confidence — 해당 프로젝트의 모든 preReview.
    // (PR 마다 여러 preReview 가 쌓일 수 있지만 평균이라 영향 적음.)
    const avgRow = db
      .select({ a: avg(preReviews.confidence) })
      .from(preReviews)
      .innerJoin(prs, eq(preReviews.prId, prs.id))
      .where(eq(prs.repoId, r.id))
      .get();

    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      installationId: r.installationId,
      autoMergeEnabled: r.autoMergeEnabled,
      autoDeleteBranchEnabled: r.autoDeleteBranchEnabled,
      activePRs: activeRow?.n ?? 0,
      mergedPRs: mergedRow?.n ?? 0,
      avgConfidence: Math.round(Number(avgRow?.a ?? 0)),
    };
  });
}

// 브랜치 자동 삭제 토글. installation 있는 프로젝트만 (UI 가 노출하는 카드 기준).
export type ToggleBranchDeleteResult =
  | { kind: 'updated'; id: number; enabled: boolean }
  | { kind: 'not-found' };

export function setProjectAutoDeleteBranch(id: number, enabled: boolean): ToggleBranchDeleteResult {
  const existing = db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get();
  if (!existing) return { kind: 'not-found' };
  db.update(projects).set({ autoDeleteBranchEnabled: enabled }).where(eq(projects.id, id)).run();
  return { kind: 'updated', id, enabled };
}

// Phase 8 — 수동 레포 등록 (인테이크 마법사).
// 자동 onboard 와 별개: webhook 도착 전이거나 App 미설치 상태에서도 사용자가 직접
// projects 행 생성. installationId=null + autoMergeEnabled=false 로 시작.
// 후속 webhook 도착 시 handlePullRequestWebhook 의 자동 onboard 로직이 installationId
// 채움 (slug 매칭) — 코드 추가 변경 없이 흐름이 자연 합쳐짐.
const SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export type AddProjectResult =
  | { kind: 'added'; id: number }
  | { kind: 'invalid-slug'; reason: string }
  | { kind: 'duplicate'; existingId: number };

export function addProjectManually(input: { slug: string; name?: string }): AddProjectResult {
  const slug = input.slug.trim();
  if (slug.length === 0) return { kind: 'invalid-slug', reason: 'slug 가 비어있습니다.' };
  if (!SLUG_RE.test(slug)) {
    return { kind: 'invalid-slug', reason: 'owner/repo 형식이 아닙니다.' };
  }
  // GitHub slug 제한: 100자 (owner) + 100자 (repo). 안전 마진 250.
  if (slug.length > 250) return { kind: 'invalid-slug', reason: 'slug 가 너무 깁니다.' };

  const existing = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .get();
  if (existing) return { kind: 'duplicate', existingId: existing.id };

  const inserted = db
    .insert(projects)
    .values({
      slug,
      name: input.name?.trim() || slug,
      installationId: null,
      autoMergeEnabled: false,
    })
    .returning({ id: projects.id })
    .get();
  return { kind: 'added', id: inserted.id };
}

// Phase 8 — GitHub App 설치 리포에서 가져온 프로젝트를 installationId 포함해 등록.
// 이미 같은 slug 가 있으면: installationId 가 null 이면 채워서 'linked', 이미 있으면 'already-linked'.
// 수동 등록(installationId=null) 후 import 가 들어와도 자연스럽게 합쳐진다.
export type AddInstalledResult =
  | { kind: 'added'; id: number }
  | { kind: 'linked'; id: number }
  | { kind: 'already-linked'; id: number }
  | { kind: 'invalid-slug'; reason: string };

export function addProjectFromInstallation(input: {
  slug: string;
  name?: string;
  installationId: number;
  // 다중 App — 이 installation 이 속한 App 설정. null/미지정이면 env 단일 App.
  appConfigId?: number | null;
}): AddInstalledResult {
  const slug = input.slug.trim();
  if (slug.length === 0) return { kind: 'invalid-slug', reason: 'slug 가 비어있습니다.' };
  if (!SLUG_RE.test(slug)) {
    return { kind: 'invalid-slug', reason: 'owner/repo 형식이 아닙니다.' };
  }
  if (slug.length > 250) return { kind: 'invalid-slug', reason: 'slug 가 너무 깁니다.' };
  if (!Number.isInteger(input.installationId) || input.installationId <= 0) {
    return { kind: 'invalid-slug', reason: 'installationId 가 올바르지 않습니다.' };
  }

  const appConfigId = input.appConfigId ?? null;
  const existing = db
    .select({ id: projects.id, installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.slug, slug))
    .get();
  if (existing) {
    if (existing.installationId === null) {
      db.update(projects)
        .set({ installationId: input.installationId, appConfigId })
        .where(eq(projects.id, existing.id))
        .run();
      return { kind: 'linked', id: existing.id };
    }
    return { kind: 'already-linked', id: existing.id };
  }

  const inserted = db
    .insert(projects)
    .values({
      slug,
      name: input.name?.trim() || slug,
      installationId: input.installationId,
      appConfigId,
      autoMergeEnabled: false,
    })
    .returning({ id: projects.id })
    .get();
  return { kind: 'added', id: inserted.id };
}
