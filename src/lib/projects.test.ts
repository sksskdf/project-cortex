import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { projects } from '@/db/schema';
import { listAutoMergeProjects, setProjectAutoMerge } from './projects';

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
  it('updates autoMergeEnabled on installed project', () => {
    const inserted = db
      .insert(projects)
      .values({ slug: 'a/repo', name: 'A', installationId: 100, autoMergeEnabled: false })
      .returning({ id: projects.id })
      .get();

    const result = setProjectAutoMerge(inserted.id, true);
    expect(result.kind).toBe('updated');
    if (result.kind === 'updated') {
      expect(result.row.autoMergeEnabled).toBe(true);
    }
  });

  it('returns not-found when project missing', () => {
    expect(setProjectAutoMerge(9999, true).kind).toBe('not-found');
  });

  it('returns not-found for seed projects (installationId null)', () => {
    const inserted = db
      .insert(projects)
      .values({ slug: 'seed/demo', name: 'Seed', installationId: null })
      .returning({ id: projects.id })
      .get();

    expect(setProjectAutoMerge(inserted.id, true).kind).toBe('not-found');
  });
});
