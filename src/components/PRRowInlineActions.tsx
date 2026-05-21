'use client';

// 인박스 / 대시보드 행 우측에 노출되는 작은 인라인 액션 버튼들.
// PR 상세 페이지로 진입 안 하고 머지 / PR 닫기 / 브랜치 삭제 가능.
//
// 변경 요청은 textarea 입력 필요해 인라인 부적합 — 사용자가 PR 상세로 가야 함.
// 인라인 액션은 모두 1-click — 잘못 누르면 GitHub 에서 reopen 가능.
// (UX 회피 : Link 행 안에서 버튼 클릭 시 e.stopPropagation 으로 navigate 막음.)

import { useOptimistic, useState, useTransition, type MouseEvent } from 'react';
import { ko as t } from '@/copy/ko';
import { closePRAction, deletePRBranchAction, mergePRAction } from '@/actions/pr';
import type { PRRowActionState } from '@/lib/types';
import styles from './PRRowInlineActions.module.css';

type Props = {
  viewId: string;
  actions: PRRowActionState;
};

export function PRRowInlineActions({ viewId, actions }: Props) {
  const [pending, startTransition] = useTransition();
  const [optimisticHidden, setOptimisticHidden] = useOptimistic(
    false,
    (_current, next: boolean) => next,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 액션 실행 즉시 행을 시각적으로 사라지게 (revalidate 가 도착하면 진짜 사라짐).
  function runAction(actionFn: () => Promise<{ kind: string; message?: string }>, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErrorMsg(null);
    startTransition(async () => {
      setOptimisticHidden(true);
      const result = await actionFn();
      if (result.kind !== 'merged' && result.kind !== 'closed' && result.kind !== 'deleted') {
        // 실패면 다시 보이고 에러 노출.
        setErrorMsg(result.message ?? '실패');
      }
    });
  }

  // 액션 하나도 못 쓰면 컴포넌트 자체 안 그림.
  if (!actions.canMerge && !actions.canClose && !actions.canDeleteBranch) return null;

  const hidden = optimisticHidden && errorMsg === null;
  if (hidden) return <span className={styles.placeholder} aria-hidden="true" />;

  return (
    <span className={styles.group} onClick={(e) => e.stopPropagation()}>
      {actions.canMerge && (
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
          aria-label={t.row.actions.mergeAria}
          title={t.row.actions.mergeAria}
          onClick={(e) => runAction(() => mergePRAction(viewId), e)}
        >
          <span className="ds-btn__label">{t.row.actions.merge}</span>
        </button>
      )}
      {actions.canClose && (
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-red"
          disabled={pending}
          aria-label={t.row.actions.closeAria}
          title={t.row.actions.closeAria}
          onClick={(e) => runAction(() => closePRAction(viewId), e)}
        >
          <span className="ds-btn__label">{t.row.actions.close}</span>
        </button>
      )}
      {actions.canDeleteBranch && (
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          disabled={pending}
          aria-label={t.row.actions.deleteBranchAria}
          title={t.row.actions.deleteBranchAria}
          onClick={(e) => runAction(() => deletePRBranchAction(viewId), e)}
        >
          <span className="ds-btn__label">{t.row.actions.deleteBranch}</span>
        </button>
      )}
      {errorMsg && (
        <span className={styles.error} role="alert">
          {errorMsg}
        </span>
      )}
    </span>
  );
}
