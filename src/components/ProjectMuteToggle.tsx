'use client';

// 프로젝트 뮤트 토글. muted=true 면 webhook 무시(인박스/분석/자동머지 차단), /projects 엔 남음.
// 자동 onboard 로 새로 감지된 레포는 기본 muted — 여기서 '관리 시작' 으로 해제.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectMutedAction, type ProjectMuteActionState } from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectMuteToggle({ id, muted }: { id: number; muted: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectMuteActionState>({ kind: 'idle' });
  const [optimisticMuted, setOptimisticMuted] = useOptimistic(
    muted,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticMuted;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticMuted(next);
      setState(await toggleProjectMutedAction(id, next));
    });
  }

  // 마스터 스위치 'Cortex 관리' — 켜짐=관리 중(muted=false), 끄면 뮤트.
  // 이 스위치가 OFF 면 나머지 자동화는 의미 없으므로 그룹 맨 앞에 둔다.
  return (
    <ToggleSwitch
      label={t.projects.action.manageSwitch}
      checked={!optimisticMuted}
      busy={pending}
      onToggle={onToggle}
      ariaLabel={t.projects.muteAria(optimisticMuted)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
