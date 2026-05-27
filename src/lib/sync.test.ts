import type { Octokit } from '@octokit/rest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { notifications, preReviews, prs, projects, triageDecisions } from '@/db/schema';
import { setClaudeRunner } from './claude-cli';
import { setOctokit } from './github';
import { handleCheckWebhook, handlePullRequestWebhook, type WebhookPRPayload } from './sync';

// 디폴트는 머지가 성공한 것처럼 응답 — auto-merge 흐름이 끝까지 가는 테스트가 많아서.
// 머지 실패를 검증하고 싶으면 본문에서 setOctokit 으로 덮어쓴다.
function mockOctokitDiff(
  diff = 'diff --git a/src/x.ts b/src/x.ts\n+ const x = 1;',
  mergeResponse: { merged: boolean; sha: string } = { merged: true, sha: 'merged-sha' },
  checkRuns: Array<{ status: string; conclusion: string | null }> = [],
): Octokit {
  return {
    pulls: {
      get: vi.fn().mockResolvedValue({ data: diff }),
      merge: vi.fn().mockResolvedValue({ data: mergeResponse }),
    },
    // analyzePR 가 listCheckRunsForRef 를 호출 — 빈 배열이면 testsPassed=null.
    checks: {
      listForRef: vi.fn().mockResolvedValue({ data: { check_runs: checkRuns } }),
    },
  } as unknown as Octokit;
}

// claude CLI runner mock — analyzePR 이 runClaudeHeadless 로 호출. { ok, text } 형태 응답.
function mockClaudeRunner(payload: Record<string, unknown> | null = null): {
  runner: ReturnType<typeof vi.fn>;
} {
  const response = payload ?? {
    confidence: 80,
    flags: [],
    summary: 'auto-analyzed',
    comments: [],
    hunkAnnotations: [],
  };
  const runner = vi.fn().mockResolvedValue({ ok: true, text: JSON.stringify(response) });
  return { runner };
}

const NOW = new Date('2026-05-18T00:00:00Z');

