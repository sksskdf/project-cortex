'use client';

// 프로젝트 자동 머지 토글. 균일 토글과 달리 성공 시 재트라이아지 수 메시지를 행 아래 표시.
// 뮤트(disabled) 면 OFF 표시 + 비활성, 설정값은 DB 보존.

import { ko as t } from '@/copy/ko';
import { toggleProjectAutoMergeAction } from '@/actions/settings';
import type { ProjectAutoMergeRow } from '@/lib/projects';
import { ToggleSwitch } from './ToggleSwitch';
import { useOptimisticToggle } from './useOptimisticToggle';
import styles from './ProjectAutoMergeToggle.module.css';

export function ProjectAutoMergeToggle({
  row,
  disabled = false,
}: {
  row: ProjectAutoMergeRow;
  disabled?: boolean;
}) {
  const { value, pending, result, toggle } = useOptimisticToggle(row.autoMergeEnabled, (next) =>
    toggleProjectAutoMergeAction(row.id, next),
  );
  const shown = disabled ? false : value;

  // 에러/미발견은 스위치 인라인 에러로, 성공 메시지(재트라이아지 수)는 행 아래에 표시.
  const error =
    result.kind === 'error'
      ? t.settings.autoMerge.result.error(result.message)
      : result.kind === 'not-found'
        ? t.settings.autoMerge.result.notFound
        : undefined;

  return (
    <div className={styles.wrap}>
      <ToggleSwitch
        label={t.projects.action.autoMerge}
        checked={shown}
        busy={pending}
        disabled={disabled}
        onToggle={() => toggle(!value)}
        ariaLabel={t.projects.autoMergeAria(shown)}
        error={error}
      />
      {result.kind === 'updated' ? (
        <span
          className={`${styles.result} ${styles.resultSuccess}`}
          role="status"
          aria-live="polite"
        >
          {result.enabled
            ? t.settings.autoMerge.result.enabled(row.slug, result.retriagedCount)
            : t.settings.autoMerge.result.disabled(row.slug)}
        </span>
      ) : null}
    </div>
  );
}
