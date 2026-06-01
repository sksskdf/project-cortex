// Phase 10.1 — .cortex/project.yml + .cortex/roadmap.md 파싱 + git → Cortex 동기화.
//
// 디자인 결정 (Decision Log 2026-05-22):
// - 새 라이브러리 추가 없이 자체 mini yaml/markdown 파서 구현. schema v1 의 단순 구조 한정.
// - 임의 yaml/markdown 형식은 지원 안 함 (위 박제 컨벤션만).
// - 같은 (project_id, key) 의 Phase 는 sync 시 갱신, 사용자가 source_override 한 행은 유지.

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { projects, roadmapItems, roadmapPhases } from '@/db/schema';
import { getRepoFileContent, type RepoRef } from './github';

// ============================================================================
// project.yml schema v1 — mini parser
// ============================================================================

export type ProjectMetaV1 = {
  schema: 1;
  name: string;
  slug: string;
  description?: string;
  kind?: string;
  status?: string;
  domain?: string;
  owners?: string[];
  tech?: { language?: string; framework?: string; database?: string };
  links?: { homepage?: string; docs?: string; issue_tracker?: string };
  automation?: {
    auto_merge?: boolean;
    ai_review?: boolean;
    auto_resolve_changes?: boolean;
    // Phase 13.2 — 머지 충돌을 claude CLI 로 자동 해결할지. 디폴트 OFF.
    auto_resolve_conflicts?: boolean;
    // Phase 13.x — CI 테스트 실패를 claude CLI 로 자동 수정할지. 디폴트 OFF.
    auto_fix_tests?: boolean;
  };
};

export type ParseYmlResult =
  | { kind: 'ok'; meta: ProjectMetaV1 }
  | { kind: 'error'; message: string };

