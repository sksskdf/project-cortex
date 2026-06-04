// Phase 10.4 — Cortex UI 로드맵(DB) → git `.cortex/roadmap.md` 반영(Cortex→git 방향).
// 두 경로: (1) pushRoadmapToGit — 버튼으로 수동 실행. (2) autoSyncRoadmapIfEnabled — UI 편집 시
// 자동(roadmapAutoSyncEnabled 토글 ON 인 프로젝트만, fire-and-forget). 둘 다 같은 고정 롤링
// 브랜치/PR 에 누적(편집마다 새 PR 스팸 방지).
//
// 안전: roadmap.md 만 건드림(project.yml 자동화 토글은 절대 안 씀 — 로컬 DB 전용 원칙 유지) +
// PR 기반(리뷰 가능, default branch 직접 push 아님) + 자동은 opt-in(기본 OFF). 커밋에
// CORTEX_SYNC_MARKER 를 박아 머지 후 push webhook 의 git→Cortex sync 가 skip 되어 무한 루프
// 차단(isCortexSyncCommit, Phase 10.4 기존 구현).

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { upsertFileToBranchPR, getRepoFileContent, type OpenedPR, type RepoRef } from './github';
import { CORTEX_SYNC_MARKER, serializeRoadmapToMd, type SerializableRoadmap } from './project-meta';
import { getProjectRoadmap } from './roadmap';
import { logger } from './logger';

const ROADMAP_PATH = '.cortex/roadmap.md';
// 고정 롤링 브랜치 — 수동·자동 push 모두 같은 브랜치/PR 에 누적(편집마다 새 PR 스팸 방지).
const ROADMAP_SYNC_BRANCH = 'cortex/roadmap-sync';

// DB 로드맵(getProjectRoadmap)을 직렬화 입력 형태로. phase 의 산출물(item)만 — UI 가 편집한 것.
export function loadSerializableRoadmap(projectId: number): SerializableRoadmap {
  const view = getProjectRoadmap(projectId);
  if (!view) return [];
  return view.phases.map((p) => ({
    key: p.key,
    title: p.title,
    goal: p.goal,
    items: p.items.map((it) => ({ title: it.title, status: it.status })),
  }));
}

export type PushRoadmapResult =
  | { kind: 'pushed'; prNumber: number; prUrl: string; branch: string }
  | { kind: 'no-changes' }
  | { kind: 'no-project' }
  | { kind: 'no-installation' }
  | { kind: 'failed'; reason: string };

// 테스트 주입 — null 이면 실제 octokit(upsertFileToBranchPR) 호출.
type PRCreator = (
  installationId: number,
  ref: RepoRef,
  opts: Parameters<typeof upsertFileToBranchPR>[2],
) => Promise<OpenedPR>;
let _prCreator: PRCreator | null = null;
export function setRoadmapPRCreator(fn: PRCreator | null): void {
  _prCreator = fn;
}

export async function pushRoadmapToGit(projectId: number): Promise<PushRoadmapResult> {
  const project = db
    .select({ id: projects.id, slug: projects.slug, installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return { kind: 'no-project' };
  if (project.installationId === null) return { kind: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  const ref: RepoRef = { owner, repo };

  const serialized = serializeRoadmapToMd(loadSerializableRoadmap(projectId));

  // 현재 git(default branch) roadmap.md 와 동일하면 no-op — 불필요한 PR 안 만든다(trim 비교).
  try {
    const current = await getRepoFileContent(project.installationId, ref, ROADMAP_PATH);
    if (current && current.content.trim() === serialized.trim()) return { kind: 'no-changes' };
  } catch (err) {
    return { kind: 'failed', reason: `현재 roadmap.md 조회 실패: ${errMsg(err)}` };
  }

  // CORTEX_SYNC_MARKER trailer — 머지 후 push webhook 이 이 커밋을 Cortex 자신의 것으로 인식해
  // git→Cortex sync 를 skip(무한 루프 방지). 마지막 줄 trailer 형식 유지.
  const commitMessage = `chore: Cortex UI 로드맵 변경을 .cortex/roadmap.md 에 반영\n\n${CORTEX_SYNC_MARKER}`;
  const prBody = [
    'Cortex UI(로드맵 보드)에서 편집한 phase/산출물을 `.cortex/roadmap.md` 에 직렬화해 반영합니다.',
    '',
    '- roadmap.md 만 변경 — 자동화 토글(project.yml)은 건드리지 않습니다.',
    `- 커밋에 \`${CORTEX_SYNC_MARKER}\` 마커가 있어 머지 후 되돌아오는 sync 는 skip 됩니다.`,
    '- 고정 롤링 브랜치라 이후 편집도 이 PR 에 누적됩니다.',
  ].join('\n');

  try {
    const create = _prCreator ?? upsertFileToBranchPR;
    const pr = await create(project.installationId, ref, {
      path: ROADMAP_PATH,
      content: serialized,
      branch: ROADMAP_SYNC_BRANCH,
      commitMessage,
      prTitle: 'Cortex: 로드맵 동기화 (UI → git)',
      prBody,
    });
    return { kind: 'pushed', prNumber: pr.number, prUrl: pr.url, branch: pr.branch };
  } catch (err) {
    return { kind: 'failed', reason: `PR 생성 실패: ${errMsg(err)}` };
  }
}

// Phase 10.4 자동 sync — roadmapAutoSyncEnabled 가 켜진 프로젝트에서 UI 로드맵 편집 후 호출.
// fire-and-forget(best-effort): 실패해도 편집 액션은 성공으로 둔다(로그만). 토글 OFF 면 no-op.
// 같은 롤링 PR 에 누적되므로 편집마다 호출해도 PR 스팸 없음.
export function autoSyncRoadmapIfEnabled(projectId: number): void {
  const project = db
    .select({ enabled: projects.roadmapAutoSyncEnabled })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project || !project.enabled) return;
  void pushRoadmapToGit(projectId)
    .then((r) => {
      if (r.kind === 'failed') {
        logger.error(
          { source: 'roadmap-sync', projectId, reason: r.reason },
          '자동 로드맵 sync 실패',
        );
      }
    })
    .catch((err) => {
      logger.error({ source: 'roadmap-sync', projectId, err }, '자동 로드맵 sync 예외');
    });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
