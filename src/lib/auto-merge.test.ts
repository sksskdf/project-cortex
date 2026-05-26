import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { db } from '@/db/client';
import { notifications, prs, projects, triageDecisions } from '@/db/schema';
import { attemptAutoMerge, attemptHumanMerge, deleteMergedBranch } from './auto-merge';
import { setOctokit } from './github';

function mockOctokit(merge?: Mock): Octokit {
  return {
    pulls: { get: vi.fn(), merge: merge ?? vi.fn() },
  } as unknown as Octokit;
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(triageDecisions).run();
  db.delete(prs).run();
  db.delete(projects).run();
});

afterEach(() => {
  setOctokit(null);
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
    expect(mergeMock).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      pull_number: 42,
      commit_title: undefined,
      merge_method: 'squash',
    });
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
