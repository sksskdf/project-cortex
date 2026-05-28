'use client';

// Phase 13.6 — Cortex 워크플로 스킬을 ~/.claude/skills/cortex 에 설치하는 버튼.
// 설치 결과(설치됨/최신/에러)를 인라인으로 노출.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { installCortexSkillAction, type InstallSkillActionState } from '@/actions/settings';
import styles from './InstallCortexSkillButton.module.css';

const c = t.settings.skill;

export function InstallCortexSkillButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<InstallSkillActionState | null>(null);

  function onClick() {
    startTransition(async () => {
      setState(await installCortexSkillAction());
    });
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className="ds-btn ds-btn--sm ds-btn--outlined-basic"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">{pending ? c.pending : c.button}</span>
      </button>
      <Result state={state} />
    </div>
  );
}

function Result({ state }: { state: InstallSkillActionState | null }) {
  if (!state) return null;
  if (state.kind === 'installed') {
    return <span className={styles.ok}>{c.result.installed(state.path)}</span>;
  }
  if (state.kind === 'up-to-date') {
    return <span className={styles.ok}>{c.result.upToDate}</span>;
  }
  return <span className={styles.error}>{c.result.error(state.message)}</span>;
}
