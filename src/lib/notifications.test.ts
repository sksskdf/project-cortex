import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { clusters, notifications, prs, projects } from '@/db/schema';
import {
  createNotification,
  isRevertPR,
  listRecentNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  unreadNotificationCount,
} from './notifications';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notifications).run();
  db.delete(prs).run();
  db.delete(clusters).run();
  db.delete(projects).run();
});

function seedPR(opts: { slug?: string; title?: string; number?: number } = {}) {
  const project = db
    .insert(projects)
    .values({ slug: opts.slug ?? 'acme/web', name: 'Web' })
    .returning({ id: projects.id })
    .get();
  const pr = db
    .insert(prs)
    .values({
      repoId: project.id,
      number: opts.number ?? 42,
      title: opts.title ?? 'Fix bug',
      authorKind: 'agent',
      authorId: 'claude',
      headSha: 'abc1234',
      linesAdded: 10,
      linesRemoved: 2,
      filesChanged: 3,
    })
    .returning({ id: prs.id })
    .get();
  return { projectId: project.id, prId: pr.id };
}

describe('isRevertPR', () => {
  it('detects title prefix "Revert "', () => {
    expect(isRevertPR({ title: 'Revert "Add feature X"', body: null })).toBe(true);
  });
  it('detects body "This reverts commit <sha>"', () => {
    expect(isRevertPR({ title: 'Some PR', body: 'This reverts commit 1234567890abcdef.' })).toBe(
      true,
    );
  });
  it('false for normal PR', () => {
    expect(isRevertPR({ title: 'Add feature X', body: 'Implements X' })).toBe(false);
  });
  it('case-sensitive — does not match "revert " (lowercase)', () => {
    // GitHub revert UI 가 만드는 패턴은 'Revert ' 대문자. 일반 lowercase 는 false positive 회피.
    expect(isRevertPR({ title: 'revert something', body: null })).toBe(false);
  });
});

describe('createNotification', () => {
  it('creates auto-merged notification with PR ref + slug', () => {
    const { prId } = seedPR({ slug: 'acme/web', number: 42, title: 'Fix bug' });
    const r = createNotification({ kind: 'auto-merged', prId });
    expect(r.kind).toBe('created');
    const row = db.select().from(notifications).where(eq(notifications.id, r.id!)).get();
    expect(row?.kind).toBe('auto-merged');
    expect(row?.prId).toBe(prId);
    expect(row?.title).toBe('자동 머지 완료 · acme/web #42');
    expect(row?.body).toBe('Fix bug');
    expect(row?.readAt).toBeNull();
  });

  it('creates auto-merge-failed notification with reason', () => {
    const { prId } = seedPR();
    const r = createNotification({
      kind: 'auto-merge-failed',
      prId,
      reason: 'GitHub merge rejected',
    });
    expect(r.kind).toBe('created');
    const row = db.select().from(notifications).where(eq(notifications.id, r.id!)).get();
    expect(row?.body).toBe('GitHub merge rejected');
  });

  it('creates workspace-pulled / workspace-pull-failed notifications', () => {
    const { prId } = seedPR({ slug: 'acme/web', number: 7, title: 'x' });
    const ok = createNotification({ kind: 'workspace-pulled', prId });
    expect(ok.kind).toBe('created');
    expect(db.select().from(notifications).where(eq(notifications.id, ok.id!)).get()?.kind).toBe(
      'workspace-pulled',
    );

    const fail = createNotification({
      kind: 'workspace-pull-failed',
      prId,
      reason: 'git pull 실패: Not possible to fast-forward',
    });
    const row = db.select().from(notifications).where(eq(notifications.id, fail.id!)).get();
    expect(row?.kind).toBe('workspace-pull-failed');
    expect(row?.body).toContain('fast-forward');
  });

  // 회귀(리뷰 발견): workspace-pulled 는 per-repo 부작용 — 같은 repo 의 여러 PR 이 연달아 머지되면
  // 동일 알림이 반복 스팸. 같은 kind+project 의 최근 알림이 있으면 dedupe(skip).
  it('workspace-pulled 는 같은 프로젝트의 후속 PR 머지에서 dedupe(skip)', () => {
    const project = db
      .insert(projects)
      .values({ slug: 'acme/web', name: 'Web' })
      .returning({ id: projects.id })
      .get();
    function prInProject(number: number): number {
      return db
        .insert(prs)
        .values({
          repoId: project.id,
          number,
          title: `pr ${number}`,
          authorKind: 'agent',
          authorId: 'claude',
          headSha: `sha${number}`,
          linesAdded: 1,
          linesRemoved: 0,
          filesChanged: 1,
        })
        .returning({ id: prs.id })
        .get().id;
    }
    const pr1 = prInProject(1);
    const pr2 = prInProject(2);

    const first = createNotification({ kind: 'workspace-pulled', prId: pr1 });
    expect(first.kind).toBe('created');
    // 같은 프로젝트의 다른 PR — dedupe 창 안이라 skip.
    const second = createNotification({ kind: 'workspace-pulled', prId: pr2 });
    expect(second.kind).toBe('skipped');
    // workspace-pulled 행은 1개뿐.
    const rows = db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'workspace-pulled'))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('다른 kind(per-PR)는 dedupe 안 함 — 같은 프로젝트라도 각 PR 알림 유지', () => {
    const project = db
      .insert(projects)
      .values({ slug: 'acme/web', name: 'Web' })
      .returning({ id: projects.id })
      .get();
    const mk = (number: number) =>
      db
        .insert(prs)
        .values({
          repoId: project.id,
          number,
          title: `pr ${number}`,
          authorKind: 'agent',
          authorId: 'claude',
          headSha: `sha${number}`,
          linesAdded: 1,
          linesRemoved: 0,
          filesChanged: 1,
        })
        .returning({ id: prs.id })
        .get().id;
    expect(createNotification({ kind: 'auto-merged', prId: mk(1) }).kind).toBe('created');
    expect(createNotification({ kind: 'auto-merged', prId: mk(2) }).kind).toBe('created');
    const rows = db.select().from(notifications).where(eq(notifications.kind, 'auto-merged')).all();
    expect(rows).toHaveLength(2);
  });

  it('skips creating when PR missing', () => {
    const r = createNotification({ kind: 'ci-failed', prId: 9999 });
    expect(r.kind).toBe('skipped');
    const count = db.select().from(notifications).all().length;
    expect(count).toBe(0);
  });

  it('creates cluster-created notification with size', () => {
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'p1', title: 'tools', avgConfidence: 80 })
      .returning({ id: clusters.id })
      .get();
    const r = createNotification({ kind: 'cluster-created', clusterId: cluster.id, size: 3 });
    expect(r.kind).toBe('created');
    const row = db.select().from(notifications).where(eq(notifications.id, r.id!)).get();
    expect(row?.title).toBe('새 클러스터: tools');
    expect(row?.body).toBe('3개 PR 이 묶였습니다.');
    expect(row?.clusterId).toBe(cluster.id);
  });
});

