import type { Octokit } from '@octokit/rest';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/client';
import { issues, projects, roadmapItems, roadmapPhases } from '@/db/schema';
import { setOctokit } from './github';
import {
  descriptiveMetaFields,
  isCortexSyncCommit,
  parseProjectYml,
  parseRoadmapMd,
  serializeRoadmapToMd,
  syncProjectFromGit,
  type ProjectMetaV1,
} from './project-meta';

describe('parseProjectYml — schema v1', () => {
  it('parses minimal valid file (schema + name + slug)', () => {
    const yml = `schema: 1
name: project-cortex
slug: sksskdf/project-cortex`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.schema).toBe(1);
      expect(r.meta.name).toBe('project-cortex');
      expect(r.meta.slug).toBe('sksskdf/project-cortex');
    }
  });

  it('rejects missing schema field', () => {
    const yml = `name: x\nslug: o/x`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/schema/);
  });

  it('rejects schema other than 1', () => {
    const yml = `schema: 2\nname: x\nslug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('error');
  });

  it('rejects missing name', () => {
    const yml = `schema: 1\nslug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('error');
  });

  it('parses nested object (tech / links / automation)', () => {
    const yml = `schema: 1
name: x
slug: o/x
description: one-liner
kind: web-app
domain: code-review
tech:
  language: TypeScript
  framework: Next.js 15
links:
  homepage: https://example.com
  issue_tracker: github
automation:
  auto_merge: true
  ai_review: false`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.description).toBe('one-liner');
      expect(r.meta.kind).toBe('web-app');
      expect(r.meta.tech?.language).toBe('TypeScript');
      expect(r.meta.links?.homepage).toBe('https://example.com');
      expect(r.meta.automation?.auto_merge).toBe(true);
      expect(r.meta.automation?.ai_review).toBe(false);
    }
  });

  it('parses list (owners)', () => {
    const yml = `schema: 1
name: x
slug: o/x
owners:
  - alice
  - bob`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.owners).toEqual(['alice', 'bob']);
    }
  });

  it('ignores # comments + trailing whitespace', () => {
    const yml = `# comment line
schema: 1   # inline comment
name: x
slug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('ok');
  });

  it('handles quoted strings', () => {
    const yml = `schema: 1
name: "with: colon"
slug: 'o/x'`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.name).toBe('with: colon');
      expect(r.meta.slug).toBe('o/x');
    }
  });

  // 회귀(리뷰 발견): 예전엔 `.replace(/#.*$/, '')` 가 URL fragment, hex 색, 따옴표 속 `#` 까지 잘라먹어
  // homepage·name 등이 훼손됐다. 이제는 `#` 가 라인 시작/공백 직후일 때만 주석으로 본다.
  it('preserves # inside URL fragment / hex color / unquoted value (공백 없는 #)', () => {
    const yml = `schema: 1
name: x
slug: o/x
links:
  homepage: https://example.com/page#section`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.links?.homepage).toBe('https://example.com/page#section');
    }
  });

  it('preserves # inside quoted string (따옴표 안의 # 은 주석 아님)', () => {
    const yml = `schema: 1
name: "a # b"
slug: o/x`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.name).toBe('a # b'); // 예전: "a 로 깨졌음.
    }
  });

  // 회귀(리뷰 발견): coerce 가 숫자 문자열을 Number 로 강제 변환해 `typeof !== 'string'` 검증에서
  // 떨어지고 sync 가 통째로 실패했다. 이제는 boolean 만 coerce, 숫자형 문자열은 그대로 string.
  it('numeric-looking name/slug 도 문자열로 받아 sync 실패하지 않음', () => {
    const yml = `schema: 1
name: 2024
slug: 2024/release`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.name).toBe('2024');
      expect(r.meta.slug).toBe('2024/release');
    }
  });

  it('automation boolean 토글은 여전히 coerce (회귀 확인)', () => {
    const yml = `schema: 1
name: x
slug: o/x
automation:
  auto_merge: true
  ai_review: false`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.automation?.auto_merge).toBe(true);
      expect(r.meta.automation?.ai_review).toBe(false);
    }
  });

  it('schema: "1"(quoted) 도 schema: 1 도 동일하게 받아들임', () => {
    const ymlQuoted = `schema: "1"\nname: x\nslug: o/x`;
    const ymlUnquoted = `schema: 1\nname: x\nslug: o/x`;
    expect(parseProjectYml(ymlQuoted).kind).toBe('ok');
    expect(parseProjectYml(ymlUnquoted).kind).toBe('ok');
  });
});

