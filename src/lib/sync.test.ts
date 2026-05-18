import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { handlePullRequestWebhook, type WebhookPRPayload } from './sync';

const NOW = new Date('2026-05-18T00:00:00Z');

function basePayload(overrides: Partial<WebhookPRPayload['pr']> = {}): WebhookPRPayload {
  return {
    action: 'opened',
    repoSlug: 'cortex-web',
    pr: {
      number: 999,
      title: 'Sync test PR',
      headSha: 'sha-init',
      additions: 10,
      deletions: 2,
      filesChanged: 3,
      merged: false,
      authorLogin: 'devin',
      authorKind: 'agent',
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
  };
}

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(projects).run();
  db.insert(projects)
    .values([
      { slug: 'cortex-web', name: 'Cortex Web' },
      { slug: 'payments-api', name: 'Payments API' },
    ])
    .run();
});

describe('handlePullRequestWebhook', () => {
  it('inserts a new PR row when repo is known and number is new', async () => {
    const result = await handlePullRequestWebhook(basePayload());

    expect(result.kind).toBe('inserted');
    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row).toMatchObject({
      title: 'Sync test PR',
      headSha: 'sha-init',
      linesAdded: 10,
      linesRemoved: 2,
      filesChanged: 3,
      status: 'open',
      authorKind: 'agent',
      authorId: 'devin',
    });
  });

  it('skips with unknown-repo when slug not in projects', async () => {
    const result = await handlePullRequestWebhook(basePayload({}));
    // adjust payload's repoSlug
    const result2 = await handlePullRequestWebhook({
      ...basePayload(),
      repoSlug: 'no-such-repo',
    });
    expect(result.kind).toBe('inserted');
    expect(result2).toEqual({ kind: 'skipped', reason: 'unknown-repo' });
  });

  it('updates an existing PR on synchronize (preserves status, updates headSha + diff stats)', async () => {
    await handlePullRequestWebhook(basePayload());
    // 트라이아지 시뮬레이션 — review-needed로 마크
    db.update(prs).set({ status: 'review-needed' }).where(eq(prs.number, 999)).run();

    const syncResult = await handlePullRequestWebhook({
      ...basePayload({
        headSha: 'sha-sync',
        additions: 50,
        deletions: 4,
        filesChanged: 6,
      }),
      action: 'synchronize',
    });

    expect(syncResult.kind).toBe('updated');

    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row).toMatchObject({
      headSha: 'sha-sync',
      linesAdded: 50,
      linesRemoved: 4,
      filesChanged: 6,
      status: 'review-needed', // synchronize는 상태 보존
    });
  });

  it('transitions to merged when closed with merged=true', async () => {
    await handlePullRequestWebhook(basePayload());

    const result = await handlePullRequestWebhook({
      ...basePayload({ merged: true }),
      action: 'closed',
    });

    expect(result.kind).toBe('updated');
    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row?.status).toBe('merged');
  });

  it('transitions to closed when closed with merged=false', async () => {
    await handlePullRequestWebhook(basePayload());

    await handlePullRequestWebhook({
      ...basePayload({ merged: false }),
      action: 'closed',
    });

    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row?.status).toBe('closed');
  });

  it('transitions back to open on reopened', async () => {
    await handlePullRequestWebhook(basePayload());
    await handlePullRequestWebhook({ ...basePayload({ merged: false }), action: 'closed' });
    await handlePullRequestWebhook({ ...basePayload(), action: 'reopened' });

    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row?.status).toBe('open');
  });

  it('treats edited as title/stat update without status change', async () => {
    await handlePullRequestWebhook(basePayload());
    db.update(prs).set({ status: 'review-needed' }).where(eq(prs.number, 999)).run();

    await handlePullRequestWebhook({
      ...basePayload({ title: 'Renamed PR' }),
      action: 'edited',
    });

    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    expect(row?.title).toBe('Renamed PR');
    expect(row?.status).toBe('review-needed');
  });

  it('scopes uniqueness by (repoId, number) — same number in different repos creates two rows', async () => {
    await handlePullRequestWebhook(basePayload({}));
    await handlePullRequestWebhook({
      ...basePayload(),
      repoSlug: 'payments-api',
    });

    const all = db.select().from(prs).where(eq(prs.number, 999)).all();
    expect(all).toHaveLength(2);
  });
});
