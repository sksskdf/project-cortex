// Phase 10.4 — Cortex UI 로드맵(DB) → git `.cortex/roadmap.md` 되돌리기. **수동·PR 기반**.
// 사용자가 RoadmapBoard 에서 phase/item 을 편집한 결과(DB)를 git 으로 PR 로 올린다.
//
// 자동 양방향 sync 와는 다름(사용자가 비채택): 이건 버튼으로 명시 실행 + PR 로 리뷰 가능 +
// roadmap.md 만 건드림(project.yml 자동화 토글은 절대 안 씀 — 로컬 DB 전용 원칙 유지).
// 커밋에 CORTEX_SYNC_MARKER 를 박아, 머지 후 push webhook 의 git→Cortex sync 가 skip 되어
// Cortex→git→Cortex 무한 루프가 안 생긴다(isCortexSyncCommit, Phase 10.4 기존 구현).

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { commitFileAndOpenPR, getRepoFileContent, type OpenedPR, type RepoRef } from './github';
import { CORTEX_SYNC_MARKER, serializeRoadmapToMd, type SerializableRoadmap } from './project-meta';
import { getProjectRoadmap } from './roadmap';

const ROADMAP_PATH = '.cortex/roadmap.md';

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

// 테스트 주입 — null 이면 실제 octokit(commitFileAndOpenPR) 호출.
type PRCreator = (
  installationId: number,
  ref: RepoRef,
  opts: Parameters<typeof commitFileAndOpenPR>[2],
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

  // 현재 git roadmap.md 와 동일하면 no-op — 불필요한 PR 안 만든다(trim 비교: 끝 개행 차이 무시).
  let existingSha: string | null = null;
  try {
    const current = await getRepoFileContent(project.installationId, ref, ROADMAP_PATH);
    if (current) {
      existingSha = current.sha;
      if (current.content.trim() === serialized.trim()) return { kind: 'no-changes' };
    }
  } catch (err) {
    return { kind: 'failed', reason: `현재 roadmap.md 조회 실패: ${errMsg(err)}` };
  }

  const branch = `cortex/roadmap-sync-${Date.now()}`;
  // CORTEX_SYNC_MARKER trailer — 머지 후 push webhook 이 이 커밋을 Cortex 자신의 것으로 인식해
  // git→Cortex sync 를 skip(무한 루프 방지). 마지막 줄 trailer 형식 유지.
  const commitMessage = `chore: Cortex UI 로드맵 변경을 .cortex/roadmap.md 에 반영\n\n${CORTEX_SYNC_MARKER}`;
  const prBody = [
    'Cortex UI(로드맵 보드)에서 편집한 phase/산출물을 `.cortex/roadmap.md` 에 직렬화해 반영합니다.',
    '',
    '- 수동 실행(버튼). roadmap.md 만 변경 — 자동화 토글(project.yml)은 건드리지 않습니다.',
    `- 커밋에 \`${CORTEX_SYNC_MARKER}\` 마커가 있어 머지 후 되돌아오는 sync 는 skip 됩니다.`,
  ].join('\n');

  try {
    const create = _prCreator ?? commitFileAndOpenPR;
    const pr = await create(project.installationId, ref, {
      path: ROADMAP_PATH,
      content: serialized,
      branch,
      commitMessage,
      prTitle: 'Cortex: 로드맵 동기화 (UI → git)',
      prBody,
      existingSha,
    });
    return { kind: 'pushed', prNumber: pr.number, prUrl: pr.url, branch: pr.branch };
  } catch (err) {
    return { kind: 'failed', reason: `PR 생성 실패: ${errMsg(err)}` };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
