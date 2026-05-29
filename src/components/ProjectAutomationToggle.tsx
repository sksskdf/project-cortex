'use client';

// 균일 패턴 자동화 토글 공용 컴포넌트 — AI 리뷰·충돌 해결·테스트 수정·리뷰 반영·브랜치 삭제.
// (자동 머지는 성공 메시지가 있고, 뮤트는 마스터 스위치라 각자 별도 컴포넌트.)
// 뮤트(disabled) 면 OFF 표시 + 비활성, 설정값은 DB 에 보존.

import { ko as t } from '@/copy/ko';
import { ToggleSwitch } from './ToggleSwitch';
import { useOptimisticToggle, type ToggleActionResult } from './useOptimisticToggle';

export function ProjectAutomationToggle({
  label,
  ariaLabel,
  enabled,
  disabled = false,
  action,
}: {
  label: string;
  ariaLabel: (enabled: boolean) => string;
  enabled: boolean;
  disabled?: boolean;
  action: (next: boolean) => Promise<ToggleActionResult>;
}) {
  const { value, pending, result, toggle } = useOptimisticToggle(enabled, action);
  const shown = disabled ? false : value;
  return (
    <ToggleSwitch
      label={label}
      checked={shown}
      busy={pending}
      disabled={disabled}
      onToggle={() => toggle(!value)}
      ariaLabel={ariaLabel(shown)}
      error={
        result.kind === 'error' ? t.settings.autoMerge.result.error(result.message) : undefined
      }
    />
  );
}
