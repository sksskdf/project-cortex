import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { db } from '@/db/client';
import { prs, projects, triageDecisions } from '@/db/schema';
import { attemptAutoMerge } from './auto-merge';
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
    expect(mergeMock).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'web',
      pull_number: 42,
      commit_title: 'Auto PR',
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
});
