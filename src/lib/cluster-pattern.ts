// Phase 6.3 — 클러스터 상세를 fixture 없이 실 PR 데이터로 derivation.
// tryClusterPR 가 만든 auto-{repoId}-{ts} 패턴은 fixture 가 없으므로
// 이 모듈이 descriptionSegments, patternLines, diffs 등을 PR · preReview 행에서 추출한다.

import { ko as t } from '@/copy/ko';
import type { PreReviewRow, PRRecord } from '@/db/schema';
import type {
  ClusterDescriptionSegment,
  ClusterDiffRowFixture,
  ClusterFixture,
} from '@/fixtures/cluster';
import type { CodeLine, FileBlock, PRTag } from '@/lib/types';

export type ClusterMemberRow = {
  pr: PRRecord;
  preReview: PreReviewRow | null;
};

// 한 클러스터의 PR 행들을 받아 ClusterFixture 모양으로 합성. 입력이 비어 있으면 null.
// fixture 가 있는 패턴(i18n-labels 등)은 derive 를 호출하지 않는다 — cluster.ts 분기.
export function derivePattern(members: ReadonlyArray<ClusterMemberRow>): ClusterFixture | null {
  if (members.length === 0) return null;

  const sortedByNumber = [...members].sort((a, b) => a.pr.number - b.pr.number);
  const totalCount = sortedByNumber.length;

  return {
    descriptionSegments: deriveDescriptionSegments(sortedByNumber),
    patternSourceLabel: derivePatternSourceLabel(sortedByNumber[0]),
    patternLines: derivePatternLines(sortedByNumber),
    diffs: deriveDiffs(sortedByNumber),
    decisionNote: deriveDecisionNote(totalCount, sortedByNumber),
  };
}

// 클러스터 PR 중 fixture 단독 검토 번호를 derive — flags 가 다른 PR 1건이 있으면 그 번호.
// 모두 동일하면 0 (UI 에서 단독 검토 행 숨김).
export function deriveIndividualReviewNumber(members: ReadonlyArray<ClusterMemberRow>): number {
  if (members.length < 2) return 0;
  const flagSets = members.map((m) => flagKey(m.preReview?.flags ?? []));
  const counts = new Map<string, number>();
  for (const k of flagSets) counts.set(k, (counts.get(k) ?? 0) + 1);

  // 1건만 가지는 flag-set 이 있고 그게 다수 그룹과 다르면 그 PR 이 단독 검토 후보.
  const outlier = members.find((_, i) => counts.get(flagSets[i]) === 1);
  // 다른 모두가 동일한 flag-set 일 때만 outlier 채택.
  const uniqueGroups = new Set(flagSets).size;
  if (outlier && uniqueGroups === 2) return outlier.pr.number;
  return 0;
}

function deriveDescriptionSegments(
  members: ReadonlyArray<ClusterMemberRow>,
): ReadonlyArray<ClusterDescriptionSegment> {
  const commonPaths = intersectPaths(members);
  const sample = commonPaths[0];
  const count = members.length;

  if (sample) {
    return [
      { text: t.cluster.description.prefix(count) },
      { text: sample, code: true },
      { text: t.cluster.description.suffix(commonPaths.length) },
    ];
  }
  return [{ text: t.cluster.description.noCommonPath(count) }];
}

function derivePatternSourceLabel(first: ClusterMemberRow): string {
  return `#${first.pr.number} ${first.pr.title}`;
}

