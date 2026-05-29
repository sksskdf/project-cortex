import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
import { markPRRead, markPRsRead, unreadMergedCount } from './pr-read';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(prs).run();
  db.delete(projects).run();
});

function setupProject(): number {
  return db
    .insert(projects)
    .values({ slug: 'acme/web', name: 'Web' })
    .returning({ id: projects.id })
    .get().id;
}

function setupPR(
  repoId: number,
  number: number,
  status: 'open' | 'review-needed' | 'merged' = 'merged',
): number {
  return db
    .insert(prs)
    .values({
      repoId,
      number,
      title: `PR ${number}`,
      authorKind: 'agent',
      authorId: 'devin',
      headSha: `sha-${number}`,
      linesAdded: 1,
      linesRemoved: 0,
      filesChanged: 1,
      status,
    })
    .returning({ id: prs.id })
    .get().id;
}

function readAtOf(id: number): Date | null {
  return db.select({ r: prs.readAt }).from(prs).where(eq(prs.id, id)).get()?.r ?? null;
}

describe('markPRRead', () => {
  it('read=true 면 readAt 을 채우고, false 면 null 로 되돌린다', () => {
    const repoId = setupProject();
    const id = setupPR(repoId, 1);
    expect(readAtOf(id)).toBeNull();

    expect(markPRRead(id, true).updated).toBe(1);
    expect(readAtOf(id)).toBeInstanceOf(Date);

    expect(markPRRead(id, false).updated).toBe(1);
    expect(readAtOf(id)).toBeNull();
  });
});

describe('unreadMergedCount', () => {
  it('머지됐고 미확인(readAt null)인 PR 만 센다', () => {
    const repoId = setupProject();
    const merged1 = setupPR(repoId, 1, 'merged');
    setupPR(repoId, 2, 'merged'); // 미확인 머지 2건
    const open = setupPR(repoId, 3, 'open'); // 머지 아님 — 제외
    expect(unreadMergedCount()).toBe(2);

    // 1건 확인 처리 → 1건 남음.
    markPRRead(merged1, true);
    expect(unreadMergedCount()).toBe(1);

    // open PR 을 읽음 처리해도 머지 미확인 카운트엔 영향 없음.
    markPRRead(open, true);
    expect(unreadMergedCount()).toBe(1);
  });
});

describe('markPRsRead', () => {
  it('여러 건을 일괄 확인하고 이미 읽은 건 건드리지 않는다', () => {
    const repoId = setupProject();
    const a = setupPR(repoId, 1);
    const b = setupPR(repoId, 2);
    markPRRead(a, true);

    // a 는 이미 읽음 → b 만 갱신.
    expect(markPRsRead([a, b]).updated).toBe(1);
    expect(unreadMergedCount()).toBe(0);
  });

  it('빈 배열은 no-op', () => {
    expect(markPRsRead([]).updated).toBe(0);
  });
});