// 매우 단순한 yaml subset 파서 — schema v1 만 지원.
// 지원: key: value (string/number/bool), nested object (2-space indent), list (- value),
// # comment, "quoted" 또는 'quoted' string. 그 외는 unsupported.
//
// 한계: anchor, alias, multiline string, flow-style ({}/[]) 미지원 — 위 schema v1 케이스 안에선 무관.
export function parseProjectYml(content: string): ParseYmlResult {
  try {
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, '').replace(/\s+$/, '')) // strip comment + trailing ws
      .filter((l) => l.trim().length > 0);

    // 각 라인을 (indent, content) 로 분리.
    type Tok = { indent: number; raw: string };
    const tokens: Tok[] = lines.map((l) => {
      const match = l.match(/^(\s*)(.*)$/);
      const indent = match![1].length;
      return { indent, raw: match![2] };
    });

    // recursive descent. indent 0 의 key-value 들이 root.
    // value 가 nested 면 다음 라인부터 indent 가 더 큰 토큰들이 children.
    function unquote(s: string): string {
      const t = s.trim();
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        return t.slice(1, -1);
      }
      return t;
    }

    function coerce(s: string): string | number | boolean {
      const v = unquote(s);
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (/^-?\d+$/.test(v)) return Number(v);
      return v;
    }

    type Node = Record<string, unknown> | unknown[];

    function parseObject(startIdx: number, parentIndent: number): { node: Node; nextIdx: number } {
      // 첫 토큰이 list 면 array, 아니면 object.
      const first = tokens[startIdx];
      if (!first || first.indent <= parentIndent) {
        return { node: {}, nextIdx: startIdx };
      }
      const baseIndent = first.indent;
      if (first.raw.startsWith('- ')) {
        // array
        const arr: unknown[] = [];
        let i = startIdx;
        while (
          i < tokens.length &&
          tokens[i].indent === baseIndent &&
          tokens[i].raw.startsWith('- ')
        ) {
          const elemRaw = tokens[i].raw.slice(2).trim();
          if (elemRaw.includes(': ')) {
            // 리스트 안 object — 첫 줄 + 후속 nested. 본 schema 에선 owners 정도라 단일 줄 처리.
            const colonIdx = elemRaw.indexOf(':');
            const key = elemRaw.slice(0, colonIdx).trim();
            const val = elemRaw.slice(colonIdx + 1).trim();
            arr.push({ [key]: val.length > 0 ? coerce(val) : null });
          } else {
            arr.push(coerce(elemRaw));
          }
          i++;
        }
        return { node: arr, nextIdx: i };
      }
      // object
      const obj: Record<string, unknown> = {};
      let i = startIdx;
      while (i < tokens.length && tokens[i].indent === baseIndent) {
        const raw = tokens[i].raw;
        const colonIdx = raw.indexOf(':');
        if (colonIdx < 0) {
          throw new Error(`unexpected line: ${raw}`);
        }
        const key = raw.slice(0, colonIdx).trim();
        const inlineVal = raw.slice(colonIdx + 1).trim();
        i++;
        if (inlineVal.length > 0) {
          obj[key] = coerce(inlineVal);
        } else {
          // nested.
          const { node, nextIdx } = parseObject(i, baseIndent);
          obj[key] = node;
          i = nextIdx;
        }
      }
      return { node: obj, nextIdx: i };
    }

    const { node: root } = parseObject(0, -1);
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
      return { kind: 'error', message: 'project.yml root must be an object' };
    }

    // schema 검증.
    const obj = root as Record<string, unknown>;
    if (obj.schema !== 1) {
      return { kind: 'error', message: `schema 필드 누락 또는 미지원 버전 — '1' 만 지원` };
    }
    if (typeof obj.name !== 'string' || obj.name.length === 0) {
      return { kind: 'error', message: 'name 필드는 필수 (문자열)' };
    }
    if (typeof obj.slug !== 'string' || obj.slug.length === 0) {
      return { kind: 'error', message: 'slug 필드는 필수 (문자열)' };
    }

    // owners 가 array of string 또는 array of { ... } 든 string 만 추출.
    let owners: string[] | undefined;
    if (Array.isArray(obj.owners)) {
      owners = obj.owners
        .map((o) => (typeof o === 'string' ? o : null))
        .filter((o): o is string => o !== null);
    }

    const meta: ProjectMetaV1 = {
      schema: 1,
      name: obj.name,
      slug: obj.slug,
      description: typeof obj.description === 'string' ? obj.description : undefined,
      kind: typeof obj.kind === 'string' ? obj.kind : undefined,
      status: typeof obj.status === 'string' ? obj.status : undefined,
      domain: typeof obj.domain === 'string' ? obj.domain : undefined,
      owners,
      tech:
        typeof obj.tech === 'object' && obj.tech !== null
          ? (obj.tech as ProjectMetaV1['tech'])
          : undefined,
      links:
        typeof obj.links === 'object' && obj.links !== null
          ? (obj.links as ProjectMetaV1['links'])
          : undefined,
      automation:
        typeof obj.automation === 'object' && obj.automation !== null
          ? (obj.automation as ProjectMetaV1['automation'])
          : undefined,
    };

    return { kind: 'ok', meta };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================================
// roadmap.md 컨벤션 파서
// ============================================================================

export type ParsedRoadmapItem = {
  title: string;
  done: boolean;
};

export type ParsedRoadmapPhase = {
  key: string;
  title: string;
  goal: string | null;
  items: ParsedRoadmapItem[];
};

