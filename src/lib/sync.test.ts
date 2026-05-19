import type Anthropic from '@anthropic-ai/sdk';
import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { setAnthropic } from './anthropic';
import { setOctokit } from './github';
import { handlePullRequestWebhook, type WebhookPRPayload } from './sync';

function mockOctokitDiff(diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;'): Octokit {
  return {
    pulls: { get: vi.fn().mockResolvedValue({ data: diff }), merge: vi.fn() },
  } as unknown as Octokit;
}

function mockAnthropic(payload: Record<string, unknown> | null = null): {
  client: Anthropic;
  create: Mock;
} {
  const response = payload ?? {
    confidence: 80,
    flags: [],
    summary: 'auto-analyzed',
    comments: [],
    hunkAnnotations: [],
  };
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(response) }],
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

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
      { slug: 'cortex-web', name: 'Cortex Web', autoMergeEnabled: true },
      { slug: 'payments-api', name: 'Payments API', autoMergeEnabled: true },
    ])
    .run();
  // sync 가 analyzePR 을 자동 호출하므로 Octokit·Anthropic 둘 다 주입 필요.
  // 개별 테스트에서 호출 횟수 검증이 필요하면 본문에서 다시 setAnthropic.
  setOctokit(mockOctokitDiff());
  setAnthropic(mockAnthropic().client);
});

afterEach(() => {
  setOctokit(null);
  setAnthropic(null);
});

describe('handlePullRequestWebhook', () => {
  it('inserts a new PR row when repo is known and number is new', async () => {
    const result = await handlePullRequestWebhook(basePayload());

    expect(result.kind).toBe('inserted');
    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    // status 는 analyzePR + runTriage 결과에 따라 결정됨 — 별도 integration 테스트에서 검증.
    expect(row).toMatchObject({
      title: 'Sync test PR',
      headSha: 'sha-init',
      linesAdded: 10,
      linesRemoved: 2,
      filesChanged: 3,
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

  it('updates an existing PR on synchronize — new headSha + diff stats, status follows triage', async () => {
    await handlePullRequestWebhook(basePayload());

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
      // mock Anthropic 응답이 confidence=80 — 90 미만이므로 runTriage 가 review-needed.
      status: 'review-needed',
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

  it('transitions away from closed on reopened — triage then refines status', async () => {
    await handlePullRequestWebhook(basePayload());
    await handlePullRequestWebhook({ ...basePayload({ merged: false }), action: 'closed' });
    await handlePullRequestWebhook({ ...basePayload(), action: 'reopened' });

    const row = db.select().from(prs).where(eq(prs.number, 999)).get();
    // reopened → 'open' → analyzePR cache hit → runTriage → mock conf=80 이므로 review-needed.
    expect(row?.status).toBe('review-needed');
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

describe('handlePullRequestWebhook + analyzePR + runTriage integration', () => {
  it('opened → analyzePR 결과가 preReview 에 저장되고 runTriage 가 결정 생성', async () => {
    setAnthropic(
      mockAnthropic({
        confidence: 95,
        flags: [],
        summary: 'safe change',
        comments: [],
        hunkAnnotations: [],
      }).client,
    );

    const opened = await handlePullRequestWebhook(basePayload());
    expect(opened.kind).toBe('inserted');
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;

    const pre = db.select().from(preReviews).where(eq(preReviews.prId, prId)).get();
    expect(pre?.confidence).toBe(95);
    expect(pre?.confidenceTier).toBe('high');

    // testsPassed 가 null (Phase 5 의 CI 통합 전) — runTriage 는 human-review 로 차단.
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('human-review');
    expect(td?.reason).toContain('테스트');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
  });

  it('preReview.testsPassed=true 백필 후 synchronize 면 자동 머지 통과', async () => {
    setAnthropic(
      mockAnthropic({
        confidence: 95,
        flags: [],
        summary: 'safe',
        comments: [],
        hunkAnnotations: [],
      }).client,
    );
    const opened = await handlePullRequestWebhook(basePayload());
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;

    // CI 결과 동기화 시뮬레이션 — Phase 5+ 에서 자동화될 작업.
    db.update(preReviews).set({ testsPassed: true }).where(eq(preReviews.prId, prId)).run();

    // 같은 SHA 로 synchronize → analyzePR 캐시 hit → runTriage 가 갱신된 preReview 사용.
    await handlePullRequestWebhook({ ...basePayload(), action: 'synchronize' });

    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('auto-merge');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('auto-mergeable');
  });

  it('opened → Anthropic failure 는 sync 자체를 막지 않음 (runTriage 가 skip)', async () => {
    setAnthropic({
      messages: { create: vi.fn().mockRejectedValue(new Error('rate-limited')) },
    } as unknown as Anthropic);

    const opened = await handlePullRequestWebhook(basePayload());
    expect(opened.kind).toBe('inserted');
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;

    expect(db.select().from(preReviews).where(eq(preReviews.prId, prId)).get()).toBeUndefined();
    expect(
      db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get(),
    ).toBeUndefined();
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('open');
  });

  it('synchronize 는 새 SHA 에 대해 재분석 트리거 (cache miss)', async () => {
    const initial = mockAnthropic();
    setOctokit(mockOctokitDiff('diff --git a/x b/x\n+ old'));
    setAnthropic(initial.client);
    await handlePullRequestWebhook(basePayload());
    expect(initial.create).toHaveBeenCalledTimes(1);

    const second = mockAnthropic({
      confidence: 60,
      flags: ['migration'],
      summary: 'risky change',
      comments: [],
      hunkAnnotations: [],
    });
    setOctokit(mockOctokitDiff('diff --git a/y b/y\n+ new'));
    setAnthropic(second.client);

    await handlePullRequestWebhook({
      ...basePayload({ headSha: 'sha-new' }),
      action: 'synchronize',
    });

    expect(second.create).toHaveBeenCalledTimes(1);
    const rows = db.select().from(preReviews).all();
    // (prId, headSha) 유니크 인덱스로 두 행 — sha-init / sha-new.
    expect(rows).toHaveLength(2);
  });

  it('closed 는 analyzePR 호출하지 않음', async () => {
    await handlePullRequestWebhook(basePayload());

    const closing = mockAnthropic();
    setAnthropic(closing.client);
    await handlePullRequestWebhook({ ...basePayload({ merged: true }), action: 'closed' });

    expect(closing.create).not.toHaveBeenCalled();
  });

  it('edited 는 analyzePR 호출하지 않음 (제목 변경만)', async () => {
    await handlePullRequestWebhook(basePayload());

    const editing = mockAnthropic();
    setAnthropic(editing.client);
    await handlePullRequestWebhook({
      ...basePayload({ title: 'Renamed' }),
      action: 'edited',
    });

    expect(editing.create).not.toHaveBeenCalled();
  });
});
