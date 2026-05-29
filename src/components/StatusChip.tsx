// Phase 18 — 이슈·TODO·로드맵의 상태 표시를 통일하는 공용 칩.
// 각 엔티티가 ad-hoc 으로 들고 있던 statusClass Record + 배지 마크업을 대체해 어휘/톤 drift 방지.
// 상태 값은 엔티티별 enum 의 합집합 (open/planned/in-progress/done/closed). kind 로 어떤
// 엔티티의 상태인지 구분 — 라벨/허용 상태는 t.status (공통 어휘) 로 정규화한다.

import { ko as t } from '@/copy/ko';
import type { IssueStatus } from '@/lib/issues';
import type { RoadmapStatus } from '@/lib/roadmap';
import type { TodoStatus } from '@/lib/todos';
import styles from './StatusChip.module.css';

export type StatusChipKind = 'issue' | 'todo' | 'roadmap';

// 엔티티별 상태 값의 합집합. kind 와 함께 쓰면 타입 단에서 잘못된 조합을 막는다.
type StatusByKind = {
  issue: IssueStatus;
  todo: TodoStatus;
  roadmap: RoadmapStatus;
};

// 합집합 — 모든 엔티티가 가질 수 있는 상태 값.
type AnyStatus = IssueStatus | TodoStatus | RoadmapStatus;

// 상태 → 톤 매핑 (시각). 기존 이슈 배지 톤을 그대로 보존:
//   open=info(파랑) · in-progress=warning(노랑) · done=success(초록) · closed=muted(회색).
// 로드맵 planned 는 기존 select 가 text-02(중립 회색) 였으므로 neutral 로.
const toneClass: Record<AnyStatus, string> = {
  open: styles.toneInfo,
  planned: styles.toneNeutral,
  'in-progress': styles.toneWarning,
  done: styles.toneSuccess,
  closed: styles.toneMuted,
};

export function StatusChip<K extends StatusChipKind>({
  kind,
  status,
}: {
  kind: K;
  status: StatusByKind[K];
}) {
  // 라벨은 공통 어휘에서 — 합집합 키로 안전하게 조회.
  const label = t.status[status as AnyStatus];
  return (
    <span className={`${styles.chip} ${toneClass[status as AnyStatus]}`} data-kind={kind}>
      {label}
    </span>
  );
}
