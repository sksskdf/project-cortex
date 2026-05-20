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
import { parseUnifiedDiff } from '@/lib/diff-parser';
import { flagsToTags, formatRelativeAge, gaugeTierFromConfidence, reasonTone } from '@/lib/format';
import { getPRDiff } from '@/lib/github';
import { getSettings } from '@/lib/settings';
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
  // 실 데이터 출처:
  // - 'analyzed': preReview 존재 + diff 컬럼 채워짐 (정상 분석)
  // - 'fetched': preReview 없지만 GitHub 에서 diff 직접 fetch (미분석 PR)
  // - 'fixture': fetch 도 불가 (installationId 없음, 시드 PR 등) — 샘플 카드.
  source: 'analyzed' | 'fetched' | 'fixture';
  // PR 상세의 액션 버튼 (머지 / 브랜치 삭제) 노출 조건 결정용.
  isMerged: boolean;
  // head 브랜치가 이미 삭제됐는지 — PR 상세의 '브랜치 삭제' 버튼 비활성화에 사용.
  branchDeleted: boolean;
  // GitHub merge API 호출 가능 여부 — installationId 있고 머지/닫힘 아님.
  // 시드 PR 은 false (installationId null). preReview 유무 무관.
  canMerge: boolean;
  // 사용자가 PR 상세에서 'AI 분석 요청' 버튼을 누를 수 있는지 — preReview 없고
  // installation 있고 AI 토글 ON. AI off 면 false (UI 가 disable 표시).
  canRequestAnalysis: boolean;
  aiEnabled: boolean;
  // GitHub PR description. null 이면 본문 없음 — UI 가 섹션 자체를 숨김.
  body: string | null;
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

  // parsedFiles 에서 파일별 additions/deletions 빠르게 조회.
  const statsByPath = new Map(
    preReview.parsedFiles.map((f) => [f.path, { additions: f.additions, deletions: f.deletions }]),
  );

  function toTreeFile(path: string): TreeFile {
    const s = statsByPath.get(path);
    return { path, status: 'ok', additions: s?.additions ?? 0, deletions: s?.deletions ?? 0 };
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

// preReview.parsedFiles 가 비어있지 않으면 (analyzePR 이 diff 파싱 + 코멘트 부착해서 저장)
// 그대로 사용. 비어있으면 (legacy preReview 또는 diff 파싱 실패) 코멘트만으로 최소 렌더.
function buildFiles(preReview: PreReviewRow): ReadonlyArray<FileBlock> {
  if (preReview.parsedFiles.length > 0) {
    return preReview.parsedFiles;
  }

  // 폴백 — parsedFiles 가 없는 옛날 preReview 행 대응.
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
            text: '(diff 미연동 — parsedFiles 비어있음)',
            kind: 'ctx' as const,
          },
        ],
      })),
    };
  });
}

// 시드 PR 처럼 preReview 행은 있지만 diff 관련 컬럼이 모두 비어있으면
// 트리·diff 영역이 화면에서 텅 비어 보임. analyzed 분기를 건너뛰고 fixture 로 폴백.
function hasUsableDiffData(preReview: PreReviewRow): boolean {
  return (
    preReview.parsedFiles.length > 0 ||
    (preReview.comments?.length ?? 0) > 0 ||
    (preReview.hunkAnnotations?.length ?? 0) > 0 ||
    preReview.changedPaths.length > 0
  );
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
      installationId: projects.installationId,
    })
    .from(prs)
    .innerJoin(projects, eq(prs.repoId, projects.id))
    .leftJoin(preReviews, eq(preReviews.prId, prs.id))
    .leftJoin(triageDecisions, eq(triageDecisions.prId, prs.id))
    .where(eq(prs.id, dbId))
    .get();

  if (!row) return null;

  const settings = getSettings();
  const isMerged = row.pr.status === 'merged';
  const isClosed = row.pr.status === 'closed';
  // 머지 가능 = installation 있음 + 아직 안 닫힘. preReview 유무 무관.
  // 시드 PR (installationId null) 만 차단. AI off 여도 사람 직접 머지는 허용.
  const canMerge = row.installationId !== null && !isMerged && !isClosed;

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

  const common = {
    isMerged,
    branchDeleted: row.pr.branchDeletedAt !== null,
    canMerge,
    canRequestAnalysis: !row.preReview && row.installationId !== null && settings.aiEnabled,
    aiEnabled: settings.aiEnabled,
    body: row.pr.body,
  } as const;

  // preReview 가 있고 diff 컬럼에 실 데이터가 들어 있을 때만 analyzed 빌드.
  if (row.preReview && hasUsableDiffData(row.preReview)) {
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
      ...common,
    };
  }

  // 미분석 PR — installation 있으면 GitHub 에서 diff 직접 fetch 해 트리·diff 렌더.
  // AI 호출 0 (단순 GitHub API). 실패하면 fixture 폴백.
  if (row.installationId !== null) {
    try {
      const [owner, repo] = row.repoSlug.split('/');
      const diffText = await getPRDiff(row.installationId, { owner, repo }, row.pr.number);
      const files = parseUnifiedDiff(diffText);
      const tree = buildTreeFromFiles(files);
      const fetchedFixture: PRDetailFixture = {
        aiSummary: notAnalyzedAiSummary(),
        hunkSummary: { totalHunks: 0, autoApprovableHunks: 0 },
        tree,
        files,
      };
      return {
        pr,
        fixture: fetchedFixture,
        hunkSummary: {
          totalHunks: 0,
          autoApprovableHunks: 0,
          filesChanged: row.pr.filesChanged,
          additions: row.pr.linesAdded,
          deletions: row.pr.linesRemoved,
        },
        source: 'fetched',
        ...common,
      };
    } catch (err) {
      console.error(`getPRDiff failed for PR ${row.pr.id}, falling back to fixture:`, err);
    }
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
    ...common,
  };
}

// 미분석 PR 의 placeholder aiSummary — Anthropic 호출 0.
function notAnalyzedAiSummary(): PRDetailFixture['aiSummary'] {
  return {
    analyzedAgo: '분석 안 됨',
    summarySegments: [{ text: '이 PR 은 아직 분석되지 않았습니다.' }],
    checks: [
      { key: 'tests', value: '미측정', tone: 'warn' },
      { key: 'coverage', value: '미측정', tone: 'warn' },
      { key: 'risk', value: '미측정', tone: 'warn' },
    ],
  };
}

// fetched 분기용 — hunkAnnotations 없이 file path 만으로 트리 구성.
// 모든 파일을 autoApprovable 그룹에 넣음 (분석 안 됐으니 위험도 판정 X).
function buildTreeFromFiles(files: ReadonlyArray<FileBlock>): ReadonlyArray<TreeGroup> {
  if (files.length === 0) return [];
  const treeFiles: TreeFile[] = files.map((f) => ({
    path: f.path,
    status: 'ok',
    additions: f.additions,
    deletions: f.deletions,
  }));
  return [{ groupKey: 'autoApprovable', files: treeFiles }];
}
