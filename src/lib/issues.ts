// Phase 13 — Cortex 내부 이슈 작성 + Claude Code 위임.
// '새 이슈' 토글 ON 이면 assigneeKind='agent' 로 기록하고, 호출측이 등록된
// 워크스페이스에서 claude CLI 세션을 spawn 한다 (PTY 서버). 위임 prompt 는
// buildDelegatePrompt 로 이슈 spec 에서 구성.

import { and, asc, count, desc, eq, inArray, lt, notInArray, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, issues, projects, prs, roadmapItems } from '@/db/schema';

export const CLAUDE_ASSIGNEE_ID = 'claude-code';

export type IssueRepo = { id: number; slug: string; name: string };

// '새 이슈' 폼의 레포 선택지 — 통계 없이 id·slug·name 만 가볍게.
export function listIssueRepos(): IssueRepo[] {
  return db
    .select({ id: projects.id, slug: projects.slug, name: projects.name })
    .from(projects)
    .orderBy(asc(projects.slug))
    .all();
}

export type CreateIssueInput = {
  repoId: number;
  title: string;
  spec: string;
  delegateToClaude: boolean;
  humanAssigneeId: string;
};

export function createIssue(
  input: CreateIssueInput,
): { kind: 'created'; id: number } | { kind: 'error'; message: string } {
  const title = input.title.trim();
  const spec = input.spec.trim();
  if (title.length === 0) return { kind: 'error', message: '제목은 필수' };
  if (spec.length === 0) return { kind: 'error', message: '스펙은 필수' };

  const row = db
    .insert(issues)
    .values({
      repoId: input.repoId,
      title,
      spec,
      assigneeKind: input.delegateToClaude ? 'agent' : 'human',
      assigneeId: input.delegateToClaude ? CLAUDE_ASSIGNEE_ID : input.humanAssigneeId,
      status: input.delegateToClaude ? 'in-progress' : 'open',
    })
    .returning({ id: issues.id })
    .get();
  return { kind: 'created', id: row.id };
}

// 이슈/TODO/로드맵 통합 1단계 — 이슈를 로드맵 산출물에 연결 (null 이면 연결 해제).
// 읽기는 getIssueDetail 의 roadmapItemId/roadmapItemTitle 로.
export function linkIssueToRoadmapItem(issueId: number, roadmapItemId: number | null): void {
  db.update(issues)
    .set({ roadmapItemId, updatedAt: new Date() })
    .where(eq(issues.id, issueId))
    .run();
}

// TODO →이슈 연결 셀렉터용 — 이슈 선택지(id + 제목 + 프로젝트 slug). 최신 순.
export type IssueOption = { id: number; title: string; projectSlug: string | null };

export function listIssueOptions(): IssueOption[] {
  const rows = db
    .select({ id: issues.id, title: issues.title, repoId: issues.repoId })
    .from(issues)
    .orderBy(desc(issues.createdAt), desc(issues.id))
    .all();
  if (rows.length === 0) return [];
  const projectById = new Map<number, string>();
  const pRows = db.select({ id: projects.id, slug: projects.slug }).from(projects).all();
  for (const p of pRows) projectById.set(p.id, p.slug);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    projectSlug: projectById.get(r.repoId) ?? null,
  }));
}

// claude CLI 세션에 처음 보낼 prompt. 이슈 제목 + 수용 기준(spec)을 자연어로 전달.
export function buildDelegatePrompt(title: string, spec: string): string {
  return `이슈: ${title.trim()}\n\n${spec.trim()}`;
}

// 위임 시작 — 이슈에 claude 세션 실행 기록(agent_run)을 running 으로 생성하고 id 반환.
// 이 id 를 spawn 되는 pty 세션에 runId 로 전달해, 세션 종료 시 finishAgentRun 으로 상태를
// 마감한다 (이슈 목록/상세에 실시간 반영).
export function startAgentRun(issueId: number): number {
  const row = db
    .insert(agentRuns)
    .values({ issueId, agent: CLAUDE_ASSIGNEE_ID, status: 'running', startedAt: new Date() })
    .returning({ id: agentRuns.id })
    .get();
  return row.id;
}

