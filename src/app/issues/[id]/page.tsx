// 이슈 상세 — 제목·스펙·상태 + 위임된 Claude 세션(agent_run) 이력 + 결과 PR.
// 읽기 전용. 편집/삭제 없음 (위임 시점에 에이전트가 이미 실행되므로 사후 편집은 무의미).

import { notFound } from 'next/navigation';
import { IssueDetail } from '@/components/IssueDetail';
import { getIssueDetail } from '@/lib/issues';
import { listRoadmapItemOptions } from '@/lib/roadmap';

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issueId = Number(id);
  if (!Number.isInteger(issueId) || issueId <= 0) notFound();

  const detail = getIssueDetail(issueId);
  if (!detail) notFound();

  // 로드맵 산출물 연결 셀렉터용 — 이슈가 속한 프로젝트의 산출물 목록.
  const roadmapItemOptions = listRoadmapItemOptions(detail.projectId);

  return <IssueDetail detail={detail} roadmapItemOptions={roadmapItemOptions} />;
}