// 클러스터 PR 들의 공통 변경 라인 추출 — 모든 PR 에 동일하게 나타나는 변경 (add/del) 라인.
// 이전: 첫 PR 의 첫 hunk 만 발췌 (대표성 약함).
// 개선: 멤버 PR 들의 변경 라인 (text 기준) 교집합. 5개 미만이면 첫 PR fallback.
function derivePatternLines(members: ReadonlyArray<ClusterMemberRow>): ReadonlyArray<CodeLine> {
  if (members.length === 0) return [];

  // 각 PR 의 변경 라인 (add/del) 텍스트 set 추출. ctx/hunk-head 제외 (실 변경 아님).
  const perPRLines: Array<Map<string, CodeLine>> = members.map((m) => {
    const map = new Map<string, CodeLine>();
    const files: ReadonlyArray<FileBlock> = m.preReview?.parsedFiles ?? [];
    for (const f of files) {
      for (const h of f.hunks) {
        if (h.kind !== 'expanded') continue;
        for (const line of h.lines) {
          if (line.kind === 'add' || line.kind === 'del') {
            // 같은 라인 (kind+text) 은 한 번만 — map key 로 중복 제거.
            const key = `${line.kind}:${line.text}`;
            if (!map.has(key)) map.set(key, line);
          }
        }
      }
    }
    return map;
  });

  // 모든 PR 에 공통으로 있는 라인만 — 첫 PR 기준 교집합.
  const first = perPRLines[0];
  const common: CodeLine[] = [];
  for (const [key, line] of first) {
    const inAll = perPRLines.every((m) => m.has(key));
    if (inAll) common.push(line);
  }

  // 공통이 너무 적으면 (< 3) 정보 가치 부족 — 첫 PR 의 첫 hunk 로 폴백.
  if (common.length < 3) {
    for (const m of members) {
      const files: ReadonlyArray<FileBlock> = m.preReview?.parsedFiles ?? [];
      for (const f of files) {
        for (const h of f.hunks) {
          if (h.kind === 'expanded' && h.lines.length > 0) {
            return h.lines;
          }
        }
      }
    }
    return [];
  }

  // 상한 — 너무 많으면 화면이 길어짐. 첫 20 줄만.
  return common.slice(0, 20);
}

// flag-set 별로 그룹핑 → 그룹당 행 1개.
// 같은 flag 를 공유하는 PR 들이 묶이고, 단독 flag-set 은 별도 행.
function deriveDiffs(
  members: ReadonlyArray<ClusterMemberRow>,
): ReadonlyArray<ClusterDiffRowFixture> {
  const groups = new Map<string, ClusterMemberRow[]>();
  for (const m of members) {
    const k = flagKey(m.preReview?.flags ?? []);
    const arr = groups.get(k) ?? [];
    arr.push(m);
    groups.set(k, arr);
  }

  // 큰 그룹부터, 동일 크기는 첫 PR number 순.
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[1][0].pr.number - b[1][0].pr.number;
  });

  return sortedGroups.map(([key, rows], i): ClusterDiffRowFixture => {
    const numbers = rows.map((r) => r.pr.number);
    const flags = rows[0].preReview?.flags ?? [];
    const isMajority = i === 0 && rows.length > 1;
    return {
      id: `derived-${key || 'none'}`,
      prNumbers: numbers,
      title: isMajority
        ? t.cluster.derived.majorityTitle(rows.length)
        : t.cluster.derived.outlierTitle(rows.length),
      detailSegments: [{ text: deriveDiffDetail(rows) }],
      flag: deriveDiffFlag(flags, isMajority),
    };
  });
}

function deriveDiffDetail(rows: ReadonlyArray<ClusterMemberRow>): string {
  const paths = intersectPaths(rows);
  if (paths.length === 0) return t.cluster.derived.detailNoCommonPath(rows.length);
  return t.cluster.derived.detailCommonPath(rows.length, paths[0], paths.length);
}

function deriveDiffFlag(flags: ReadonlyArray<string>, isMajority: boolean): PRTag {
  if (flags.length === 0) {
    return {
      label: isMajority ? t.cluster.derived.flagIdentical : t.cluster.derived.flagOther,
      tone: 'cyan',
    };
  }
  // 위험 플래그 있으면 그대로 표시 (가장 첫 flag 만 라벨링).
  return { label: flags[0], tone: 'yellow' };
}

function deriveDecisionNote(
  total: number,
  members: ReadonlyArray<ClusterMemberRow>,
): { highlight: string; rest: string } {
  const outlierNumber = deriveIndividualReviewNumber(members);
  if (outlierNumber > 0) {
    return {
      highlight: t.cluster.derived.noteOutlierHighlight(outlierNumber),
      rest: t.cluster.derived.noteOutlierRest,
    };
  }
  return {
    highlight: t.cluster.derived.noteUniformHighlight(total),
    rest: t.cluster.derived.noteUniformRest,
  };
}

function intersectPaths(members: ReadonlyArray<ClusterMemberRow>): string[] {
  if (members.length === 0) return [];
  const first = new Set(members[0].preReview?.changedPaths ?? []);
  for (let i = 1; i < members.length; i++) {
    const other = new Set(members[i].preReview?.changedPaths ?? []);
    for (const p of first) if (!other.has(p)) first.delete(p);
  }
  return [...first].sort();
}

function flagKey(flags: ReadonlyArray<string>): string {
  return [...flags].sort().join('|');
}
