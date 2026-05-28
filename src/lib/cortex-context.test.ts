import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { projects, roadmapItems, roadmapPhases } from '@/db/schema';
import { buildCortexContextPreamble } from './cortex-context';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(roadmapItems).run();
  db.delete(roadmapPhases).run();
  db.delete(projects).run();
});

function seedProject(slug = 'acme/web'): number {
  return db.insert(projects).values({ slug, name: slug }).returning({ id: projects.id }).get().id;
}

describe('buildCortexContextPreamble', () => {
  it('always includes the Cortex conventions pointer', () => {
    const projectId = seedProject();
    const out = buildCortexContextPreamble(projectId);
    expect(out).toContain('Cortex 컨텍스트');
    expect(out).toContain('cortex` 스킬');
    expect(out).toContain('.cortex/roadmap.md');
  });

  it('summarizes open roadmap items when present', () => {
    const projectId = seedProject();
    const phaseId = db
      .insert(roadmapPhases)
      .values({ projectId, key: '3', title: 'GitHub 통합', sortOrder: 0 })
      .returning({ id: roadmapPhases.id })
      .get().id;
    db.insert(roadmapItems)
      .values({ phaseId, title: 'webhook 수신', status: 'in-progress', sortOrder: 0 })
      .run();
    db.insert(roadmapItems)
      .values({ phaseId, title: 'done item', status: 'done', sortOrder: 1 })
      .run();

    const out = buildCortexContextPreamble(projectId);
    expect(out).toContain('로드맵 남은 작업');
    expect(out).toContain('Phase 3 GitHub 통합');
    expect(out).toContain('webhook 수신');
    // done 항목은 요약에서 제외.
    expect(out).not.toContain('done item');
  });

  it('omits roadmap section when no open items', () => {
    const projectId = seedProject();
    const out = buildCortexContextPreamble(projectId);
    expect(out).not.toContain('로드맵 남은 작업');
  });
});