describe('parseRoadmapMd', () => {
  it('parses phase with key + title + items', () => {
    const md = `# Roadmap

## Phase auth — 인증 시스템

- [x] OAuth 연동
- [ ] 2FA 추가`;
    const phases = parseRoadmapMd(md);
    expect(phases).toHaveLength(1);
    expect(phases[0].key).toBe('auth');
    expect(phases[0].title).toBe('인증 시스템');
    expect(phases[0].items).toHaveLength(2);
    expect(phases[0].items[0]).toEqual({ title: 'OAuth 연동', status: 'done' });
    expect(phases[0].items[1]).toEqual({ title: '2FA 추가', status: 'planned' });
  });

  it('parses [~] as in-progress (예전엔 통째로 유실 → sync 가 DB 행 삭제)', () => {
    const md = `## Phase x — X

- [x] 완료
- [~] 진행 중
- [ ] 예정`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].items).toEqual([
      { title: '완료', status: 'done' },
      { title: '진행 중', status: 'in-progress' },
      { title: '예정', status: 'planned' },
    ]);
  });

  it('uses key as title when no em-dash', () => {
    const md = `## Phase launch\n\n- [ ] 결제`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].title).toBe('launch');
  });

  it('captures goal paragraph between heading and first item', () => {
    const md = `## Phase launch — 출시

목표: 결제 + 운영 메트릭 완비.

- [ ] 결제`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].goal).toBe('목표: 결제 + 운영 메트릭 완비.');
  });

  it('handles multiple phases', () => {
    const md = `## Phase a — A
- [x] a1

## Phase b — B
- [ ] b1
- [ ] b2`;
    const phases = parseRoadmapMd(md);
    expect(phases).toHaveLength(2);
    expect(phases[0].key).toBe('a');
    expect(phases[1].key).toBe('b');
    expect(phases[1].items).toHaveLength(2);
  });

  it('skips non-item lines outside heading', () => {
    const md = `random preamble

## Phase x — X
- [x] item1
random tail text
- [ ] item2`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].items).toHaveLength(2);
  });

  it('handles uppercase X in checkbox', () => {
    const md = `## Phase x — X\n- [X] done`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].items[0].status).toBe('done');
  });

  // 점 구분 키 — 4.7·13.6 같은 sub-Phase. cortex 자체 roadmap 이 쓰는 형식.
  it('parses dotted phase keys (4.5 / 13.6) and treats them as distinct from parent', () => {
    const md = `## Phase 4 — A\n- [x] a\n## Phase 4.5 — B\n- [ ] b\n## Phase 13.6 — C\n- [x] c`;
    const phases = parseRoadmapMd(md);
    expect(phases.map((p) => p.key)).toEqual(['4', '4.5', '13.6']);
    expect(phases.map((p) => p.title)).toEqual(['A', 'B', 'C']);
  });
});

describe('serializeRoadmapToMd + isCortexSyncCommit — Phase 10.4', () => {
  it('round-trip: parseRoadmapMd(serialize(x)) 가 key/title/item-status(in-progress 포함) 보존', () => {
    const input = [
      {
        key: '13.6',
        title: 'claude CLI 최신 활용',
        goal: '리서치 기반 고도화.',
        items: [
          { title: '리서치 보고서', status: 'done' as const },
          { title: '1단계 적용', status: 'in-progress' as const },
          { title: '평가', status: 'planned' as const },
        ],
      },
      {
        key: '14',
        title: '14',
        goal: null,
        items: [{ title: 'HelpOverlay', status: 'done' as const }],
      },
    ];
    const md = serializeRoadmapToMd(input);
    const parsed = parseRoadmapMd(md);
    expect(parsed.map((p) => p.key)).toEqual(['13.6', '14']);
    expect(parsed[0].title).toBe('claude CLI 최신 활용');
    expect(parsed[0].goal).toBe('리서치 기반 고도화.');
    // in-progress 가 `[~]` 로 직렬화돼 다시 in-progress 로 파싱 (예전엔 `[ ]` 로 강등됐음).
    expect(parsed[0].items).toEqual([
      { title: '리서치 보고서', status: 'done' },
      { title: '1단계 적용', status: 'in-progress' },
      { title: '평가', status: 'planned' },
    ]);
    // title===key 면 em-dash 생략 → parse 시 key 가 title 폴백.
    expect(parsed[1].title).toBe('14');
  });

  it('빈 title item 은 직렬화에서 스킵 (round-trip 오염 방지)', () => {
    const md = serializeRoadmapToMd([
      {
        key: '1',
        title: 'P',
        goal: null,
        items: [
          { title: '실제', status: 'planned' as const },
          { title: '   ', status: 'done' as const }, // 빈/공백 → 스킵
        ],
      },
    ]);
    const parsed = parseRoadmapMd(md);
    expect(parsed[0].items).toEqual([{ title: '실제', status: 'planned' }]);
  });

  it('빈 로드맵은 헤더만', () => {
    expect(serializeRoadmapToMd([]).trim()).toBe('# Roadmap');
  });

  it('isCortexSyncCommit — 마커 trailer 인식 (대소문자·위치 무관)', () => {
    expect(isCortexSyncCommit('docs: roadmap\n\nCortex-Sync: roadmap')).toBe(true);
    expect(isCortexSyncCommit('cortex-sync: roadmap')).toBe(true);
    expect(isCortexSyncCommit('feat: 일반 commit')).toBe(false);
    expect(isCortexSyncCommit('Cortex: ready')).toBe(false); // 자동 머지 신호와 구분
  });
});

