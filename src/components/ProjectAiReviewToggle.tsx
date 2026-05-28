'use client';

// 프로젝트별 AI 사전 리뷰 토글. 디폴트 ON — 전역 settings.aiEnabled 와 AND 로 적용.
// 회사 레포 등 분석을 끄고 싶은 프로젝트만 개별 OFF.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAiReviewAction, type ProjectAiReviewActionState } from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectAiReviewToggle({
  id,
  enabled,
  disabled = false,
}: {
  id: number;
  enabled: boolean;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectAiReviewActionState>({ kind: 'idle' });
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(
    enabled,
    (_current, next: boolean) => next,
  );

  function onToggle() {
    const next = !optimisticEnabled;
    setState({ kind: 'idle' });
    startTransition(async () => {
      setOptimisticEnabled(next);
      setState(await toggleProjectAiReviewAction(id, next));
    });
  }

  // 뮤트(Cortex 관리 OFF) 면 동작하지 않으므로 OFF 로 표시 + 비활성 (설정값은 DB 에 보존).
  const shownChecked = disabled ? false : optimisticEnabled;
  return (
    <ToggleSwitch
      label={t.projects.action.aiReview}
      checked={shownChecked}
      busy={pending}
      disabled={disabled}
      onToggle={onToggle}
      ariaLabel={t.projects.aiReviewAria(shownChecked)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
