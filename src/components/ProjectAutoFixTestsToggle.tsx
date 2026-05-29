'use client';

// 프로젝트별 CI 테스트 실패 자동 수정 토글 (Phase 13.3). 디폴트 OFF — 켜면 CI 실패 시
// claude CLI 가 워크스페이스에서 테스트를 고쳐 push 한다. 신뢰 선행이라 명시적으로 켤 때만 발화.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  toggleProjectAutoFixTestsAction,
  type ProjectAutoFixTestsActionState,
} from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectAutoFixTestsToggle({
  id,
  enabled,
  disabled = false,
}: {
  id: number;
  enabled: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAutoFixTestsActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAutoFixTestsAction(id, next));
    });
  }

  // 뮤트면 OFF 표시 + 비활성 (설정값은 DB 보존).
  const shownChecked = disabled ? false : optimisticEnabled;
  return (
    <ToggleSwitch
      label={t.projects.action.autoFixTests}
      checked={shownChecked}
      busy={pending}
      disabled={disabled}
      onToggle={onToggle}
      ariaLabel={t.projects.autoFixTestsAria(shownChecked)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