// Phase 13.4 — 서버 시작 시 orphan 정리. 라이브 pty 세션은 프로세스와 함께 죽으므로, 재시작
// 직후 'running'/'queued' 인 agent_run 중 복원 가능한 세션(restorableRunIds)에 안 묶인 것은
// 고아다 → failed 로 마감(이슈가 영영 '진행 중' 잔류 방지). pty.ts 모듈 로드 시 1회 호출.
export function reconcileOrphanedRuns(restorableRunIds: ReadonlyArray<number>): { failed: number } {
  const activeCond = inArray(agentRuns.status, ['running', 'queued']);
  const where =
    restorableRunIds.length > 0
      ? and(activeCond, notInArray(agentRuns.id, [...restorableRunIds]))
      : activeCond;
  const result = db
    .update(agentRuns)
    .set({ status: 'failed', completedAt: new Date() })
    .where(where)
    .run();
  return { failed: result.changes };
}

// Phase 13.4 — idle 타임아웃 자동 완료. 서버가 계속 떠 있어도 'running' 으로 maxAgeMs 이상
// 고정된 agent_run 은 (대화형 세션 미종료 등) 사실상 멈춘 것 → failed 로 마감해 이슈 '진행 중'
// 잔류·대시보드 카운트 누적을 막는다. (서버 재시작 시 고아 정리는 reconcileOrphanedRuns 가 담당;
// 이건 서버가 안 죽은 채 오래 방치된 케이스.) 보수적 임계값(기본 24h) — 정상 작업은 그 전에 끝남.
// startedAt 이 null 인 queued 는 제외(아직 시작 안 함 — 재시작 고아 정리 대상).
export function reconcileStaleRuns(maxAgeMs: number): { failed: number } {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = db
    .update(agentRuns)
    .set({ status: 'failed', completedAt: new Date() })
    .where(and(inArray(agentRuns.status, ['running', 'queued']), lt(agentRuns.startedAt, cutoff)))
    .run();
  return { failed: result.changes };
}

// 세션 종료 시 호출 — 정상 종료(exit code 0)면 completed, 아니면 failed 로 마감.
// **status 가드**: 이미 terminal(failed/completed)인 run 은 안 건드린다. 예전엔 무조건 덮어써,
// reconcileStaleRuns 가 24h 후 'failed' 로 마감한 run 이 (실은 아직 살아있던 세션의) 늦은 exit
// 으로 'completed' 로 되돌아가 sweep 감사 신호·completedAt 이 왜곡됐다(리뷰 발견). running/queued
// 일 때만 마감 — 멱등(이미 terminal 이면 no-op).
export function finishAgentRun(runId: number, ok: boolean): void {
  db.update(agentRuns)
    .set({ status: ok ? 'completed' : 'failed', completedAt: new Date() })
    .where(and(eq(agentRuns.id, runId), inArray(agentRuns.status, ['running', 'queued'])))
    .run();
}

// Phase 13.4 — 위임 완료 처리(수동). 대화형 세션은 사용자가 안 닫으면 pty exit 이 안 와서
// agent_run 이 'running' 에 고정 → 이슈가 영영 완료 안 되고 대시보드 '진행 중' 카운트가
// 잔류한다. 이슈 상세의 '완료 처리' 버튼이 이걸 호출해: ① 진행 중(queued/running) run 들을
// completed 로 마감(카운트 해소) ② 이슈를 done 으로 전환. 멱등 — 이미 done 이면 run 만 정리.
export type CompleteDelegationResult =
  | { kind: 'completed'; completedRuns: number }
  | { kind: 'not-found' };

