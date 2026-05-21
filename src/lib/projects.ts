// 등록된 프로젝트 (레포) 의 자동 머지 정책 토글. Phase 8 인테이크 마법사가 들어오기 전
// 임시 settings UI 에서 사용. installation 있는 프로젝트만 토글 대상 (seed 데이터 제외).

import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
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