describe('listRecentNotifications / unreadCount / markRead', () => {
  it('lists in DESC order and reports unread count', () => {
    const { prId } = seedPR();
    createNotification({ kind: 'auto-merged', prId });
    createNotification({ kind: 'ci-failed', prId });

    const list = listRecentNotifications();
    expect(list.length).toBe(2);
    expect(list[0].kind).toBe('ci-failed'); // 최신이 위.
    expect(unreadNotificationCount()).toBe(2);

    const r = markNotificationsRead([list[0].id]);
    expect(r.updated).toBe(1);
    expect(unreadNotificationCount()).toBe(1);
  });

  it('markAllNotificationsRead clears unread', () => {
    const { prId } = seedPR();
    createNotification({ kind: 'auto-merged', prId });
    createNotification({ kind: 'auto-merged', prId });
    expect(unreadNotificationCount()).toBe(2);
    const r = markAllNotificationsRead();
    expect(r.updated).toBe(2);
    expect(unreadNotificationCount()).toBe(0);
  });

  it('markRead is idempotent — second call on already-read is no-op', () => {
    const { prId } = seedPR();
    const created = createNotification({ kind: 'auto-merged', prId });
    markNotificationsRead([created.id!]);
    const r = markNotificationsRead([created.id!]);
    expect(r.updated).toBe(0);
  });

  it('builds href to /pr/:id when prId set', () => {
    const { prId } = seedPR();
    createNotification({ kind: 'auto-merged', prId });
    const list = listRecentNotifications();
    expect(list[0].href).toBe(`/pr/${prId}`);
  });

  it('builds href to /cluster/:id when clusterId set', () => {
    const cluster = db
      .insert(clusters)
      .values({ pattern: 'p', title: 't', avgConfidence: 70 })
      .returning({ id: clusters.id })
      .get();
    createNotification({ kind: 'cluster-created', clusterId: cluster.id, size: 3 });
    const list = listRecentNotifications();
    expect(list[0].href).toBe(`/cluster/${cluster.id}`);
  });
});
