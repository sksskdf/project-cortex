// Phase 18 — 통합 "작업" 뷰. 로드맵 산출물 ▸ 연결된 이슈 ▸ 그 이슈의 TODO/결과 PR 계층을 한
// 화면에. 이슈(roadmapItemId)·TODO(issueId)·결과 PR(agent_run.outputPrId) 링크를 종합한다.
// 활성 작업에 집중: open/in-progress 이슈 + 미완 TODO 만. 읽기 전용.

import { desc, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, issues, prs, projects, roadmapItems, todos } from '@/db/schema';
import type { IssueStatus, SessionStatus } from '@/lib/issues';
import type { TodoStatus } from '@/lib/todos';

export type WorkTodo = { id: number; title: string; status: TodoStatus };

export type WorkIssue = {
  id: number;
  title: string;
  status: IssueStatus;
  sessionStatus: SessionStatus | null;
  resultPrId: number | null;
  resultPrNumber: number | null;
  todos: WorkTodo[];
};

export type WorkGroup = {
  // 연결된 로드맵 산출물. null = 로드맵에 안 묶인 이슈 묶음.
  roadmapItemId: number | null;
  roadmapItemTitle: string | null;
  issues: WorkIssue[];
};

export type WorkProject = {
  projectId: number;
  projectSlug: string;
  groups: WorkGroup[];
};

export function getWorkView(): WorkProject[] {
  // 1) 활성 이슈만 (open/in-progress).
  const issueRows = db
    .select({
      id: issues.id,
      title: issues.title,
      status: issues.status,
      repoId: issues.repoId,
      roadmapItemId: issues.roadmapItemId,
    })
    .from(issues)
    .where(inArray(issues.status, ['open', 'in-progress']))
    .orderBy(desc(issues.createdAt), desc(issues.id))
    .all();
  if (issueRows.length === 0) return [];

  // 2) project slug.
  const projectSlug = new Map<number, string>();
  for (const p of db.select({ id: projects.id, slug: projects.slug }).from(projects).all()) {
    projectSlug.set(p.id, p.slug);
  }

  // 3) roadmap item 제목.
  const itemTitle = new Map<number, string>();
  for (const it of db
    .select({ id: roadmapItems.id, title: roadmapItems.title })
    .from(roadmapItems)
    .all()) {
    itemTitle.set(it.id, it.title);
  }

  // 4) 각 이슈의 최신 agent_run (결과 PR + 세션 상태) — listIssues 와 동일 패턴.
  const latestRun = new Map<number, { status: string; outputPrId: number | null }>();
  for (const run of db
    .select({
      issueId: agentRuns.issueId,
      status: agentRuns.status,
      outputPrId: agentRuns.outputPrId,
      startedAt: agentRuns.startedAt,
      id: agentRuns.id,
    })
    .from(agentRuns)
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .all()) {
    if (!latestRun.has(run.issueId)) {
      latestRun.set(run.issueId, { status: run.status, outputPrId: run.outputPrId });
    }
  }

  // 5) 결과 PR 번호.
  const prNumber = new Map<number, number>();
  for (const p of db.select({ id: prs.id, number: prs.number }).from(prs).all()) {
    prNumber.set(p.id, p.number);
  }

  // 6) 미완 TODO 를 이슈별로.
  const todosByIssue = new Map<number, WorkTodo[]>();
  for (const td of db
    .select({ id: todos.id, title: todos.title, status: todos.status, issueId: todos.issueId })
    .from(todos)
    .all()) {
    if (td.issueId === null || td.status === 'done') continue;
    const list = todosByIssue.get(td.issueId) ?? [];
    list.push({ id: td.id, title: td.title, status: td.status as TodoStatus });
    todosByIssue.set(td.issueId, list);
  }

  // 조립: project → group(roadmapItem|null) → issues.
  const byProject = new Map<number, Map<number | null, WorkIssue[]>>();
  for (const row of issueRows) {
    const run = latestRun.get(row.id) ?? null;
    const resultPrId = run?.outputPrId ?? null;
    const issue: WorkIssue = {
      id: row.id,
      title: row.title,
      status: row.status as IssueStatus,
      sessionStatus: (run?.status as SessionStatus | undefined) ?? null,
      resultPrId,
      resultPrNumber: resultPrId !== null ? (prNumber.get(resultPrId) ?? null) : null,
      todos: todosByIssue.get(row.id) ?? [],
    };
    const groups = byProject.get(row.repoId) ?? new Map<number | null, WorkIssue[]>();
    const key = row.roadmapItemId;
    const arr = groups.get(key) ?? [];
    arr.push(issue);
    groups.set(key, arr);
    byProject.set(row.repoId, groups);
  }

  // 출력 — project slug 순, 그룹은 로드맵 항목 먼저(null=미연결 마지막).
  const result: WorkProject[] = [];
  for (const [projectId, groups] of byProject) {
    const groupList: WorkGroup[] = [];
    for (const [itemId, issueList] of groups) {
      groupList.push({
        roadmapItemId: itemId,
        roadmapItemTitle: itemId !== null ? (itemTitle.get(itemId) ?? null) : null,
        issues: issueList,
      });
    }
    groupList.sort((a, b) => {
      if (a.roadmapItemId === null) return 1; // 미연결 마지막.
      if (b.roadmapItemId === null) return -1;
      return a.roadmapItemId - b.roadmapItemId;
    });
    result.push({
      projectId,
      projectSlug: projectSlug.get(projectId) ?? `#${projectId}`,
      groups: groupList,
    });
  }
  result.sort((a, b) => a.projectSlug.localeCompare(b.projectSlug));
  return result;
}