export function parseRoadmapMd(content: string): ParsedRoadmapPhase[] {
  const lines = content.split(/\r?\n/);
  const phases: ParsedRoadmapPhase[] = [];
  let current: ParsedRoadmapPhase | null = null;
  let goalLines: string[] = [];
  let sawList = false;

  function flushGoal() {
    if (current && current.goal === null) {
      const goal = goalLines.join('\n').trim();
      if (goal.length > 0) current.goal = goal;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine;
    // Phase heading: '## Phase <key> — <title>' (em-dash or hyphen 둘 다 허용) 또는 '## Phase <key>'
    // 키는 점 구분 세그먼트 허용 — `4.7`·`13.6` 같은 sub-Phase. 끝 문장부호(`.`)는 키 미포함.
    const headingMatch = line.match(
      /^##\s+Phase\s+([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(?:\s+[—\-]\s+(.+))?$/,
    );
    if (headingMatch) {
      flushGoal();
      current = {
        key: headingMatch[1],
        title: (headingMatch[2] ?? headingMatch[1]).trim(),
        goal: null,
        items: [],
      };
      // 같은 key 가 여러 번 — 첫 번째만 채택.
      if (!phases.some((p) => p.key === current!.key)) {
        phases.push(current);
      } else {
        current = phases.find((p) => p.key === headingMatch[1])!;
      }
      goalLines = [];
      sawList = false;
      continue;
    }
    if (!current) continue;

    // item: '- [x] text' / '- [ ] text'
    const itemMatch = line.match(/^\s*-\s*\[([ xX])\]\s+(.+)$/);
    if (itemMatch) {
      // 첫 list 직전에 goal flush — 이후 list 라인이 들어와도 goal 은 한 번만.
      if (!sawList) flushGoal();
      const done = itemMatch[1].toLowerCase() === 'x';
      const title = itemMatch[2].trim();
      current.items.push({ title, done });
      sawList = true;
      continue;
    }

    // goal 영역 — heading 다음, 첫 list 전 까지 빈 줄 아닌 라인 모음.
    if (!sawList && line.trim().length > 0) {
      goalLines.push(line.trim());
    }
  }
  flushGoal();

  return phases;
}

// ============================================================================
// Sync 흐름
// ============================================================================

export type SyncResult =
  | {
      kind: 'synced';
      metaUpdated: boolean;
      phasesAdded: number;
      phasesUpdated: number;
      itemsAdded: number;
      itemsUpdated: number;
    }
  | { kind: 'no-installation' }
  | { kind: 'no-project' }
  | { kind: 'meta-parse-error'; message: string }
  | { kind: 'no-meta-file' };

// .cortex/project.yml + .cortex/roadmap.md fetch + DB upsert.
// project.yml 이 없으면 sync skip (사용자가 아직 .cortex 추가 안 함).
// roadmap.md 가 없으면 메타만 sync + roadmap 항목 변경 안 함.
//
// source_override_at 이 채워진 git 행은 sync 가 안 건드림 (사용자 수정 보존).
export async function syncProjectFromGit(projectId: number): Promise<SyncResult> {
  const project = db
    .select({
      id: projects.id,
      slug: projects.slug,
      installationId: projects.installationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) return { kind: 'no-project' };
  if (project.installationId === null) return { kind: 'no-installation' };

  const [owner, repo] = project.slug.split('/');
  const ref: RepoRef = { owner, repo };

  const ymlFile = await getRepoFileContent(project.installationId, ref, '.cortex/project.yml');
  if (!ymlFile) return { kind: 'no-meta-file' };

  const parsed = parseProjectYml(ymlFile.content);
  if (parsed.kind === 'error') {
    return { kind: 'meta-parse-error', message: parsed.message };
  }
  const meta = parsed.meta;

  // 메타 upsert. automation 정책은 명시 있을 때만 덮어씀 (기존 DB 토글 보존).
  const updateFields: Record<string, unknown> = {
    name: meta.name,
    description: meta.description ?? null,
    kind: meta.kind ?? null,
    domain: meta.domain ?? null,
    homepage: meta.links?.homepage ?? null,
    metaSyncedAt: new Date(),
  };
  if (meta.automation?.auto_merge !== undefined) {
    updateFields.autoMergeEnabled = meta.automation.auto_merge;
  }
  if (meta.automation?.auto_resolve_conflicts !== undefined) {
    updateFields.autoResolveConflictsEnabled = meta.automation.auto_resolve_conflicts;
  }
  if (meta.automation?.auto_fix_tests !== undefined) {
    updateFields.autoFixTestsEnabled = meta.automation.auto_fix_tests;
  }
  if (meta.automation?.auto_resolve_changes !== undefined) {
    updateFields.autoResolveChangesEnabled = meta.automation.auto_resolve_changes;
  }
  db.update(projects).set(updateFields).where(eq(projects.id, projectId)).run();

  const metaUpdated = true;
  let phasesAdded = 0;
  let phasesUpdated = 0;
  let itemsAdded = 0;
  let itemsUpdated = 0;

  // roadmap.md fetch + 파싱.
  const mdFile = await getRepoFileContent(project.installationId, ref, '.cortex/roadmap.md');
  if (mdFile) {
    const parsedPhases = parseRoadmapMd(mdFile.content);

    // 기존 git 행 한 번 모두 가져옴 (project 안의 phase + items).
    const existingPhases = db
      .select()
      .from(roadmapPhases)
      .where(eq(roadmapPhases.projectId, projectId))
      .all();
    const phaseByKey = new Map(existingPhases.map((p) => [p.key, p]));

    for (let i = 0; i < parsedPhases.length; i++) {
      const p = parsedPhases[i];
      const existing = phaseByKey.get(p.key);

      if (!existing) {
        // 새 phase 생성 (source='git').
        const inserted = db
          .insert(roadmapPhases)
          .values({
            projectId,
            key: p.key,
            title: p.title,
            goal: p.goal,
            source: 'git',
            sortOrder: i,
          })
          .returning({ id: roadmapPhases.id })
          .get();
        for (let j = 0; j < p.items.length; j++) {
          const it = p.items[j];
          db.insert(roadmapItems)
            .values({
              phaseId: inserted.id,
              title: it.title,
              status: it.done ? 'done' : 'planned',
              source: 'git',
              sortOrder: j,
            })
            .run();
          itemsAdded++;
        }
        phasesAdded++;
      } else if (existing.source === 'git' && existing.sourceOverrideAt === null) {
        // git source 이고 사용자 수정 없음 — 갱신.
        db.update(roadmapPhases)
          .set({
            title: p.title,
            goal: p.goal,
            sortOrder: i,
            updatedAt: new Date(),
          })
          .where(eq(roadmapPhases.id, existing.id))
          .run();
        phasesUpdated++;

        // items: title 매칭으로 갱신 / 없으면 추가 / git source 인 잉여는 삭제.
        const existingItems = db
          .select()
          .from(roadmapItems)
          .where(eq(roadmapItems.phaseId, existing.id))
          .all();
        const itemByTitle = new Map(existingItems.map((it) => [it.title, it]));
        for (let j = 0; j < p.items.length; j++) {
          const it = p.items[j];
          const exItem = itemByTitle.get(it.title);
          if (!exItem) {
            db.insert(roadmapItems)
              .values({
                phaseId: existing.id,
                title: it.title,
                status: it.done ? 'done' : 'planned',
                source: 'git',
                sortOrder: j,
              })
              .run();
            itemsAdded++;
          } else if (exItem.source === 'git' && exItem.sourceOverrideAt === null) {
            // git item 갱신 — done 상태는 마크다운 우선 (단, doneByPrId 가 있으면 보존).
            const nextStatus = it.done
              ? 'done'
              : exItem.doneByPrId !== null
                ? exItem.status
                : 'planned';
            db.update(roadmapItems)
              .set({
                status: nextStatus,
                sortOrder: j,
                updatedAt: new Date(),
              })
              .where(eq(roadmapItems.id, exItem.id))
              .run();
            itemsUpdated++;
          }
          // sourceOverride 있으면 안 건드림.
        }
        // 마크다운에서 사라진 git item 제거 (manual 또는 override 는 보존).
        const incomingTitles = new Set(p.items.map((it) => it.title));
        const toDelete = existingItems.filter(
          (it) =>
            it.source === 'git' && it.sourceOverrideAt === null && !incomingTitles.has(it.title),
        );
        if (toDelete.length > 0) {
          db.delete(roadmapItems)
            .where(
              inArray(
                roadmapItems.id,
                toDelete.map((it) => it.id),
              ),
            )
            .run();
        }
      }
      // existing 이 manual 또는 override 면 안 건드림.
    }

    // 마크다운에서 사라진 git phase 제거 (manual / override 보존).
    const incomingKeys = new Set(parsedPhases.map((p) => p.key));
    const phasesToDelete = existingPhases.filter(
      (p) => p.source === 'git' && p.sourceOverrideAt === null && !incomingKeys.has(p.key),
    );
    for (const p of phasesToDelete) {
      // 해당 phase 의 git items (override 없는) 만 함께 제거. manual/override item 이 있으면
      // phase 도 manual 로 강등 (FK 보존).
      const childItems = db.select().from(roadmapItems).where(eq(roadmapItems.phaseId, p.id)).all();
      const survivingItems = childItems.filter(
        (it) => it.source === 'manual' || it.sourceOverrideAt !== null,
      );
      const ephemeralItems = childItems.filter(
        (it) => it.source === 'git' && it.sourceOverrideAt === null,
      );
      if (ephemeralItems.length > 0) {
        db.delete(roadmapItems)
          .where(
            inArray(
              roadmapItems.id,
              ephemeralItems.map((it) => it.id),
            ),
          )
          .run();
      }
      if (survivingItems.length === 0) {
        db.delete(roadmapPhases).where(eq(roadmapPhases.id, p.id)).run();
      } else {
        // 사용자가 수정한 자식이 있으면 phase 는 manual 로 강등.
        db.update(roadmapPhases)
          .set({ source: 'manual', updatedAt: new Date() })
          .where(eq(roadmapPhases.id, p.id))
          .run();
      }
    }
  }

  return { kind: 'synced', metaUpdated, phasesAdded, phasesUpdated, itemsAdded, itemsUpdated };
}

// Phase 10.2 — push webhook 자동 sync 진입점.
// 호출자 (webhook route) 가 이미 default branch push + `.cortex/` 변경 감지 후 호출.
// slug 로 project 매칭. 등록 안 된 레포 (Cortex 가 첫 webhook 받기 전) 는 skip.
export type PushSyncResult = SyncResult | { kind: 'no-project-for-slug' };

export async function handlePushEvent(input: {
  slug: string;
  installationId: number;
}): Promise<PushSyncResult> {
  const project = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, input.slug))
    .get();
  if (!project) return { kind: 'no-project-for-slug' };
  return syncProjectFromGit(project.id);
}

