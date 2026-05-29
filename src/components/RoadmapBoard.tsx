'use client';

// Phase 10 — /projects/[id]/roadmap 의 메인 UI. Phase 카드 리스트 + 산출물 체크박스.
// Phase 추가 form / 산출물 추가 inline / 상태 변경 select / 삭제 confirm 패널 모두 내장.

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  createItemAction,
  createPhaseAction,
  deleteItemAction,
  deletePhaseAction,
  toggleItemStatusAction,
  updateItemTitleAction,
  updatePhaseStatusAction,
} from '@/actions/roadmap';
import type {
  ProjectRoadmapView,
  RoadmapPhaseView,
  RoadmapItemView,
  RoadmapStatus,
} from '@/lib/roadmap';
import styles from './RoadmapBoard.module.css';

const STATUS_OPTIONS: RoadmapStatus[] = ['planned', 'in-progress', 'done'];
const statusClass: Record<RoadmapStatus, string> = {
  planned: styles.statusPlanned,
  'in-progress': styles.statusInProgress,
  done: styles.statusDone,
};

export function RoadmapBoard({ view }: { view: ProjectRoadmapView }) {
  const [showAddPhase, setShowAddPhase] = useState(false);

  return (
    <div className={styles.board}>
      <div className={styles.boardHead}>
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--outlined-basic"
          onClick={() => setShowAddPhase((v) => !v)}
        >
          <span className="ds-btn__label">{t.roadmap.section.addPhase}</span>
        </button>
      </div>

      {showAddPhase && (
        <AddPhaseForm projectId={view.projectId} onClose={() => setShowAddPhase(false)} />
      )}

      {view.phases.length === 0 ? (
        <div className={styles.empty}>
          <strong>{t.roadmap.empty.title}</strong>
          <p>{t.roadmap.empty.desc}</p>
        </div>
      ) : (
        <div className={styles.phaseList}>
          {view.phases.map((phase) => (
            <PhaseCard key={phase.id} projectId={view.projectId} phase={phase} />
          ))}
        </div>
      )}
    </div>
  );
}

function AddPhaseForm({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createPhaseAction({ projectId, key, title, goal: goal || null });
      if (r.kind === 'created') {
        setKey('');
        setTitle('');
        setGoal('');
        onClose();
      } else if (r.kind === 'duplicate-key') {
        setError(t.roadmap.result.duplicateKey);
      } else if (r.kind === 'no-project') {
        setError(t.roadmap.result.noProject);
      } else if (r.kind === 'error') {
        setError(t.roadmap.result.error(r.message));
      }
    });
  }

  return (
    <form className={styles.addPhaseForm} onSubmit={onSubmit}>
      <div className={styles.formRow}>
        <label className={styles.formLabel}>
          {t.roadmap.phase.keyLabel}
          <input
            className={styles.formInput}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t.roadmap.phase.keyPlaceholder}
            disabled={pending}
            required
          />
        </label>
        <label className={styles.formLabelGrow}>
          {t.roadmap.phase.titleLabel}
          <input
            className={styles.formInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.roadmap.phase.titlePlaceholder}
            disabled={pending}
            required
          />
        </label>
      </div>
      <label className={styles.formLabel}>
        {t.roadmap.phase.goalLabel}
        <input
          className={styles.formInput}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t.roadmap.phase.goalPlaceholder}
          disabled={pending}
        />
      </label>
      <div className={styles.formHint}>{t.roadmap.phase.keyHint}</div>
      {error && (
        <div className={styles.formError} role="alert">
          {error}
        </div>
      )}
      <div className={styles.formActions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={onClose}
          disabled={pending}
        >
          <span className="ds-btn__label">{t.roadmap.phase.cancel}</span>
        </button>
        <button
          type="submit"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
        >
          <span className="ds-btn__label">{t.roadmap.phase.submit}</span>
        </button>
      </div>
    </form>
  );
}

