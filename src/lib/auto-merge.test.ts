import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '@/db/client';
import { notifications, prs, projects, triageDecisions, workspaces } from '@/db/schema';
import { attemptAutoMerge, attemptHumanMerge, deleteMergedBranch } from './auto-merge';
import { setOctokit } from './github';
import { setGitRunner } from './workspace';

function mockOctokit(merge?: Mock, get?: Mock): Octokit {
  return {
    pulls: {
      get: get ?? vi.fn().mockResolvedValue({ data: { merged: false } }),
      merge: merge ?? vi.fn(),
    },
  } as unknown as Octokit;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(triageDecisions).run();
  db.delete(workspaces).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

afterEach(() => {
  setOctokit(null);
  setGitRunner(null);
});

function setupPR(opts: {
  status?: 'open' | 'review-needed' | 'auto-mergeable' | 'merged' | 'closed';
  decision?: 'auto-merge' | 'human-review' | 'cluster' | null;
  slug?: string;
}) {
  const project = db
    .insert(projects)
    .values({
      slug: opts.slug ?? 'acme/web',
      name: 'Web',
      autoMergeEnabled: true,
      installationId: 12345,
    })
    .returning({ id: projects.id })
    .get();
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: 42,
      title: 'Auto PR',
      authorKind: 'agent',
      authorId: 'devin',
      headSha: 'sha-x',
      linesAdded: 10,
      linesRemoved: 1,
      filesChanged: 1,
      status: opts.status ?? 'auto-mergeable',
    })
    .returning({ id: prs.id })
    .get();
  if (opts.decision) {
    db.insert(triageDecisions)
      .values({
        prId: pr.id,
        decision: opts.decision,
        reason: 'test',
        decidedBy: 'system',
      })
      .run();
  }
  return pr.id;
}

