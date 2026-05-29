// Phase 21 (G1) — 라이브 상태 스트립. "지금 무슨 일이 돌고 있는지" 한 줄 종합. 기존 데이터의
// 재집계일 뿐(추측 0): 진행 중 위임(agent_runs)·자동화 in-flight(automation-state)·검토 대기
// (review-needed, 뮤트 제외)·미확인 머지(prs.readAt). 각 숫자는 해당 목록으로 링크된다.

import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { agentRuns, prs, projects } from '@/db/schema';
import { countAutomationInFlight } from './automation-state';

export type LiveStatus = {
  // 진행 중 위임 — agent_runs.status in (queued, running).
  activeDelegations: number;
  // 백그라운드 자동화(충돌해결·테스트수정·리뷰반영) 진행 중 — 인메모리 레지스트리.
  automationInFlight: number;
  // 검토 대기 PR — review-needed (뮤트 프로젝트 제외, 대시보드 stat 과 동일 규칙).
  reviewPending: number;
  // 미확인 머지 PR — 자동/사람 머지됐지만 readAt 이 null.
  unreadMerges: number;
};

export function getLiveStatus(): LiveStatus {
  const activeDelegations =
    db
      .select({ n: count() })
      .from(agentRuns)
      .where(inArray(agentRuns.status, ['queued', 'running']))
      .get()?.n ?? 0;

  const reviewPending =
    db
      .select({ n: count() })
      .from(prs)
      .innerJoin(projects, eq(prs.repoId, projects.id))
      .where(and(eq(prs.status, 'review-needed'), isNull(prs.clusterId), eq(projects.muted, false)))
      .get()?.n ?? 0;

  const unreadMerges =
    db
      .select({ n: count() })
      .from(prs)
      .where(and(eq(prs.status, 'merged'), isNull(prs.readAt)))
      .get()?.n ?? 0;

  return {
    activeDelegations,
    automationInFlight: countAutomationInFlight(),
    reviewPending,
    unreadMerges,
  };
}
