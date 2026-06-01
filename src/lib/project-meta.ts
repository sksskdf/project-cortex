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

// 로드맵 산출물 상태 — DB roadmap_items.status enum 과 동일.
export type RoadmapItemStatus = 'planned' | 'in-progress' | 'done';

// 체크박스 마커 → 상태. `[x]`/`[X]`=done, `[~]`=in-progress, `[ ]`=planned.
export function checkboxToStatus(mark: string): RoadmapItemStatus {
  const c = mark.toLowerCase();
  return c === 'x' ? 'done' : c === '~' ? 'in-progress' : 'planned';
}

// 상태 → 체크박스 마커 (직렬화).
export function statusToCheckbox(status: RoadmapItemStatus): string {
  return status === 'done' ? 'x' : status === 'in-progress' ? '~' : ' ';
}

export type ParsedRoadmapItem = {
  title: string;
  status: RoadmapItemStatus;
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

    // item: '- [x] text' / '- [ ] text' / '- [~] text'(in-progress). 예전엔 `[~]` 를 regex 가
    // 못 잡아 통째로 유실 → sync 가 "마크다운에서 사라진 항목"으로 보고 DB 행을 삭제했다(리뷰 발견:
    // .cortex/roadmap.md 가 `[~]` 를 광범위하게 써서 sync 마다 in-progress 산출물이 삭제·소실).
    const itemMatch = line.match(/^\s*-\s*\[([ xX~])\]\s+(.+)$/);
    if (itemMatch) {
      // 첫 list 직전에 goal flush — 이후 list 라인이 들어와도 goal 은 한 번만.
      if (!sawList) flushGoal();
      const status = checkboxToStatus(itemMatch[1]);
      const title = itemMatch[2].trim();
      current.items.push({ title, status });
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

// git sync 가 DB 에 쓰는 **서술 메타만** — name·description·kind·domain·homepage·metaSyncedAt.
// 자동화 토글(autoMergeEnabled·autoResolveConflictsEnabled·autoFixTestsEnabled·
// autoResolveChangesEnabled·aiReviewEnabled·muted)은 **로컬 DB 전용**이라 절대 포함하지 않는다.
// 예전엔 project.yml 의 automation 을 sync 마다 덮어써, 사용자가 UI 에서 켠 설정이 git pull·push
// webhook·페이지 방문 stale sync 마다 풀리는 버그가 있었다(사용자 보고 2026-06-01). 운영 토글은
// 머신마다 다를 수 있고 git 에 박제할 정책이 아니므로 project.yml 의 automation 블록은 무시한다.
export function descriptiveMetaFields(meta: ProjectMetaV1): Record<string, unknown> {
  return {
    name: meta.name,
    description: meta.description ?? null,
    kind: meta.kind ?? null,
    domain: meta.domain ?? null,
    homepage: meta.links?.homepage ?? null,
    metaSyncedAt: new Date(),
  };
}

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

  // 메타 upsert — 서술 메타만 git 에서 sync (자동화 토글은 로컬 DB 전용, 아래 함수 참조).
  db.update(projects).set(descriptiveMetaFields(meta)).where(eq(projects.id, projectId)).run();

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
              status: it.status,
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
                status: it.status,
                source: 'git',
                sortOrder: j,
              })
              .run();
            itemsAdded++;
          } else if (exItem.source === 'git' && exItem.sourceOverrideAt === null) {
            // git item 갱신 — 상태는 마크다운 우선(done/in-progress/planned 모두 반영). 단 PR 로
            // done 처리된 기록(doneByPrId)은 마크다운이 체크 해제돼도 보존(자동 done 이 권위). 예전엔
            // done 아니면 무조건 'planned' 로 박아 `[~]` in-progress 가 매 sync 마다 강등됐다(리뷰 발견).
            const nextStatus =
              it.status === 'done'
                ? 'done'
                : exItem.doneByPrId !== null
                  ? exItem.status
                  : it.status;
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

// ============================================================================
// Phase 10.4 — 로드맵 직렬화 (DB → markdown) + cortex sync 마커 (무한 루프 방지)
// ============================================================================

// Cortex 가 생성한 .cortex 변경 commit 에 박는 마커. push webhook sync 가 이 마커를 보면
// 자신이 만든 변경(Cortex→git)을 다시 git→Cortex 로 되돌리는 무한 루프를 막기 위해 skip 한다.
// `Cortex: ready` (자동 머지 신호)와 별개 trailer.
export const CORTEX_SYNC_MARKER = 'Cortex-Sync: roadmap';

export function isCortexSyncCommit(message: string): boolean {
  return /^Cortex-Sync:\s*roadmap\s*$/im.test(message);
}

// DB 로드맵(phase + item)을 parseRoadmapMd 가 다시 읽을 수 있는 markdown 으로 직렬화.
// 형식은 parseRoadmapMd 가 기대하는 것과 정확히 일치 (## Phase <key> — <title> + goal + 체크박스).
//
// round-trip 보존(key/title/goal/item-done)은 **정상적인 로드맵 콘텐츠**에 한해 성립한다. markdown
// 형식의 본질적 제약상 다음 입력은 round-trip 으로 보존되지 않으므로 호출부가 정상 데이터를 보장해야:
//   - 제목에 개행 포함 (헤딩은 한 줄) → 둘째 줄이 goal 로 오해석.
//   - goal 이 체크박스/리스트 마커(`- [x]` 등)로 시작 → item 으로 오해석.
// 빈 title item 은 `- [ ]`(본문 없음)가 parseRoadmapMd item regex 에 안 걸려 유실되므로, 직렬화에서
// 스킵한다(빈 산출물은 의미 없음 — 방어적 제외). 체크박스는 3값(done `[x]`·in-progress `[~]`·
// planned `[ ]`) 모두 직렬화·재파싱 round-trip 보존된다.
export type SerializableRoadmap = ReadonlyArray<{
  key: string;
  title: string;
  goal: string | null;
  items: ReadonlyArray<{ title: string; status: RoadmapItemStatus }>;
}>;

export function serializeRoadmapToMd(phases: SerializableRoadmap): string {
  const blocks: string[] = ['# Roadmap', ''];
  for (const phase of phases) {
    // title 이 key 와 같으면 em-dash 생략 (parseRoadmapMd 가 key 를 title 로 폴백).
    const heading =
      phase.title && phase.title !== phase.key
        ? `## Phase ${phase.key} — ${phase.title}`
        : `## Phase ${phase.key}`;
    blocks.push(heading, '');
    const goal = phase.goal?.trim();
    if (goal) blocks.push(goal, '');
    for (const item of phase.items) {
      // 빈 title 은 `- [ ]` 가 되어 re-parse 시 유실 → 스킵 (round-trip 오염 방지).
      if (item.title.trim().length === 0) continue;
      blocks.push(`- [${statusToCheckbox(item.status)}] ${item.title}`);
    }
    blocks.push('');
  }
  return (
    blocks
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
