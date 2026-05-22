'use client';

// Phase 8 — /projects 페이지 상단의 수동 레포 등록 마법사.
// 토글 버튼 → inline form. 자동 onboard 와 별개 — App 미설치 상태에서도
// 미리 등록. 등록 시 installationId=null + autoMergeEnabled=false.
// 후속 webhook 도착 시 sync.ts 의 자동 onboard 가 같은 slug 매칭으로
// installationId 갱신 (코드 추가 변경 없음).

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { addProjectAction, type AddProjectActionState } from '@/actions/projects';
import styles from './AddProjectForm.module.css';

export function AddProjectForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState<AddProjectActionState>({ kind: 'idle' });

  function reset() {
    setSlug('');
    setName('');
    setState({ kind: 'idle' });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: 'idle' });
    startTransition(async () => {
      const r = await addProjectAction({ slug, name: name.trim() || undefined });
      setState(r);
      if (r.kind === 'added') {
        reset();
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <div className={styles.collapsed}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => setOpen(true)}
        >
          <span className="ds-btn__label">+ {t.projects.add.button}</span>
        </button>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.formHead}>
        <strong className={styles.formTitle}>{t.projects.add.title}</strong>
        <p className={styles.formDesc}>{t.projects.add.desc}</p>
      </div>
      <label className={styles.label}>
        {t.projects.add.slugLabel}
        <input
          type="text"
          className={styles.input}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t.projects.add.slugPlaceholder}
          autoFocus
          disabled={pending}
          required
        />
      </label>
      <label className={styles.label}>
        {t.projects.add.nameLabel}
        <input
          type="text"
          className={styles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.projects.add.namePlaceholder}
          disabled={pending}
        />
      </label>
      <ResultMessage state={state} />
      <div className={styles.actions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          disabled={pending}
        >
          <span className="ds-btn__label">{t.projects.add.cancel}</span>
        </button>
        <button
          type="submit"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
        >
          <span className="ds-btn__label">{t.projects.add.submit}</span>
        </button>
      </div>
    </form>
  );
}

function ResultMessage({ state }: { state: AddProjectActionState }) {
  if (state.kind === 'idle' || state.kind === 'added') return null;
  if (state.kind === 'invalid-slug') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.projects.add.result.invalidSlug(state.reason)}
      </span>
    );
  }
  if (state.kind === 'duplicate') {
    return (
      <span className={`${styles.result} ${styles.resultError}`}>
        {t.projects.add.result.duplicate}
      </span>
    );
  }
  return (
    <span className={`${styles.result} ${styles.resultError}`}>
      {t.projects.add.result.error(state.message)}
    </span>
  );
}