describe('attemptAutoMerge', () => {
  it('merges via GitHub squash and marks PR.status=merged', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'merged-sha' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const result = await attemptAutoMerge(prId);

    expect(result.kind).toBe('merged');
    if (result.kind === 'merged') expect(result.sha).toBe('merged-sha');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('merged');
    // commit_title 미전송 — GitHub default ('<PR title> (#<number>)') 그대로.
    // sha 전송 — race 가드(PR head 가 분석 후 이동하면 GitHub 가 거부).
    expect(mergeMock).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      pull_number: 42,
      commit_title: undefined,
      merge_method: 'squash',
      sha: 'sha-x',
    });
  });

  // PR head 가 분석 후 새 commit 으로 이동했을 때 — GitHub 가 405 거부. status 를
  // 'auto-mergeable' 그대로 두고(human-review 로 안 떨어뜨림) skipped 반환 → 새 commit 의
  // sync webhook 이 새 분석/머지 트리거.
  it('SHA 불일치(head 이동) 면 review-needed 로 안 떨어뜨리고 skipped', async () => {
    const mergeMock = vi
      .fn()
      .mockRejectedValue(new Error('Head branch was modified. Review and try the merge again.'));
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const result = await attemptAutoMerge(prId);

    expect(result.kind).toBe('skipped');
    // status 가 'auto-mergeable' 유지 (review-needed 로 안 바뀜 — 새 commit 의 webhook 이 다시 트리거).
    const pr = db.select().from(prs).where(eq(prs.id, prId)).get();
    expect(pr?.status).toBe('auto-mergeable');
  });

  it('skips when PR not found', async () => {
    const r = await attemptAutoMerge(9999);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-pr' });
  });

  it('skips when PR.status is not auto-mergeable', async () => {
    setOctokit(mockOctokit());
    const prId = setupPR({ status: 'review-needed', decision: 'auto-merge' });
    const r = await attemptAutoMerge(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'wrong-status' });
  });

  it('skips when no triage_decision exists', async () => {
    setOctokit(mockOctokit());
    const prId = setupPR({ decision: null });
    const r = await attemptAutoMerge(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-decision' });
  });

  it('skips when triage_decision is not auto-merge', async () => {
    setOctokit(mockOctokit());
    const prId = setupPR({ decision: 'human-review' });
    const r = await attemptAutoMerge(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'not-auto-merge' });
  });

  it('falls back to review-needed when GitHub merge returns merged=false', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: false, sha: '' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const r = await attemptAutoMerge(prId);

    expect(r.kind).toBe('failed');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('human-review');
    expect(td?.reason).toContain('GitHub 머지 거부');
  });

  it('falls back to review-needed when GitHub merge throws (conflict/403)', async () => {
    const mergeMock = vi.fn().mockRejectedValue(new Error('Merge conflict'));
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const r = await attemptAutoMerge(prId);

    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toContain('Merge conflict');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('human-review');
  });

  // 리뷰 발견 수정: "not mergeable" 에러를 무조건 race(=성공)로 가정하지 않는다. GitHub 에
  // 실제 머지 여부를 물어, 머지 안 됐으면 review-needed (merged 로 오인 + 브랜치 삭제 방지).
  it('"not mergeable" 에러 + GitHub 가 미머지 → review-needed (merged 오인 안 함)', async () => {
    const mergeMock = vi.fn().mockRejectedValue(new Error('Pull Request is not mergeable'));
    const getMock = vi.fn().mockResolvedValue({ data: { merged: false } });
    setOctokit(mockOctokit(mergeMock, getMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const r = await attemptAutoMerge(prId);

    expect(r.kind).toBe('failed');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
    // merged 로 마킹 안 됨 + auto-merged 알림 0.
    expect(
      db.select().from(notifications).where(eq(notifications.kind, 'auto-merged')).all(),
    ).toHaveLength(0);
  });

  // 진짜 race(다른 호출이 이미 머지) — GitHub 가 merged=true → merged 로 정정.
  it('머지 에러 + GitHub 가 이미 머지됨 → merged 로 정정 (진짜 race)', async () => {
    const mergeMock = vi.fn().mockRejectedValue(new Error('Pull Request is not mergeable'));
    const getMock = vi.fn().mockResolvedValue({ data: { merged: true } });
    setOctokit(mockOctokit(mergeMock, getMock));
    const prId = setupPR({ decision: 'auto-merge' });

    const r = await attemptAutoMerge(prId);

    expect(r.kind).toBe('merged');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('merged');
  });

  it('is idempotent — running twice on a merged PR no-ops', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 's' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    await attemptAutoMerge(prId);
    const second = await attemptAutoMerge(prId);

    // 2회차는 status가 'merged' 라 skip.
    expect(second).toEqual({ kind: 'skipped', reason: 'wrong-status' });
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });

  it('동시 호출은 한 번만 머지 — race 로 인한 모순 알림/triage 오염 없음', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'merged-sha' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ decision: 'auto-merge' });

    // 두 호출을 동시에 — 첫 호출이 await 에 들어가기 전에 inFlight lock 을 동기적으로 잡으므로
    // 둘째 호출은 lock 을 보고 즉시 in-progress 로 빠진다 (mergePR 은 한 번만 호출).
    const [r1, r2] = await Promise.all([attemptAutoMerge(prId), attemptAutoMerge(prId)]);

    // 하나는 머지 성공, 다른 하나는 lock 으로 skip(in-progress). mergePR 은 단 한 번.
    const results = [r1, r2];
    expect(results.map((r) => r.kind).sort()).toEqual(['merged', 'skipped']);
    const skipped = results.find((r) => r.kind === 'skipped');
    expect(skipped?.kind === 'skipped' && skipped.reason).toBe('in-progress');
    expect(mergeMock).toHaveBeenCalledTimes(1);

    // 모순된 실패 알림 없음 — auto-merged 1건, auto-merge-failed 0건.
    expect(
      db.select().from(notifications).where(eq(notifications.kind, 'auto-merged')).all(),
    ).toHaveLength(1);
    expect(
      db.select().from(notifications).where(eq(notifications.kind, 'auto-merge-failed')).all(),
    ).toHaveLength(0);

    // triage decision 보존 — 대시보드가 '자동' 으로 분류 + 자동 카운트 반영.
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('auto-merge');
    expect(td?.decidedBy).toBe('system');
  });
});

