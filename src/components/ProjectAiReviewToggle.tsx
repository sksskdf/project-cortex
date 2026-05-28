'use client';

// 프로젝트별 AI 사전 리뷰 토글. 디폴트 ON — 전역 settings.aiEnabled 와 AND 로 적용.
// 회사 레포 등 분석을 끄고 싶은 프로젝트만 개별 OFF.

import { useOptimistic, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { toggleProjectAiReviewAction, type ProjectAiReviewActionState } from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectAiReviewToggle({ id, enabled }: { id: number; enabled: boolean }) {
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

  return (
    <ToggleSwitch
      label={t.projects.action.aiReview}
      checked={optimisticEnabled}
      busy={pending}
      onToggle={onToggle}
      ariaLabel={t.projects.aiReviewAria(optimisticEnabled)}
      error={state.kind === 'error' ? t.settings.autoMerge.result.error(state.message) : undefined}
    />
  );
}