describe('descriptiveMetaFields — 자동화 토글은 git sync 제외 (로컬 DB 전용)', () => {
  const meta: ProjectMetaV1 = {
    schema: 1,
    name: 'proj',
    slug: 'o/proj',
    description: 'desc',
    kind: 'web-app',
    domain: 'code-review',
    links: { homepage: 'https://h' },
    // project.yml 에 automation 이 있어도 sync 대상이 아니어야 함.
    automation: {
      auto_merge: true,
      ai_review: true,
      auto_resolve_conflicts: true,
      auto_fix_tests: true,
      auto_resolve_changes: true,
    },
  };

  it('서술 메타만 포함 (name/description/kind/domain/homepage/metaSyncedAt)', () => {
    const fields = descriptiveMetaFields(meta);
    expect(Object.keys(fields).sort()).toEqual(
      ['description', 'domain', 'homepage', 'kind', 'metaSyncedAt', 'name'].sort(),
    );
    expect(fields.name).toBe('proj');
    expect(fields.homepage).toBe('https://h');
  });

  it('자동화 토글 키는 절대 포함 안 됨 (UI 설정 보존)', () => {
    const fields = descriptiveMetaFields(meta);
    for (const k of [
      'autoMergeEnabled',
      'aiReviewEnabled',
      'autoResolveConflictsEnabled',
      'autoFixTestsEnabled',
      'autoResolveChangesEnabled',
      'muted',
    ]) {
      expect(fields).not.toHaveProperty(k);
    }
  });
});