export function completeIssueDelegation(issueId: number): CompleteDelegationResult {
  const issue = db
    .select({ id: issues.id, status: issues.status })
    .from(issues)
    .where(eq(issues.id, issueId))
    .get();
  if (!issue) return { kind: 'not-found' };

  const now = new Date();
  // run 마감 + 이슈 status 전환을 단일 트랜잭션으로 — 중간 크래시로 run 은 completed 인데 이슈는
  // in-progress 로 남는 비일관 상태 방지(roadmap/project-meta sync 와 동일 패턴).
  const completedRuns = db.transaction((tx) => {
    const running = tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.issueId, issueId), inArray(agentRuns.status, ['queued', 'running'])))
      .all();
    for (const r of running) {
      tx.update(agentRuns)
        .set({ status: 'completed', completedAt: now })
        .where(eq(agentRuns.id, r.id))
        .run();
    }
    // 이슈 status 가드 — 이미 'closed'(사용자가 폐기)거나 'done' 이면 안 건드린다(run 만 정리).
    // 예전엔 무조건 'done' 으로 덮어써, 닫은 이슈에 (stale 탭·재전송 POST 로) 이 액션이 다시
    // 닿으면 'closed' → 'done' 으로 회귀했다(리뷰 발견). 진행 중인 것만 done 으로.
    if (issue.status === 'open' || issue.status === 'in-progress') {
      tx.update(issues).set({ status: 'done', updatedAt: now }).where(eq(issues.id, issueId)).run();
    }
    return running.length;
  });
  return { kind: 'completed', completedRuns };
}

export type IssueStatus = 'open' | 'in-progress' | 'done' | 'closed';
// agent_runs.status — 이슈에 위임된 claude 세션의 최신 상태. 위임 안 된 이슈는 null.
export type SessionStatus = 'queued' | 'running' | 'completed' | 'failed';

// 목록 뷰 1행 — 이슈 + 프로젝트 slug + 최신 claude 세션 상태 + 결과 PR.
export type IssueView = {
  id: number;
  title: string;
  status: IssueStatus;
  projectSlug: string | null;
  // 이슈에 연결된 가장 최근 agent_run 의 상태. 위임/실행 이력이 없으면 null.
  sessionStatus: SessionStatus | null;
  // 그 세션이 만들어낸 PR (있을 때만). 클릭 시 /pr/<id> 이동.
  resultPrId: number | null;
  resultPrNumber: number | null;
  createdAt: Date;
};

// 이슈 목록 — 최신 생성 순. 각 이슈마다 프로젝트 slug, 최신 세션 상태, 결과 PR 을 join.
// 읽기 전용 v1 — 편집/삭제 없음.
export function listIssues(): IssueView[] {
  // createdAt 은 초 단위라 같은 초 삽입 시 동률 — id 로 tiebreak (큰 id = 더 최근).
  const rows = db.select().from(issues).orderBy(desc(issues.createdAt), desc(issues.id)).all();
  if (rows.length === 0) return [];

  // project slug 한 번에.
  const projectById = new Map<number, string>();
  const pRows = db.select({ id: projects.id, slug: projects.slug }).from(projects).all();
  for (const p of pRows) projectById.set(p.id, p.slug);

  // 각 이슈의 최신 agent_run (startedAt → id 순). 한 번에 받아 이슈별로 첫 행만 사용.
  const runRows = db
    .select({
      issueId: agentRuns.issueId,
      status: agentRuns.status,
      outputPrId: agentRuns.outputPrId,
      startedAt: agentRuns.startedAt,
      id: agentRuns.id,
    })
    .from(agentRuns)
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .all();
  const latestRunByIssue = new Map<number, (typeof runRows)[number]>();
  for (const run of runRows) {
    if (!latestRunByIssue.has(run.issueId)) latestRunByIssue.set(run.issueId, run);
  }

  // 결과 PR 번호.
  const prNumberById = new Map<number, number>();
  const prRows = db.select({ id: prs.id, number: prs.number }).from(prs).all();
  for (const p of prRows) prNumberById.set(p.id, p.number);

  return rows.map((row) => {
    const run = latestRunByIssue.get(row.id) ?? null;
    const resultPrId = run?.outputPrId ?? null;
    return {
      id: row.id,
      title: row.title,
      status: row.status as IssueStatus,
      projectSlug: projectById.get(row.repoId) ?? null,
      sessionStatus: (run?.status as SessionStatus | undefined) ?? null,
      resultPrId,
      resultPrNumber: resultPrId !== null ? (prNumberById.get(resultPrId) ?? null) : null,
      createdAt: row.createdAt,
    };
  });
}

