'use client';

// 프로젝트별 변경 요청 리뷰 자동 반영 토글 (Phase 13.1). 디폴트 OFF — 켜면 changes_requested
// 리뷰가 오면 claude CLI 가 워크스페이스에서 코드를 고쳐 push 한다. 신뢰 선행이라 명시적으로 켤 때만.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAutoResolveChangesAction,
  type ProjectAutoResolveChangesActionState,
} from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectResolveChangesToggle({
  id,
  enabled,
  disabled = false,
}: {
  id: number;
  enabled: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoResolveChangesActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAutoResolveChangesAction(id, next));
    });
  }

  // 뮤트면 OFF 표시 + 비활성 (설정값은 DB 보존).
  const shownChecked = disabled ? false : optimisticEnabled;
  return (
    <ToggleSwitch
      label={t.projects.action.resolveChanges}
      checked={shownChecked}
      busy={pending}
      disabled={disabled}
      onToggle={onToggle}
      ariaLabel={t.projects.resolveChangesAria(shownChecked)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
