import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { prs, projects } from '@/db/schema';
import {
  clearAutomationInFlight,
  countAutomationInFlight,
  getAutomationInFlight,
  reconcileStaleAutomationInFlight,
  setAutomationInFlight,
} from './automation-state';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(prs).run();
  db.delete(projects).run();
});

function setupPR(prId: number, slug = 'acme/web'): number {
  const repoId = db
    .insert(projects)
    .values({ slug, name: slug })
    .returning({ id: projects.id })
    .get().id;
  return db
    .insert(prs)
    .values({
      id: prId,
      repoId,
      number: prId,
      title: 't',
      authorKind: 'agent',
      authorId: 'devin',
      headSha: 'sha',
      linesAdded: 0,
      linesRemoved: 0,
      filesChanged: 0,
    })
    .returning({ id: prs.id })
    .get().id;
}

describe('automation-state (DB 영속, 검수 P1-3)', () => {
  it('set 하면 get 으로 kind 가 보인다', () => {
    setupPR(1);
    expect(getAutomationInFlight(1)).toBeNull();
    setAutomationInFlight(1, 'resolving-conflict');
    expect(getAutomationInFlight(1)).toBe('resolving-conflict');
  });

  it('clear 하면 null 로 돌아온다', () => {
    setupPR(2);
    setAutomationInFlight(2, 'fixing-tests');
    expect(getAutomationInFlight(2)).toBe('fixing-tests');
    clearAutomationInFlight(2);
    expect(getAutomationInFlight(2)).toBeNull();
  });

  it('set 갱신 — 같은 PR 의 kind 를 덮어쓴다', () => {
    setupPR(1);
    setAutomationInFlight(1, 'fixing-tests');
    setAutomationInFlight(1, 'addressing-review');
    expect(getAutomationInFlight(1)).toBe('addressing-review');
  });

  it('안 set 된 PR clear 는 멱등 no-op', () => {
    expect(() => clearAutomationInFlight(999)).not.toThrow();
    expect(getAutomationInFlight(999)).toBeNull();
  });

  it('countAutomationInFlight — 진행 중 markers 의 총 개수', () => {
    setupPR(1, 'a/x');
    setupPR(2, 'b/y');
    setupPR(3, 'c/z');
    expect(countAutomationInFlight()).toBe(0);
    setAutomationInFlight(1, 'fixing-tests');
    setAutomationInFlight(2, 'resolving-conflict');
    expect(countAutomationInFlight()).toBe(2);
    clearAutomationInFlight(1);
    expect(countAutomationInFlight()).toBe(1);
  });

  // 부팅 reconcile — 죽은 프로세스 작업이 영구 in-flight 박제되지 않도록 일괄 청소.
  it('reconcileStaleAutomationInFlight — 모든 in-flight 마커 NULL 로 청소', () => {
    setupPR(1, 'a/x');
    setupPR(2, 'b/y');
    setAutomationInFlight(1, 'fixing-tests');
    setAutomationInFlight(2, 'addressing-review');
    expect(countAutomationInFlight()).toBe(2);
    const cleared = reconcileStaleAutomationInFlight();
    expect(cleared).toBe(2);
    expect(countAutomationInFlight()).toBe(0);
    expect(getAutomationInFlight(1)).toBeNull();
    expect(getAutomationInFlight(2)).toBeNull();
  });
});