function basePayload(overrides: Partial<WebhookPRPayload['pr']> = {}): WebhookPRPayload {
  return {
    action: 'opened',
    repoSlug: 'cortex-web',
    installationId: 12345,
    pr: {
      number: 999,
      title: 'Sync test PR',
      body: null,
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
  db.delete(notifications).run();
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
  setClaudeRunner(mockClaudeRunner().runner);
});

afterEach(() => {
  setOctokit(null);
  setClaudeRunner(null);
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

  it('skips with unknown-repo when installationId is null and slug not in projects', async () => {
    const result = await handlePullRequestWebhook(basePayload({}));
    // installationId null 이면 자동 onboard 안 함 — legacy PAT 페이로드 가정.
    const result2 = await handlePullRequestWebhook({
      ...basePayload(),
      repoSlug: 'no-such-repo',
      installationId: null,
    });
    expect(result.kind).toBe('inserted');
    expect(result2).toEqual({ kind: 'skipped', reason: 'unknown-repo' });
  });

  it('auto-onboards a new repo when installationId is present', async () => {
    const result = await handlePullRequestWebhook({
      ...basePayload(),
      repoSlug: 'new-org/new-repo',
      installationId: 99999,
    });
    expect(result.kind).toBe('inserted');
    const project = db.select().from(projects).where(eq(projects.slug, 'new-org/new-repo')).get();
    expect(project?.installationId).toBe(99999);
    // 자동 onboard 시 autoMergeEnabled=true 디폴트 — App 설치 자체가 자동화 의지의 표명.
    expect(project?.autoMergeEnabled).toBe(true);
  });

  it('updates installationId when it changes for an existing project', async () => {
    await handlePullRequestWebhook(basePayload());
    await handlePullRequestWebhook({ ...basePayload(), installationId: 67890 });
    const project = db.select().from(projects).where(eq(projects.slug, 'cortex-web')).get();
    expect(project?.installationId).toBe(67890);
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
    setClaudeRunner(
      mockClaudeRunner({
        confidence: 95,
        flags: [],
        summary: 'safe change',
        comments: [],
        hunkAnnotations: [],
      }).runner,
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
    expect(td?.reason).toContain('CI 결과');
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
  });

  it('preReview.testsPassed=true 백필 후 synchronize 면 자동 머지까지 실행됨', async () => {
    setClaudeRunner(
      mockClaudeRunner({
        confidence: 95,
        flags: [],
        summary: 'safe',
        comments: [],
        hunkAnnotations: [],
      }).runner,
    );
    const opened = await handlePullRequestWebhook(basePayload());
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;

    // CI 결과 동기화 시뮬레이션 — handleCheckWebhook 이 prs.testsPassed 갱신.
    db.update(prs).set({ testsPassed: true }).where(eq(prs.id, prId)).run();

    // 같은 SHA 로 synchronize → analyzePR 캐시 hit → runTriage → safeAutoMerge.
    await handlePullRequestWebhook({ ...basePayload(), action: 'synchronize' });

    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('auto-merge');
    // safeAutoMerge 가 mergePR 호출 → status='merged' 로 종결.
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('merged');
  });

  it('자동 머지 실패 시 review-needed 로 폴백 + triage 사유 갱신', async () => {
    // 머지 API 가 merged=false 반환하는 슬롯으로 교체.
    setOctokit(mockOctokitDiff(undefined, { merged: false, sha: '' }));
    setClaudeRunner(
      mockClaudeRunner({
        confidence: 95,
        flags: [],
        summary: 'safe',
        comments: [],
        hunkAnnotations: [],
      }).runner,
    );
    const opened = await handlePullRequestWebhook(basePayload());
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;
    db.update(prs).set({ testsPassed: true }).where(eq(prs.id, prId)).run();

    await handlePullRequestWebhook({ ...basePayload(), action: 'synchronize' });

    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
    const td = db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get();
    expect(td?.decision).toBe('human-review');
    expect(td?.reason).toContain('GitHub 머지 거부');
  });

  it('opened → claude 호출 실패 시 review-needed 로 폴백 (사용자 시야에서 사라지지 않게)', async () => {
    setClaudeRunner(vi.fn().mockRejectedValue(new Error('rate-limited')));

    const opened = await handlePullRequestWebhook(basePayload());
    expect(opened.kind).toBe('inserted');
    const prId = (opened as { kind: 'inserted'; prId: number }).prId;

    expect(db.select().from(preReviews).where(eq(preReviews.prId, prId)).get()).toBeUndefined();
    expect(
      db.select().from(triageDecisions).where(eq(triageDecisions.prId, prId)).get(),
    ).toBeUndefined();
    // 분석 실패해도 PR.status='review-needed' 라 인박스에 등장 — 묻히지 않음.
    expect(db.select().from(prs).where(eq(prs.id, prId)).get()?.status).toBe('review-needed');
  });

  it('synchronize 는 새 SHA 에 대해 재분석 트리거 (cache miss)', async () => {
    const initial = mockClaudeRunner();
    setOctokit(mockOctokitDiff('diff --git a/x b/x\n+ old'));
    setClaudeRunner(initial.runner);
    await handlePullRequestWebhook(basePayload());
    expect(initial.runner).toHaveBeenCalledTimes(1);

    const second = mockClaudeRunner({
      confidence: 60,
      flags: ['migration'],
      summary: 'risky change',
      comments: [],
      hunkAnnotations: [],
    });
    setOctokit(mockOctokitDiff('diff --git a/y b/y\n+ new'));
    setClaudeRunner(second.runner);

    await handlePullRequestWebhook({
      ...basePayload({ headSha: 'sha-new' }),
      action: 'synchronize',
    });

    expect(second.runner).toHaveBeenCalledTimes(1);
    const rows = db.select().from(preReviews).all();
    // (prId, headSha) 유니크 인덱스로 두 행 — sha-init / sha-new.
    expect(rows).toHaveLength(2);
  });

  it('closed 는 analyzePR 호출하지 않음', async () => {
    await handlePullRequestWebhook(basePayload());

    const closing = mockClaudeRunner();
    setClaudeRunner(closing.runner);
    await handlePullRequestWebhook({ ...basePayload({ merged: true }), action: 'closed' });

    expect(closing.runner).not.toHaveBeenCalled();
  });

  it('edited 는 analyzePR 호출하지 않음 (제목 변경만)', async () => {
    await handlePullRequestWebhook(basePayload());

    const editing = mockClaudeRunner();
    setClaudeRunner(editing.runner);
    await handlePullRequestWebhook({
      ...basePayload({ title: 'Renamed' }),
      action: 'edited',
    });

    expect(editing.runner).not.toHaveBeenCalled();
  });

  // Phase 6 DoD — 24시간 이내, 같은 에이전트, 유사도 0.85+ PR 3건 이상이 자동으로 클러스터됨.
  // mockOctokitDiff 가 모두 같은 diff (src/x.ts) 를 반환하므로 자카드=1.0 → 임계치 초과.
  // mock Anthropic 응답 confidence=80 (90 미만) → runTriage 가 human-review → tryClusterPR 호출.
  // createdAt 은 tryClusterPR 의 24h 윈도우(Date.now 기준) 안에 들어오도록 현재 시각 사용.
  it('동일 패턴 PR 3건이 들어오면 자동 클러스터링', async () => {
    const now = new Date();
    await handlePullRequestWebhook(
      basePayload({ number: 1001, headSha: 'sha-c1', createdAt: now, updatedAt: now }),
    );
    await handlePullRequestWebhook(
      basePayload({ number: 1002, headSha: 'sha-c2', createdAt: now, updatedAt: now }),
    );
    await handlePullRequestWebhook(
      basePayload({ number: 1003, headSha: 'sha-c3', createdAt: now, updatedAt: now }),
    );

    const clustered = db
      .select({ clusterId: prs.clusterId })
      .from(prs)
      .where(eq(prs.authorId, 'devin'))
      .all();
    const ids = new Set(clustered.map((r) => r.clusterId).filter((v): v is number => v !== null));
    expect(ids.size).toBe(1);
    expect(clustered.every((r) => r.clusterId !== null)).toBe(true);
  });

  it('PR 2건만 들어오면 클러스터링 안 됨 (최소 3건)', async () => {
    const now = new Date();
    await handlePullRequestWebhook(
      basePayload({ number: 1001, headSha: 'sha-c1', createdAt: now, updatedAt: now }),
    );
    await handlePullRequestWebhook(
      basePayload({ number: 1002, headSha: 'sha-c2', createdAt: now, updatedAt: now }),
    );

    const rows = db.select({ clusterId: prs.clusterId }).from(prs).all();
    expect(rows.every((r) => r.clusterId === null)).toBe(true);
  });

  it('블로킹 플래그(migration) 가 있으면 클러스터링 제외', async () => {
    const now = new Date();
    // 처음 2건은 plain agent PR (flag 없음).
    await handlePullRequestWebhook(
      basePayload({ number: 1001, headSha: 'sha-c1', createdAt: now, updatedAt: now }),
    );
    await handlePullRequestWebhook(
      basePayload({ number: 1002, headSha: 'sha-c2', createdAt: now, updatedAt: now }),
    );

    // 3번째 PR 은 migration 플래그.
    const flagged = mockClaudeRunner({
      confidence: 80,
      flags: ['migration'],
      summary: 'risky',
      comments: [],
      hunkAnnotations: [],
    });
    setClaudeRunner(flagged.runner);
    await handlePullRequestWebhook(
      basePayload({ number: 1003, headSha: 'sha-c3', createdAt: now, updatedAt: now }),
    );

    // tryClusterPR 가 blocking-flag 로 skip → 클러스터 형성 안 됨.
    const rows = db.select({ clusterId: prs.clusterId }).from(prs).all();
    expect(rows.every((r) => r.clusterId === null)).toBe(true);
  });
});

describe('handleCheckWebhook', () => {
  it('skips unknown-repo', async () => {
    const result = await handleCheckWebhook({
      repoSlug: 'no-such',
      installationId: 1,
      headSha: 'sha-x',
    });
    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') expect(result.reason).toBe('unknown-repo');
  });

  it('skips no-pr when no PR matches headSha', async () => {
    const result = await handleCheckWebhook({
      repoSlug: 'cortex-web',
      installationId: 12345,
      headSha: 'sha-nonexistent',
    });
    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') expect(result.reason).toBe('no-pr');
  });

  it('updates prs.testsPassed=true when checks all passed and triggers re-triage', async () => {
    // 1) PR 시드 (handlePullRequestWebhook → analyzePR).
    await handlePullRequestWebhook(basePayload({ headSha: 'sha-pass' }));
    const pr = db.select().from(prs).where(eq(prs.headSha, 'sha-pass')).get();
    expect(pr).toBeDefined();

    // 2) Octokit mock 을 'passed' 시나리오로 교체.
    setOctokit(
      mockOctokitDiff('', { merged: true, sha: 'merged-sha' }, [
        { status: 'completed', conclusion: 'success' },
      ]),
    );

    // 3) check_run 도착.
    const result = await handleCheckWebhook({
      repoSlug: 'cortex-web',
      installationId: 12345,
      headSha: 'sha-pass',
    });
    expect(result.kind).toBe('updated');
    if (result.kind === 'updated') expect(result.testsPassed).toBe(true);

    // CI 결과는 prs 컬럼에 저장 — preReview 와 무관.
    const updated = db.select().from(prs).where(eq(prs.id, pr!.id)).get();
    expect(updated?.testsPassed).toBe(true);
  });

  it('updates prs.testsPassed=false when any check failed', async () => {
    await handlePullRequestWebhook(basePayload({ headSha: 'sha-fail' }));
    const pr = db.select().from(prs).where(eq(prs.headSha, 'sha-fail')).get();

    setOctokit(
      mockOctokitDiff('', { merged: true, sha: 'm' }, [
        { status: 'completed', conclusion: 'failure' },
      ]),
    );

    const result = await handleCheckWebhook({
      repoSlug: 'cortex-web',
      installationId: 12345,
      headSha: 'sha-fail',
    });
    expect(result.kind).toBe('updated');
    if (result.kind === 'updated') expect(result.testsPassed).toBe(false);
    const updated = db.select().from(prs).where(eq(prs.id, pr!.id)).get();
    expect(updated?.testsPassed).toBe(false);
  });

  // AI off 시나리오 — preReview 없어도 prs.testsPassed 채워져야 함.
  // (이전엔 no-pre-review skip 이었지만 testsPassed 분리 후 PR 만 있어도 OK).
  it('updates prs.testsPassed even when no preReview exists (AI off scenario)', async () => {
    const proj = db.select().from(projects).where(eq(projects.slug, 'cortex-web')).get();
    const inserted = db
      .insert(prs)
      .values({
        repoId: proj!.id,
        number: 7777,
        title: 'no review',
        authorKind: 'agent',
        authorId: 'devin',
        headSha: 'sha-no-review',
        linesAdded: 1,
        linesRemoved: 0,
        filesChanged: 1,
        status: 'review-needed',
      })
      .returning({ id: prs.id })
      .get();

    setOctokit(
      mockOctokitDiff('', { merged: true, sha: 'm' }, [
        { status: 'completed', conclusion: 'success' },
      ]),
    );

    const result = await handleCheckWebhook({
      repoSlug: 'cortex-web',
      installationId: 12345,
      headSha: 'sha-no-review',
    });
    expect(result.kind).toBe('updated');
    const updated = db.select().from(prs).where(eq(prs.id, inserted.id)).get();
    expect(updated?.testsPassed).toBe(true);
  });
});