// 상세 보기 — 이슈 1건의 전체 내용(spec 포함) + 위임된 claude 세션(agent_run) 이력.
export type AgentRunView = {
  id: number;
  agent: string;
  status: SessionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  resultPrId: number | null;
  resultPrNumber: number | null;
};

export type IssueDetail = {
  id: number;
  title: string;
  spec: string;
  status: IssueStatus;
  assigneeKind: 'human' | 'agent';
  assigneeId: string;
  projectId: number;
  projectSlug: string | null;
  projectName: string | null;
  // 이슈/TODO/로드맵 통합 1단계 — 연결된 로드맵 산출물 (옵션). 없으면 둘 다 null.
  roadmapItemId: number | null;
  roadmapItemTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
  // 위임 이력 — 최신 순. 위임 안 된 이슈는 빈 배열.
  runs: AgentRunView[];
};

export function getIssueDetail(id: number): IssueDetail | null {
  const row = db.select().from(issues).where(eq(issues.id, id)).get();
  if (!row) return null;

  const project = db
    .select({ slug: projects.slug, name: projects.name })
    .from(projects)
    .where(eq(projects.id, row.repoId))
    .get();

  // 연결된 로드맵 산출물 (옵션) — title 만 노출.
  const roadmapItem =
    row.roadmapItemId !== null
      ? (db
          .select({ title: roadmapItems.title })
          .from(roadmapItems)
          .where(eq(roadmapItems.id, row.roadmapItemId))
          .get() ?? null)
      : null;

  const prNumberById = new Map<number, number>();
  const prRows = db.select({ id: prs.id, number: prs.number }).from(prs).all();
  for (const p of prRows) prNumberById.set(p.id, p.number);

  const runRows = db
    .select({
      id: agentRuns.id,
      agent: agentRuns.agent,
      status: agentRuns.status,
      startedAt: agentRuns.startedAt,
      completedAt: agentRuns.completedAt,
      outputPrId: agentRuns.outputPrId,
    })
    .from(agentRuns)
    .where(eq(agentRuns.issueId, id))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .all();

  return {
    id: row.id,
    title: row.title,
    spec: row.spec,
    status: row.status as IssueStatus,
    assigneeKind: row.assigneeKind,
    assigneeId: row.assigneeId,
    projectId: row.repoId,
    projectSlug: project?.slug ?? null,
    projectName: project?.name ?? null,
    roadmapItemId: row.roadmapItemId,
    roadmapItemTitle: roadmapItem?.title ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    runs: runRows.map((r) => ({
      id: r.id,
      agent: r.agent,
      status: r.status as SessionStatus,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      resultPrId: r.outputPrId,
      resultPrNumber: r.outputPrId !== null ? (prNumberById.get(r.outputPrId) ?? null) : null,
    })),
  };
}

// 사이드바 chip 용 — open 이슈 카운트.
export function countOpenIssues(): number {
  const result = db
    .select({ n: count() })
    .from(issues)
    .where(or(eq(issues.status, 'open'), eq(issues.status, 'in-progress')))
    .get();
  return result?.n ?? 0;
}

// Phase 4.7 — 사전 리뷰 컨텍스트 보강. 이 PR 이 위임 이슈의 결과물이면(agent_runs.outputPrId
// 매칭), 그 이슈의 title + spec(수용 기준)을 가져온다. 리뷰가 "PR 이 원래 의도한 일을 했는지"
// 판단할 수 있게. 매칭 안 되면 null (사람 PR 등) — 호출부가 그냥 컨텍스트 없이 진행.
export function getIssueContextForPR(prId: number): { title: string; spec: string } | null {
  const row = db
    .select({ title: issues.title, spec: issues.spec })
    .from(agentRuns)
    .innerJoin(issues, eq(issues.id, agentRuns.issueId))
    .where(eq(agentRuns.outputPrId, prId))
    .orderBy(desc(agentRuns.id))
    .get();
  return row ?? null;
}
