import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { preReviews, prs, projects, triageDecisions } from '@/db/schema';
import type { PreReviewRow, TriageDecisionRow } from '@/db/schema';
import {
  fixturePRDetail,
  type AiCheck,
  type PRDetailFixture,
  type TreeFile,
  type TreeGroup,
} from '@/fixtures/pr-detail';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import type { FileBlock, PR, ReasonTone } from '@/lib/types';

export type PRDetailView = {
  pr: PR;
  fixture: PRDetailFixture;
  hunkSummary: {
    totalHunks: number;
    autoApprovableHunks: number;
    filesChanged: number;
    additions: number;
    deletions: number;
  };
  // 실 데이터 출처 — preReview 있으면 'analyzed', 없으면 'fixture'.
  // UI 가 "샘플 diff" 배너 등으로 활용.
  source: 'analyzed' | 'fixture';
};

function parsePrId(viewId: string): number | null {
  const match = viewId.match(/^pr-(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

// 실 preReview 에서 AI summary card 데이터를 만든다 — fixture 형태로 변환.
function buildAiSummary(
  preReview: PreReviewRow,
  triage: TriageDecisionRow | null,
): PRDetailFixture['aiSummary'] {
  const analyzedAtMs =
    preReview.analyzedAt instanceof Date
      ? preReview.analyzedAt.getTime()
      : Number(preReview.analyzedAt) * 1000;

  const summaryText =
    preReview.summary ?? '요약 없음 — preReview 응답에 summary 필드가 비어있습니다.';

  // 시각적 강조 없이 단일 segment 로 — Anthropic 응답이 plain 문장이라.
  const summarySegments: PRDetailFixture['aiSummary']['summarySegments'] = [{ text: summaryText }];

  // 체크 3종 — 테스트·커버리지·위험.
  const checks: AiCheck[] = [];

  if (preReview.testsPassed === true) {
    checks.push({ key: 'tests', value: '통과', tone: 'ok' });
  } else if (preReview.testsPassed === false) {
    checks.push({ key: 'tests', value: '실패', tone: 'alert' });
  } else {
    checks.push({ key: 'tests', value: '미측정', tone: 'warn' });
  }

  if (preReview.coverage !== null && preReview.coverage !== undefined) {
    const pct = Math.round(preReview.coverage * 100);
    checks.push({
      key: 'coverage',
      value: `${pct}%${pct < 70 ? ' · 기준 미달' : ''}`,
      tone: pct < 70 ? 'warn' : 'ok',
    });
  } else {
    checks.push({ key: 'coverage', value: '미측정', tone: 'warn' });
  }

  // 위험: 차단 플래그(빨강) 우선 → 가벼운 플래그 → triage reason.
  const blockingFlag = preReview.flags.find((f) =>
    ['payment-domain', 'auth-domain', 'migration', 'security-sensitive'].includes(f),
  );
  if (blockingFlag) {
    checks.push({
      key: 'risk',
      value: blockingFlag,
      tone: 'alert',
    });
  } else if (preReview.flags.length > 0) {
    checks.push({
      key: 'risk',
      value: preReview.flags.join(', '),
      tone: 'warn',
    });
  } else {
    checks.push({
      key: 'risk',
      value: triage?.decision === 'auto-merge' ? '낮음' : '검토 필요',
      tone: triage?.decision === 'auto-merge' ? 'ok' : 'warn',
    });
  }

  return {
    analyzedAgo: formatRelativeAge(analyzedAtMs),
    summarySegments,
    checks,
  };
}

// hunkAnnotations 에서 트리 + hunk 통계 구성.
function buildTree(preReview: PreReviewRow): {
  tree: ReadonlyArray<TreeGroup>;
  totalHunks: number;
  autoApprovableHunks: number;
} {
  const annotations = preReview.hunkAnnotations ?? [];
  const totalHunks = annotations.length;
  const autoApprovableHunks = annotations.filter((a) => a.decision === 'auto').length;

  // 파일별로 그룹 — hunkId 형식 "path:line" 에서 path 만 분리.
  const filesNeedingReview = new Set<string>();
  const filesAuto = new Set<string>();
  for (const ann of annotations) {
    const path = ann.hunkId.split(':')[0];
    if (ann.decision === 'review') filesNeedingReview.add(path);
    else filesAuto.add(path);
  }

  // changedPaths 중 어느 그룹에도 안 잡힌 파일은 auto 로 분류 (LLM 이 코멘트 안 단 파일).
  for (const path of preReview.changedPaths) {
    if (!filesNeedingReview.has(path) && !filesAuto.has(path)) {
      filesAuto.add(path);
    }
  }

  function toTreeFile(path: string): TreeFile {
    return { path, status: 'ok', additions: 0, deletions: 0 };
  }

  const groups: TreeGroup[] = [];
  if (filesNeedingReview.size > 0) {
    groups.push({
      groupKey: 'needsReview',
      files: [...filesNeedingReview].map((p) => ({ ...toTreeFile(p), status: 'alert' })),
    });
  }
  if (filesAuto.size > 0) {
    groups.push({
      groupKey: 'autoApprovable',
      files: [...filesAuto].map(toTreeFile),
    });
  }

  return { tree: groups, totalHunks, autoApprovableHunks };
}

// 인라인 코멘트를 파일별 expanded FileBlock 으로 변환.
// 실 diff hunk 가 없으므로 단일 라인 컨텍스트만 표시 — Phase 4.4b 에서 diff 파싱 들어오면 정교화.
function buildFiles(preReview: PreReviewRow): ReadonlyArray<FileBlock> {
  const commentsByPath = new Map<string, typeof preReview.comments>();
  for (const c of preReview.comments ?? []) {
    const list = commentsByPath.get(c.path) ?? [];
    list.push(c);
    commentsByPath.set(c.path, list);
  }

  return preReview.changedPaths.map((path): FileBlock => {
    const comments = commentsByPath.get(path) ?? [];
    if (comments.length === 0) {
      return {
        path,
        status: 'ok',
        additions: 0,
        deletions: 0,
        hunks: [
          {
            kind: 'collapsed',
            id: `${path}:auto`,
            summary: '자동 승인 가능 · {highlight}',
            summaryHighlight: '코멘트 없음',
            lineCount: 0,
          },
        ],
      };
    }
    return {
      path,
      status: 'warn',
      additions: 0,
      deletions: 0,
      hunks: comments.map((c) => ({
        kind: 'expanded' as const,
        id: `${c.path}:${c.line}`,
        reason: { text: c.body, tone: 'info' as const },
        lines: [
          {
            lineNumber: c.line,
            text: '(diff 미연동 — Phase 4.4b 에서 hunk 컨텍스트 추가 예정)',
            kind: 'ctx' as const,
          },
        ],
      })),
    };
  });
}

export async function getPRDetail(viewId: string): Promise<PRDetailView | null> {
  const dbId = parsePrId(viewId);
  if (dbId === null) return null;

  const row = db
    .select({
      pr: prs,
      preReview: preReviews,
      triage: triageDecisions,
      repoSlug: projects.slug,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .leftJoin(preReviews, eq(preReviews.prId, prs.id))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(prs.id, dbId))
    .get();

  if (!row) return null;

  const confidence = row.preReview?.confidence ?? 0;
  const flags = row.preReview?.flags ?? [];
  const tone: ReasonTone = row.triage ? reasonTone(confidence, flags) : 'info';
  const createdAtMs =
    row.pr.createdAt instanceof Date ? row.pr.createdAt.getTime() : Number(row.pr.createdAt) * 1000;

  const pr: PR = {
    id: viewId,
    title: row.pr.title,
    repo: row.repoSlug,
    number: row.pr.number,
    author: { name: row.pr.authorId, kind: row.pr.authorKind },
    tags: flagsToTags(flags),
    reason: { text: row.triage?.reason ?? '', tone },
    additions: row.pr.linesAdded,
    deletions: row.pr.linesRemoved,
    fileCount: row.pr.filesChanged,
    ageText: formatRelativeAge(createdAtMs),
    gauge: { value: confidence, tier: gaugeTierFromConfidence(confidence) },
  };

  // preReview 가 있으면 실 데이터로 fixture 모양을 빌드. 없으면 fixture 원본.
  if (row.preReview) {
    const { tree, totalHunks, autoApprovableHunks } = buildTree(row.preReview);
    const realFixture: PRDetailFixture = {
      aiSummary: buildAiSummary(row.preReview, row.triage),
      hunkSummary: { totalHunks, autoApprovableHunks },
      tree,
      files: buildFiles(row.preReview),
    };
    return {
      pr,
      fixture: realFixture,
      hunkSummary: {
        totalHunks,
        autoApprovableHunks,
        filesChanged: row.pr.filesChanged,
        additions: row.pr.linesAdded,
        deletions: row.pr.linesRemoved,
      },
      source: 'analyzed',
    };
  }

  return {
    pr,
    fixture: fixturePRDetail,
    hunkSummary: {
      totalHunks: fixturePRDetail.hunkSummary.totalHunks,
      autoApprovableHunks: fixturePRDetail.hunkSummary.autoApprovableHunks,
      filesChanged: row.pr.filesChanged,
      additions: row.pr.linesAdded,
      deletions: row.pr.linesRemoved,
    },
    source: 'fixture',
  };
}
