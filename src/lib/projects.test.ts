import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import {
  addProjectFromInstallation,
  addProjectManually,
  listAutoMergeProjects,
  setProjectAiReview,
  setProjectAutoDeleteBranch,
  setProjectAutoMerge,
} from './projects';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(projects).run();
});

describe('listAutoMergeProjects', () => {
  it('returns only projects with installationId set', () => {
    db.insert(projects)
      .values([
        { slug: 'a/repo', name: 'A', installationId: 100 },
        { slug: 'b/repo', name: 'B', installationId: 200 },
        { slug: 'seed/demo', name: 'Seed', installationId: null },
      ])
      .run();

    const rows = listAutoMergeProjects();
    expect(rows.map((r) => r.slug)).toEqual(['a/repo', 'b/repo']);
  });

  it('returns empty when no projects have installation', () => {
    db.insert(projects).values({ slug: 'seed/demo', name: 'Seed', installationId: null }).run();
    expect(listAutoMergeProjects()).toEqual([]);
  });

  it('exposes autoMergeEnabled flag', () => {
    db.insert(projects)
      .values({
        slug: 'a/repo',
        name: 'A',
        installationId: 100,
        autoMergeEnabled: true,
      })
      .run();
    const rows = listAutoMergeProjects();
    expect(rows[0]?.autoMergeEnabled).toBe(true);
  });
});

describe('setProjectAutoMerge', () => {
  it('updates autoMergeEnabled on installed project', async () => {
    const inserted = db
      .insert(projects)
      .values({ slug: 'a/repo', name: 'A', installationId: 100, autoMergeEnabled: false })
      .returning({ id: projects.id })
      .get();

    const result = await setProjectAutoMerge(inserted.id, true);
    expect(result.kind).toBe('updated');
    if (result.kind === 'updated') {
      expect(result.row.autoMergeEnabled).toBe(true);
      // 활성 PR 이 없으므로 재트라이아지 대상도 0.
      expect(result.retriagedPrIds).toEqual([]);
    }
  });

  it('returns not-found when project missing', async () => {
    expect((await setProjectAutoMerge(9999, true)).kind).toBe('not-found');
  });

  it('returns not-found for seed projects (installationId null)', async () => {
    const inserted = db
      .insert(projects)
      .values({ slug: 'seed/demo', name: 'Seed', installationId: null })
      .returning({ id: projects.id })
      .get();

    expect((await setProjectAutoMerge(inserted.id, true)).kind).toBe('not-found');
  });
});

describe('setProjectAutoDeleteBranch', () => {
  it('toggles autoDeleteBranchEnabled (default false)', () => {
    const id = db
      .insert(projects)
      .values({ slug: 'a/repo', name: 'A', installationId: 100 })
      .returning({ id: projects.id })
      .get().id;
    // 디폴트 OFF.
    expect(
      db.select().from(projects).where(eq(projects.id, id)).get()?.autoDeleteBranchEnabled,
    ).toBe(false);

    const r = setProjectAutoDeleteBranch(id, true);
    expect(r.kind).toBe('updated');
    expect(
      db.select().from(projects).where(eq(projects.id, id)).get()?.autoDeleteBranchEnabled,
    ).toBe(true);
  });

  it('returns not-found for missing project', () => {
    expect(setProjectAutoDeleteBranch(9999, true).kind).toBe('not-found');
  });
});

describe('setProjectAiReview', () => {
  it('toggles aiReviewEnabled (default true)', () => {
    const id = db
      .insert(projects)
      .values({ slug: 'a/repo', name: 'A', installationId: 100 })
      .returning({ id: projects.id })
      .get().id;
    // 디폴트 ON.
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.aiReviewEnabled).toBe(true);

    expect(setProjectAiReview(id, false).kind).toBe('updated');
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.aiReviewEnabled).toBe(
      false,
    );
  });

  it('returns not-found for missing project', () => {
    expect(setProjectAiReview(9999, false).kind).toBe('not-found');
  });
});

describe('addProjectManually', () => {
  it('adds with installationId=null + autoMergeEnabled=false', () => {
    const r = addProjectManually({ slug: 'vercel/next.js' });
    expect(r.kind).toBe('added');
    const row = db.select().from(projects).where(eq(projects.slug, 'vercel/next.js')).get();
    expect(row?.installationId).toBeNull();
    expect(row?.autoMergeEnabled).toBe(false);
    expect(row?.name).toBe('vercel/next.js');
  });

  it('uses custom name when provided', () => {
    addProjectManually({ slug: 'a/b', name: 'My App' });
    const row = db.select().from(projects).where(eq(projects.slug, 'a/b')).get();
    expect(row?.name).toBe('My App');
  });

  it('rejects invalid slug', () => {
    expect(addProjectManually({ slug: '' }).kind).toBe('invalid-slug');
    expect(addProjectManually({ slug: 'no-slash' }).kind).toBe('invalid-slug');
    expect(addProjectManually({ slug: 'too/many/slashes' }).kind).toBe('invalid-slug');
    expect(addProjectManually({ slug: 'spaces / not ok' }).kind).toBe('invalid-slug');
  });

  it('rejects duplicate slug', () => {
    addProjectManually({ slug: 'a/b' });
    const r = addProjectManually({ slug: 'a/b' });
    expect(r.kind).toBe('duplicate');
    if (r.kind === 'duplicate') expect(r.existingId).toBeGreaterThan(0);
  });
});

describe('addProjectFromInstallation', () => {
  it('새 slug → added (installationId 채워서 삽입)', () => {
    const r = addProjectFromInstallation({
      slug: 'acme/web',
      name: 'Web',
      installationId: 12345,
    });
    expect(r.kind).toBe('added');
    const row = db.select().from(projects).where(eq(projects.slug, 'acme/web')).get();
    expect(row?.installationId).toBe(12345);
    expect(row?.name).toBe('Web');
  });

  it('수동 등록(installationId=null) 후 import → linked (installationId 채움)', () => {
    addProjectManually({ slug: 'a/b' });
    const r = addProjectFromInstallation({ slug: 'a/b', installationId: 999 });
    expect(r.kind).toBe('linked');
    const row = db.select().from(projects).where(eq(projects.slug, 'a/b')).get();
    expect(row?.installationId).toBe(999);
  });

  it('이미 installationId 가 있으면 already-linked (덮어쓰지 않음)', () => {
    addProjectFromInstallation({ slug: 'x/y', installationId: 111 });
    const r = addProjectFromInstallation({ slug: 'x/y', installationId: 222 });
    expect(r.kind).toBe('already-linked');
    const row = db.select().from(projects).where(eq(projects.slug, 'x/y')).get();
    expect(row?.installationId).toBe(111);
  });

  it('slug/installationId 형식 검증', () => {
    expect(addProjectFromInstallation({ slug: '', installationId: 1 }).kind).toBe('invalid-slug');
    expect(addProjectFromInstallation({ slug: 'noslash', installationId: 1 }).kind).toBe(
      'invalid-slug',
    );
    expect(addProjectFromInstallation({ slug: 'a/b', installationId: 0 }).kind).toBe(
      'invalid-slug',
    );
    expect(addProjectFromInstallation({ slug: 'a/b', installationId: -1 }).kind).toBe(
      'invalid-slug',
    );
  });
});