describe('attemptHumanMerge', () => {
  it('review-needed PR 도 사람 결정으로 머지 — status=merged + decidedBy=human', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'human-sha' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ status: 'review-needed', decision: 'human-review' });

    const result = await attemptHumanMerge(prId);

    expect(result.kind).toBe('merged');
    if (result.kind === 'merged') expect(result.sha).toBe('human-sha');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('merged');
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('auto-merge');
    expect(td?.decidedBy).toBe('human');
    expect(td?.reason).toContain('사용자');
  });

  it('triage_decision 이 없어도 사람 머지로 새로 insert', async () => {
    const mergeMock = vi.fn().mockResolvedValue({ data: { merged: true, sha: 'h2' } });
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ status: 'review-needed', decision: null });

    const r = await attemptHumanMerge(prId);
    expect(r.kind).toBe('merged');
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decidedBy).toBe('human');
  });

  it('이미 merged PR 은 already-closed 로 skip', async () => {
    setOctokit(mockOctokit());
    const prId = setupPR({ status: 'merged', decision: null });
    const r = await attemptHumanMerge(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'already-closed' });
  });

  it('GitHub 머지 실패 시 PR.status 유지 — review-needed 폴백 안 함', async () => {
    const mergeMock = vi.fn().mockRejectedValue(new Error('Conflict'));
    setOctokit(mockOctokit(mergeMock));
    const prId = setupPR({ status: 'review-needed', decision: null });

    const r = await attemptHumanMerge(prId);
    expect(r.kind).toBe('failed');
    // attemptAutoMerge 와 달리 status 를 review-needed 로 유지 (이미 그 상태이거나 사람 의도 보존).
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
  });

  it('installation 없는 프로젝트는 no-installation 으로 skip', async () => {
    setOctokit(mockOctokit());
    // setupPR 기본은 installationId=12345. 직접 프로젝트에서 빼기.
    const project = db
      .insert(projects)
      .values({ slug: 'no/inst', name: 'NoInst', installationId: null })
      .returning({ id: projects.id })
      .get();
    const pr = db
      .insert(prs)
      .values({
        repoId: project.id,
        number: 99,
        title: 'No installation',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-no',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .returning({ id: prs.id })
      .get();

    const r = await attemptHumanMerge(pr.id);
    expect(r).toEqual({ kind: 'skipped', reason: 'no-installation' });
  });
});

describe('deleteMergedBranch', () => {
  function mockOctokitForBranch(opts: { pullsGet: Mock; deleteRef?: Mock }): Octokit {
    return {
      pulls: { get: opts.pullsGet, merge: vi.fn() },
      git: { deleteRef: opts.deleteRef ?? vi.fn().mockResolvedValue({}) },
    } as unknown as Octokit;
  }

  it('merged PR 의 same-repo head 브랜치를 삭제', async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: {
        head: { ref: 'feat/x', repo: { full_name: 'acme/web' } },
      },
    });
    const deleteRef = vi.fn().mockResolvedValue({});
    setOctokit(mockOctokitForBranch({ pullsGet, deleteRef }));
    const prId = setupPR({ status: 'merged', slug: 'acme/web' });

    const r = await deleteMergedBranch(prId);

    expect(r).toEqual({ kind: 'deleted', ref: 'feat/x' });
    expect(deleteRef).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      ref: 'heads/feat/x',
    });
    // branchDeletedAt 영속 기록 — 재방문 시 버튼 disable 에 사용.
    const after = db.select().from(prs).where(eq(prs.id, prId)).get();
    expect(after?.branchDeletedAt).not.toBeNull();
  });

  it('이미 삭제된 브랜치 — already-deleted 로 skip (멱등)', async () => {
    const pullsGet = vi.fn();
    const deleteRef = vi.fn();
    setOctokit(mockOctokitForBranch({ pullsGet, deleteRef }));
    const prId = setupPR({ status: 'merged', slug: 'acme/web' });
    // 이미 삭제된 상태로 표시.
    db.update(prs).set({ branchDeletedAt: new Date() }).where(eq(prs.id, prId)).run();

    const r = await deleteMergedBranch(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'already-deleted' });
    expect(pullsGet).not.toHaveBeenCalled();
    expect(deleteRef).not.toHaveBeenCalled();
  });

  it('fork / 다른 레포의 head 는 fork-or-cross-repo 로 skip', async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: { head: { ref: 'feat/x', repo: { full_name: 'other/fork' } } },
    });
    const deleteRef = vi.fn();
    setOctokit(mockOctokitForBranch({ pullsGet, deleteRef }));
    const prId = setupPR({ status: 'merged', slug: 'acme/web' });

    const r = await deleteMergedBranch(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'fork-or-cross-repo' });
    expect(deleteRef).not.toHaveBeenCalled();
  });

  it('머지되지 않은 PR 은 not-merged 로 skip', async () => {
    setOctokit(mockOctokitForBranch({ pullsGet: vi.fn() }));
    const prId = setupPR({ status: 'review-needed' });
    const r = await deleteMergedBranch(prId);
    expect(r).toEqual({ kind: 'skipped', reason: 'not-merged' });
  });

  it('GitHub deleteRef 가 실패하면 failed 반환', async () => {
    const pullsGet = vi.fn().mockResolvedValue({
      data: { head: { ref: 'feat/x', repo: { full_name: 'acme/web' } } },
    });
    const deleteRef = vi.fn().mockRejectedValue(new Error('Reference not found'));
    setOctokit(mockOctokitForBranch({ pullsGet, deleteRef }));
    const prId = setupPR({ status: 'merged' });

    const r = await deleteMergedBranch(prId);
    expect(r.kind).toBe('failed');
    if (r.kind === 'failed') expect(r.reason).toContain('Reference not found');
  });
});