// 회귀(리뷰 발견): syncProjectFromGit 가 issues.roadmap_item_id 가 가리키는 roadmap item 을 삭제
// 시도하면 SQLITE_CONSTRAINT_FOREIGNKEY 가 throw 됐다. 그 앞의 phase·item upsert 와 project
// meta 갱신은 이미 영속화돼 있어 부분 쓰기로 남았다. 이제는 db.transaction 으로 묶고, issues 가
// 참조하는 item 은 삭제 대신 source='manual' 강등으로 보존한다.
describe('syncProjectFromGit — 트랜잭션 + issues FK 가드', () => {
  // octokit.repos.getContent 를 yml + md 두 파일에 대해 분기 응답. base64 encoded content 반환
  // (getRepoFileContent 의 디코딩 경로 시뮬). 그 외 path 는 404.
  function mockGithubContent(opts: { yml?: string; md?: string }): Octokit {
    return {
      repos: {
        getContent: vi.fn().mockImplementation(async ({ path }: { path: string }) => {
          if (path === '.cortex/project.yml' && opts.yml !== undefined) {
            return {
              data: {
                type: 'file',
                content: Buffer.from(opts.yml).toString('base64'),
                sha: 'sha-yml',
              },
            };
          }
          if (path === '.cortex/roadmap.md' && opts.md !== undefined) {
            return {
              data: {
                type: 'file',
                content: Buffer.from(opts.md).toString('base64'),
                sha: 'sha-md',
              },
            };
          }
          throw Object.assign(new Error('not found'), { status: 404 });
        }),
      },
    } as unknown as Octokit;
  }

  beforeAll(() => {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
  });

  beforeEach(() => {
    db.delete(issues).run();
    db.delete(roadmapItems).run();
    db.delete(roadmapPhases).run();
    db.delete(projects).run();
  });

  afterEach(() => setOctokit(null));

  function seedProject(slug = 'acme/web'): number {
    return db
      .insert(projects)
      .values({ slug, name: slug, installationId: 12345 })
      .returning({ id: projects.id })
      .get().id;
  }

  it('issues 가 참조하는 stale git item 은 삭제 대신 source=manual 로 강등 (FK throw 없음)', async () => {
    const projectId = seedProject();
    // git sync 가 만들 phase + 2 item 을 미리 시드.
    const phase = db
      .insert(roadmapPhases)
      .values({ projectId, key: '1', title: 'Phase 1', source: 'git', sortOrder: 0 })
      .returning({ id: roadmapPhases.id })
      .get();
    const keptItem = db
      .insert(roadmapItems)
      .values({
        phaseId: phase.id,
        title: '유지 항목',
        status: 'planned',
        source: 'git',
        sortOrder: 0,
      })
      .returning({ id: roadmapItems.id })
      .get();
    const referencedItem = db
      .insert(roadmapItems)
      .values({
        phaseId: phase.id,
        title: '연결된 사라질 항목',
        status: 'planned',
        source: 'git',
        sortOrder: 1,
      })
      .returning({ id: roadmapItems.id })
      .get();
    // issue 가 referencedItem 을 참조 — 이게 있으면 git 에서 사라져도 삭제 못 함.
    db.insert(issues)
      .values({
        repoId: projectId,
        title: 'related issue',
        spec: 'spec body',
        assigneeKind: 'human',
        assigneeId: 'me',
        roadmapItemId: referencedItem.id,
      })
      .run();

    // 새 roadmap.md 는 referencedItem 의 제목이 없음 → stale 로 분류돼야.
    setOctokit(
      mockGithubContent({
        yml: 'schema: 1\nname: web\nslug: acme/web',
        md: '## Phase 1 — Phase 1\n\n- [ ] 유지 항목',
      }),
    );

    const r = await syncProjectFromGit(projectId);
    expect(r.kind).toBe('synced');

    // referencedItem 은 살아 있고 source='manual' 로 강등됨.
    const after = db
      .select()
      .from(roadmapItems)
      .where(eq(roadmapItems.id, referencedItem.id))
      .get();
    expect(after).toBeDefined();
    expect(after?.source).toBe('manual');
    // keptItem 은 그대로.
    const kept = db.select().from(roadmapItems).where(eq(roadmapItems.id, keptItem.id)).get();
    expect(kept?.source).toBe('git');
  });

  it('참조 없는 stale git item 은 기존처럼 삭제', async () => {
    const projectId = seedProject();
    const phase = db
      .insert(roadmapPhases)
      .values({ projectId, key: '1', title: 'Phase 1', source: 'git', sortOrder: 0 })
      .returning({ id: roadmapPhases.id })
      .get();
    const staleItem = db
      .insert(roadmapItems)
      .values({
        phaseId: phase.id,
        title: '곧 사라질 항목',
        status: 'planned',
        source: 'git',
        sortOrder: 0,
      })
      .returning({ id: roadmapItems.id })
      .get();

    setOctokit(
      mockGithubContent({
        yml: 'schema: 1\nname: web\nslug: acme/web',
        md: '## Phase 1 — Phase 1\n\n- [ ] 새 항목', // staleItem 의 제목 없음.
      }),
    );

    const r = await syncProjectFromGit(projectId);
    expect(r.kind).toBe('synced');
    const after = db.select().from(roadmapItems).where(eq(roadmapItems.id, staleItem.id)).get();
    expect(after).toBeUndefined(); // 정상 삭제.
  });

  it('단일 트랜잭션 — 정상 흐름은 끝까지 영속화', async () => {
    const projectId = seedProject();
    setOctokit(
      mockGithubContent({
        yml: 'schema: 1\nname: web\nslug: acme/web\ndescription: test',
        md: '## Phase 1 — Phase 1\n\n- [x] 완료 항목\n- [~] 진행 항목',
      }),
    );

    const r = await syncProjectFromGit(projectId);
    expect(r.kind).toBe('synced');

    // 메타 갱신 확인.
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    expect(project?.description).toBe('test');
    // phase + 2 item 모두 영속화.
    const phaseRows = db
      .select()
      .from(roadmapPhases)
      .where(eq(roadmapPhases.projectId, projectId))
      .all();
    expect(phaseRows).toHaveLength(1);
    const itemRows = db
      .select()
      .from(roadmapItems)
      .where(eq(roadmapItems.phaseId, phaseRows[0].id))
      .all();
    expect(itemRows).toHaveLength(2);
    expect(itemRows.find((it) => it.title === '완료 항목')?.status).toBe('done');
    expect(itemRows.find((it) => it.title === '진행 항목')?.status).toBe('in-progress');
  });
});