// Phase 10.2 — page-visit stale-while-revalidate.
// /projects/[id]/roadmap 진입 시 metaSyncedAt 이 TTL 보다 오래됐으면 (또는 한 번도 sync
// 안 됐으면) 백그라운드 sync 트리거. 사용자가 "동기화" 버튼 안 눌러도 자연 갱신.
const SYNC_TTL_MS = 5 * 60 * 1000; // 5 분

export function isMetaStale(projectId: number): boolean {
  const row = db
    .select({ syncedAt: projects.metaSyncedAt, installationId: projects.installationId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!row) return false;
  // installation 없는 시드 프로젝트는 sync 자체 불가 → stale 판단 무관.
  if (row.installationId === null) return false;
  if (row.syncedAt === null) return true;
  const ageMs = Date.now() - row.syncedAt.getTime();
  return ageMs > SYNC_TTL_MS;
}

// Background sync — page server component 가 호출. 결과는 무시 (다음 RSC refresh 에 반영).
// 실패해도 페이지 렌더는 영향 X (try/catch).
export async function backgroundSyncIfStale(projectId: number): Promise<void> {
  if (!isMetaStale(projectId)) return;
  try {
    await syncProjectFromGit(projectId);
  } catch (err) {
    console.error(`background meta sync failed (project ${projectId}):`, err);
  }
}
