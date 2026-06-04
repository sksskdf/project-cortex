import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { projects, roadmapItems, roadmapPhases } from '@/db/schema';
import { setOctokit } from './github';
import { CORTEX_SYNC_MARKER, serializeRoadmapToMd } from './project-meta';
import {
  loadSerializableRoadmap,
  pushRoadmapToGit,
  setRoadmapPRCreator,
  type PushRoadmapResult,
} from './roadmap-sync';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(roadmapItems).run();
  db.delete(roadmapPhases).run();
  db.delete(projects).run();
});

afterEach(() => {
  setOctokit(null);
  setRoadmapPRCreator(null);
});

function seedProject(opts: { installationId?: number | null } = {}): number {
  return db
    .insert(projects)
    .values({
      slug: 'acme/web',
      name: 'web',
      installationId: opts.installationId === undefined ? 12345 : opts.installationId,
    })
    .returning({ id: projects.id })
    .get().id;
}

function seedPhaseWithItems(
  projectId: number,
  key: string,
  title: string,
  items: Array<{ title: string; status: 'planned' | 'in-progress' | 'done' }>,
) {
  const phase = db
    .insert(roadmapPhases)
    .values({ projectId, key, title, source: 'git', sortOrder: 0 })
    .returning({ id: roadmapPhases.id })
    .get();
  items.forEach((it, i) => {
    db.insert(roadmapItems)
      .values({
        phaseId: phase.id,
        title: it.title,
        status: it.status,
        source: 'git',
        sortOrder: i,
      })
      .run();
  });
}

// 현재 git roadmap.md 응답을 주는 mock octokit (getRepoFileContent 경로).
function mockGitContent(content: string | null): Octokit {
  return {
    repos: {
      getContent: vi.fn().mockImplementation(async () => {
        if (content === null) throw Object.assign(new Error('not found'), { status: 404 });
        return {
          data: { type: 'file', content: Buffer.from(content).toString('base64'), sha: 'sha-cur' },
        };
      }),
    },
  } as unknown as Octokit;
}

describe('loadSerializableRoadmap', () => {
  it('DB phase/item 을 직렬화 입력 형태로 — status 포함', () => {
    const projectId = seedProject();
    seedPhaseWithItems(projectId, '4.7', 'AI 리뷰', [
      { title: '정확도', status: 'in-progress' },
      { title: '평가셋', status: 'planned' },
    ]);
    const r = loadSerializableRoadmap(projectId);
    expect(r).toEqual([
      {
        key: '4.7',
        title: 'AI 리뷰',
        goal: null,
        items: [
          { title: '정확도', status: 'in-progress' },
          { title: '평가셋', status: 'planned' },
        ],
      },
    ]);
  });

  it('없는 프로젝트는 빈 배열', () => {
    expect(loadSerializableRoadmap(9999)).toEqual([]);
  });
});

describe('pushRoadmapToGit', () => {
  it('no-project / no-installation 가드', async () => {
    expect((await pushRoadmapToGit(9999)).kind).toBe('no-project');
    const p = seedProject({ installationId: null });
    expect((await pushRoadmapToGit(p)).kind).toBe('no-installation');
  });

  it('git 과 동일하면 no-changes (불필요 PR 안 만듦)', async () => {
    const projectId = seedProject();
    seedPhaseWithItems(projectId, '1', 'P1', [{ title: 'a', status: 'done' }]);
    // 현재 git 내용 = 직렬화 결과와 동일하게 세팅.
    const serialized = serializeRoadmapToMd(loadSerializableRoadmap(projectId));
    setOctokit(mockGitContent(serialized));
    const prCreator = vi.fn();
    setRoadmapPRCreator(prCreator);

    const r = await pushRoadmapToGit(projectId);
    expect(r.kind).toBe('no-changes');
    expect(prCreator).not.toHaveBeenCalled(); // PR 생성 안 함
  });

  it('변경 있으면 PR 생성 — 직렬화 내용 + CORTEX_SYNC_MARKER 커밋', async () => {
    const projectId = seedProject();
    seedPhaseWithItems(projectId, '1', 'P1', [{ title: 'new item', status: 'in-progress' }]);
    setOctokit(mockGitContent('# Roadmap\n\n## Phase 0 — 옛 내용\n')); // 다른 내용

    let captured: Parameters<NonNullable<Parameters<typeof setRoadmapPRCreator>[0]>>[2] | null =
      null;
    setRoadmapPRCreator(async (_inst, _ref, opts) => {
      captured = opts;
      return { number: 77, url: 'https://github.com/acme/web/pull/77', branch: opts.branch };
    });

    const r = (await pushRoadmapToGit(projectId)) as Extract<PushRoadmapResult, { kind: 'pushed' }>;
    expect(r.kind).toBe('pushed');
    expect(r.prNumber).toBe(77);
    expect(captured).not.toBeNull();
    const opts = captured!;
    expect(opts.path).toBe('.cortex/roadmap.md');
    expect(opts.existingSha).toBe('sha-cur'); // 기존 파일 갱신
    expect(opts.commitMessage).toContain(CORTEX_SYNC_MARKER); // 루프 방지 마커
    expect(opts.content).toContain('new item'); // 직렬화된 새 항목
    expect(opts.branch).toMatch(/^cortex\/roadmap-sync-/);
  });

  it('git 에 roadmap.md 없으면(신규) existingSha=null 로 생성', async () => {
    const projectId = seedProject();
    seedPhaseWithItems(projectId, '1', 'P1', [{ title: 'x', status: 'planned' }]);
    setOctokit(mockGitContent(null)); // 404 → 파일 없음

    let captured: Parameters<NonNullable<Parameters<typeof setRoadmapPRCreator>[0]>>[2] | null =
      null;
    setRoadmapPRCreator(async (_inst, _ref, opts) => {
      captured = opts;
      return { number: 1, url: 'u', branch: opts.branch };
    });

    const r = await pushRoadmapToGit(projectId);
    expect(r.kind).toBe('pushed');
    expect(captured!.existingSha).toBeNull();
  });
});