describe('머지 후 자동 git pull (safeAutoPull)', () => {
  // 등록된 워크스페이스에 .git 을 만들어 needsClone=false 로. git 은 주입 runner 로 가로채
  // 실제 spawn 없이 호출 인자만 기록.
  function registerClonedWorkspace(prId: number): { calls: string[][]; dir: string } {
    const repoId = db.select({ repoId: prs.repoId }).from(prs).where(eq(prs.id, prId)).get()!
      .repoId;
    const dir = mkdtempSync(join(tmpdir(), 'cortex-ws-'));
    mkdirSync(join(dir, '.git'));
    db.insert(workspaces).values({ projectId: repoId, localPath: dir }).run();
    const calls: string[][] = [];
    setGitRunner((_cwd, args) => {
      calls.push([...args]);
      return Promise.resolve({ code: 0, output: '' });
    });
    return { calls, dir };
  }

  it('자동 머지 성공 시 등록된 워크스페이스를 fetch + pull', async () => {
    setOctokit(mockOctokit(vi.fn().mockResolvedValue({ data: { merged: true, sha: 's' } })));
    const prId = setupPR({ decision: 'auto-merge' });
    const { calls, dir } = registerClonedWorkspace(prId);
    try {
      await attemptAutoMerge(prId);
      expect(calls.some((a) => a[0] === 'fetch')).toBe(true);
      expect(calls.some((a) => a[0] === 'pull' && a.includes('--ff-only'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('사람 머지 성공 시에도 자동 pull', async () => {
    setOctokit(mockOctokit(vi.fn().mockResolvedValue({ data: { merged: true, sha: 'h' } })));
    const prId = setupPR({ status: 'review-needed', decision: null });
    const { calls, dir } = registerClonedWorkspace(prId);
    try {
      await attemptHumanMerge(prId);
      expect(calls.some((a) => a[0] === 'pull')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('워크스페이스 미등록이면 pull 하지 않고 머지만 성공', async () => {
    setOctokit(mockOctokit(vi.fn().mockResolvedValue({ data: { merged: true, sha: 's' } })));
    const prId = setupPR({ decision: 'auto-merge' });
    const calls: string[][] = [];
    setGitRunner((_cwd, args) => {
      calls.push([...args]);
      return Promise.resolve({ code: 0, output: '' });
    });
    const r = await attemptAutoMerge(prId);
    expect(r.kind).toBe('merged');
    expect(calls).toHaveLength(0);
  });

  it('아직 clone 안 된(빈 디렉토리) 워크스페이스는 머지 이벤트에서 clone 트리거 안 함', async () => {
    setOctokit(mockOctokit(vi.fn().mockResolvedValue({ data: { merged: true, sha: 's' } })));
    const prId = setupPR({ decision: 'auto-merge' });
    const repoId = db.select({ repoId: prs.repoId }).from(prs).where(eq(prs.id, prId)).get()!
      .repoId;
    const dir = mkdtempSync(join(tmpdir(), 'cortex-ws-')); // .git 없음 → needsClone=true
    db.insert(workspaces).values({ projectId: repoId, localPath: dir }).run();
    const calls: string[][] = [];
    setGitRunner((_cwd, args) => {
      calls.push([...args]);
      return Promise.resolve({ code: 0, output: '' });
    });
    try {
      const r = await attemptAutoMerge(prId);
      expect(r.kind).toBe('merged');
      expect(calls).toHaveLength(0); // clone 도 pull 도 호출 안 됨
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