function PhaseCard({ projectId, phase }: { projectId: number; phase: RoadmapPhaseView }) {
  const [pending, startTransition] = useTransition();
  const [showAddItem, setShowAddItem] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  function onStatusChange(next: RoadmapStatus) {
    startTransition(async () => {
      await updatePhaseStatusAction(projectId, phase.id, next);
    });
  }

  function onDelete() {
    startTransition(async () => {
      await deletePhaseAction(projectId, phase.id);
    });
  }

  return (
    <article className={styles.phaseCard}>
      <header className={styles.phaseHead}>
        <div className={styles.phaseMeta}>
          <div className={styles.phaseKeyRow}>
            <span className={styles.phaseKey}>PHASE-{phase.key}</span>
            <SourceBadge source={phase.source} overridden={phase.overridden} />
          </div>
          <h3 className={styles.phaseTitle}>{phase.title}</h3>
          {phase.goal && <p className={styles.phaseGoal}>{phase.goal}</p>}
        </div>
        <div className={styles.phaseRight}>
          <span className={styles.progress} title={`${phase.progressPct}%`}>
            <span
              className={styles.progressBar}
              style={{ width: `${phase.progressPct}%` }}
              aria-hidden
            />
            <span className={styles.progressLabel}>{phase.progressPct}%</span>
          </span>
          <select
            className={`${styles.statusSelect} ${statusClass[phase.status]}`}
            value={phase.status}
            onChange={(e) => onStatusChange(e.target.value as RoadmapStatus)}
            disabled={pending}
            aria-label={t.roadmap.statusAria}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t.roadmap.statusLabel[s]}
              </option>
            ))}
          </select>
        </div>
      </header>

      {phase.items.length === 0 ? (
        <div className={styles.itemEmpty}>{t.roadmap.phase.noItems}</div>
      ) : (
        <ul className={styles.itemList}>
          {phase.items.map((item) => (
            <ItemRow key={item.id} projectId={projectId} item={item} />
          ))}
        </ul>
      )}

      {showAddItem ? (
        <AddItemForm
          projectId={projectId}
          phaseId={phase.id}
          onClose={() => setShowAddItem(false)}
        />
      ) : (
        <div className={styles.phaseFooter}>
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={() => setShowAddItem(true)}
          >
            <span className="ds-btn__label">+ {t.roadmap.section.addItem}</span>
          </button>
          <button
            type="button"
            className={styles.phaseDeleteBtn}
            onClick={() => setShowDelete(true)}
            disabled={pending}
          >
            {t.roadmap.phase.delete}
          </button>
        </div>
      )}

      {showDelete && (
        <div className={styles.confirmPanel} role="alertdialog" aria-live="polite">
          <p>{t.roadmap.phase.deleteConfirm}</p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={() => setShowDelete(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.roadmap.phase.cancel}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-red"
              onClick={onDelete}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.roadmap.phase.deleteSubmit}</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function AddItemForm({
  projectId,
  phaseId,
  onClose,
}: {
  projectId: number;
  phaseId: number;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createItemAction({ projectId, phaseId, title });
      if (r.kind === 'created') {
        setTitle('');
        onClose();
      } else if (r.kind === 'error') {
        setError(t.roadmap.result.error(r.message));
      }
    });
  }

  return (
    <form className={styles.addItemForm} onSubmit={onSubmit}>
      <input
        className={styles.formInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.roadmap.item.titlePlaceholder}
        disabled={pending}
        required
      />
      <button
        type="button"
        className="ds-btn ds-btn--sm ds-btn--outlined-basic"
        onClick={onClose}
        disabled={pending}
      >
        <span className="ds-btn__label">{t.roadmap.item.cancel}</span>
      </button>
      <button
        type="submit"
        className="ds-btn ds-btn--sm ds-btn--filled-blue"
        disabled={pending}
        aria-busy={pending}
      >
        <span className="ds-btn__label">{t.roadmap.item.submit}</span>
      </button>
      {error && (
        <span className={styles.formError} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

function ItemRow({ projectId, item }: { projectId: number; item: RoadmapItemView }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  function onToggle() {
    const next: RoadmapStatus = item.status === 'done' ? 'planned' : 'done';
    startTransition(async () => {
      await toggleItemStatusAction(projectId, item.id, next);
    });
  }

  function onDelete() {
    startTransition(async () => {
      await deleteItemAction(projectId, item.id);
    });
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim();
    if (next === '' || next === item.title) {
      setEditing(false);
      setDraft(item.title);
      return;
    }
    startTransition(async () => {
      await updateItemTitleAction(projectId, item.id, next);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <li className={styles.item}>
        <form className={styles.itemEditForm} onSubmit={onSaveEdit}>
          <input
            className={styles.formInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            aria-label={t.roadmap.item.editLabel}
          />
          <button
            type="button"
            className="ds-btn ds-btn--sm ds-btn--outlined-basic"
            onClick={() => {
              setEditing(false);
              setDraft(item.title);
            }}
            disabled={pending}
          >
            <span className="ds-btn__label">{t.roadmap.item.cancel}</span>
          </button>
          <button
            type="submit"
            className="ds-btn ds-btn--sm ds-btn--filled-blue"
            disabled={pending}
            aria-busy={pending}
          >
            <span className="ds-btn__label">{t.roadmap.item.save}</span>
          </button>
        </form>
      </li>
    );
  }

  return (
    <li className={`${styles.item} ${item.status === 'done' ? styles.itemDone : ''}`}>
      <label className={styles.itemCheck}>
        <input
          type="checkbox"
          checked={item.status === 'done'}
          onChange={onToggle}
          disabled={pending}
          aria-label={item.title}
        />
        <span className={styles.itemTitle}>{item.title}</span>
      </label>
      <SourceBadge source={item.source} overridden={item.overridden} />
      {item.doneByPrId !== null && (
        <>
          <Link
            href={`/pr/${item.doneByPrId}`}
            className={styles.prLink}
            title={t.roadmap.item.autoDoneTip(item.doneByPrId)}
          >
            #{item.doneByPrNumber ?? item.doneByPrId}
          </Link>
          <span className={styles.itemAutoDone} title={t.roadmap.item.autoDoneTip(item.doneByPrId)}>
            {t.roadmap.item.autoDoneBadge}
          </span>
        </>
      )}
      <button
        type="button"
        className={styles.itemEdit}
        onClick={() => {
          setDraft(item.title);
          setEditing(true);
        }}
        disabled={pending}
        aria-label={t.roadmap.item.editLabel}
        title={t.roadmap.item.editLabel}
      >
        ✎
      </button>
      <button
        type="button"
        className={styles.itemDelete}
        onClick={onDelete}
        disabled={pending}
        aria-label={t.roadmap.item.delete}
        title={t.roadmap.item.delete}
      >
        ×
      </button>
    </li>
  );
}

function SourceBadge({ source, overridden }: { source: 'git' | 'manual'; overridden: boolean }) {
  if (source === 'manual') return null;
  if (overridden) {
    return (
      <span className={styles.sourceOverride} title={t.roadmap.sourceBadge.overrideTip}>
        {t.roadmap.sourceBadge.override}
      </span>
    );
  }
  return (
    <span className={styles.sourceGit} title={t.roadmap.sourceBadge.gitTip}>
      {t.roadmap.sourceBadge.git}
    </span>
  );
}
