'use client';

// 프로젝트별 머지 충돌 자동 해결 토글 (Phase 13.2). 디폴트 OFF — 켜면 자동 머지 중 dirty
// 충돌이 나도 claude CLI 가 워크스페이스에서 마커를 해소하고 push 한다. 신뢰가 선행돼야 하므로
// 명시적으로 켤 때만 발화.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAutoResolveConflictsAction,
  type ProjectAutoResolveActionState,
} from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectAutoResolveToggle({ id, enabled }: { id: number; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoResolveActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAutoResolveConflictsAction(id, next));
    });
  }

  return (
    <ToggleSwitch
      label={t.projects.action.autoResolve}
      checked={optimisticEnabled}
      busy={pending}
      onToggle={onToggle}
      ariaLabel={t.projects.autoResolveAria(optimisticEnabled)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
