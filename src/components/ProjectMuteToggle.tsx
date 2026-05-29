'use client';

// 프로젝트 뮤트 토글 (마스터 스위치 'Cortex 관리'). muted=true 면 webhook 무시(인박스/분석/
// 자동머지 차단), /projects 엔 남음. 켜짐=관리 중(muted=false), 끄면 뮤트. 자동 onboard 로 새로
// 감지된 레포는 기본 muted — 여기서 '관리 시작' 으로 해제.

import { ko as t } from '@/copy/ko';
import { toggleProjectMutedAction } from '@/actions/settings';
import { ToggleSwitch } from './ToggleSwitch';
import { useOptimisticToggle } from './useOptimisticToggle';

export function ProjectMuteToggle({ id, muted }: { id: number; muted: boolean }) {
  // value = muted(DB). 스위치 표시는 반전(checked = 관리 중 = !muted).
  const { value, pending, result, toggle } = useOptimisticToggle(muted, (next) =>
    toggleProjectMutedAction(id, next),
  );
  return (
    <ToggleSwitch
      label={t.projects.action.manageSwitch}
      checked={!value}
      busy={pending}
      onToggle={() => toggle(!value)}
      ariaLabel={t.projects.muteAria(value)}
      error={
        result.kind === 'error' ? t.settings.autoMerge.result.error(result.message) : undefined
      }
    />
  );
}
