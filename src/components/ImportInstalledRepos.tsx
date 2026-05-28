'use client';

// Phase 8 — GitHub App 설치 리포 import 모달.
// 버튼 클릭 → 모달 오픈 시점에 listInstalledReposAction 호출 (app-level JWT 로 모든
// installation + 접근 가능 리포 나열). 사용자가 체크박스로 골라 등록하면 각 항목마다
// addInstalledRepoAction 호출. 이미 등록된 slug 는 비활성 + '등록됨' 배지.
// 자동 onboard 와 별개로 webhook 도착 전이라도 미리 등록 가능.

import { useEffect, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  addInstalledRepoAction,
  listInstalledReposAction,
  type AddInstalledRepoActionState,
  type ListInstalledReposActionState,
} from '@/actions/projects';
import type { InstallationWithRepos } from '@/lib/github';
import styles from './ImportInstalledRepos.module.css';

const f = t.projects.import;

type Selection = { installationId: number; slug: string; name: string };

export function ImportInstalledRepos({ existingSlugs }: { existingSlugs: ReadonlyArray<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--sm ds-btn--outlined-basic"
        onClick={() => setOpen(true)}
      >
        <span className="ds-btn__label">{f.button}</span>
      </button>
      {open ? <ImportModal existingSlugs={existingSlugs} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ImportModal({
  existingSlugs,
  onClose,
}: {
  existingSlugs: ReadonlyArray<string>;
  onClose: () => void;
}) {
  const [list, setList] = useState<ListInstalledReposActionState | { kind: 'loading' }>({
    kind: 'loading',
  });
  const [selected, setSelected] = useState<Map<string, Selection>>(new Map());
  const [submitState, setSubmitState] = useState<
    | { kind: 'idle' }
    | { kind: 'submitting'; done: number; total: number }
    | {
        kind: 'done';
        added: number;
        linked: number;
        alreadyLinked: number;
        failed: { slug: string; message: string }[];
      }
  >({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  const existing = new Set(existingSlugs);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const r = await listInstalledReposAction();
      if (!cancelled) setList(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(item: Selection) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.slug)) next.delete(item.slug);
      else next.set(item.slug, item);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0) return;
    const items = Array.from(selected.values());
    setSubmitState({ kind: 'submitting', done: 0, total: items.length });
    startTransition(async () => {
      let added = 0;
      let linked = 0;
      let alreadyLinked = 0;
      const failed: { slug: string; message: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        const r: AddInstalledRepoActionState = await addInstalledRepoAction({
          slug: it.slug,
          name: it.name,
          installationId: it.installationId,
        });
        if (r.kind === 'added') added++;
        else if (r.kind === 'linked') linked++;
        else if (r.kind === 'already-linked') alreadyLinked++;
        else if (r.kind === 'invalid-slug') failed.push({ slug: it.slug, message: r.reason });
        else if (r.kind === 'error') failed.push({ slug: it.slug, message: r.message });
        setSubmitState({ kind: 'submitting', done: i + 1, total: items.length });
      }
      setSubmitState({ kind: 'done', added, linked, alreadyLinked, failed });
    });
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={f.title}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{f.title}</h2>
            <p className={styles.subtitle}>{f.subtitle}</p>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label={f.close}
            title={f.close}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          {submitState.kind === 'done' ? (
            <ResultView state={submitState} onClose={onClose} />
          ) : list.kind === 'loading' || (list.kind === 'ok' && pending && selected.size === 0) ? (
            <div className={styles.status}>{f.loading}</div>
          ) : list.kind === 'error' ? (
            <div className={styles.error}>{f.error(list.message)}</div>
          ) : list.kind === 'ok' ? (
            <InstallationsView
              installations={list.installations}
              existing={existing}
              selected={selected}
              onToggle={toggle}
            />
          ) : null}
        </div>

        {submitState.kind !== 'done' && list.kind === 'ok' ? (
          <footer className={styles.footer}>
            <span className={styles.footerCount}>
              {submitState.kind === 'submitting'
                ? f.submitting(submitState.done, submitState.total)
                : f.selectedCount(selected.size)}
            </span>
            <div className={styles.footerActions}>
              <button
                type="button"
                className="ds-btn ds-btn--sm ds-btn--outlined-basic"
                onClick={onClose}
                disabled={submitState.kind === 'submitting'}
              >
                <span className="ds-btn__label">{f.cancel}</span>
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--sm ds-btn--filled-blue"
                onClick={submit}
                disabled={selected.size === 0 || submitState.kind === 'submitting'}
                aria-busy={submitState.kind === 'submitting'}
              >
                <span className="ds-btn__label">{f.submit}</span>
              </button>
            </div>
          </footer>
        ) : null}
      </div>
    </>
  );
}

function InstallationsView({
  installations,
  existing,
  selected,
  onToggle,
}: {
  installations: ReadonlyArray<InstallationWithRepos>;
  existing: Set<string>;
  selected: Map<string, Selection>;
  onToggle: (item: Selection) => void;
}) {
  if (installations.length === 0) {
    return <div className={styles.status}>{f.empty}</div>;
  }
  return (
    <div className={styles.installations}>
      {installations.map((inst) => (
        <section key={inst.installationId} className={styles.installation}>
          <header className={styles.instHead}>
            <span className={styles.instAccount}>{inst.account}</span>
            <span className={styles.instType}>
              {inst.accountType === 'Organization' ? f.org : f.user}
            </span>
            <span className={styles.instCount}>{f.repoCount(inst.repos.length)}</span>
          </header>
          {inst.repos.length === 0 ? (
            <p className={styles.instEmpty}>{f.installationEmpty}</p>
          ) : (
            <ul className={styles.repoList}>
              {inst.repos.map((repo) => {
                const isExisting = existing.has(repo.slug);
                const isSelected = selected.has(repo.slug);
                return (
                  <li key={repo.slug} className={styles.repoItem}>
                    <label
                      className={`${styles.repoLabel} ${isExisting ? styles.repoExisting : ''}`}
                    >
                      <input
                        type="checkbox"
                        className={styles.repoCheckbox}
                        checked={isSelected}
                        disabled={isExisting}
                        onChange={() =>
                          onToggle({
                            installationId: inst.installationId,
                            slug: repo.slug,
                            name: repo.name,
                          })
                        }
                      />
                      <div className={styles.repoMain}>
                        <div className={styles.repoTop}>
                          <span className={styles.repoSlug}>{repo.slug}</span>
                          {repo.private ? <span className={styles.badge}>{f.private}</span> : null}
                          {isExisting ? (
                            <span className={`${styles.badge} ${styles.badgeMuted}`}>
                              {f.registered}
                            </span>
                          ) : null}
                        </div>
                        {repo.description ? (
                          <span className={styles.repoDesc}>{repo.description}</span>
                        ) : null}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ResultView({
  state,
  onClose,
}: {
  state: {
    kind: 'done';
    added: number;
    linked: number;
    alreadyLinked: number;
    failed: { slug: string; message: string }[];
  };
  onClose: () => void;
}) {
  return (
    <div className={styles.resultWrap}>
      <div className={styles.resultSummary}>
        <strong className={styles.resultTitle}>{f.result.title}</strong>
        <ul className={styles.resultList}>
          <li>{f.result.added(state.added)}</li>
          <li>{f.result.linked(state.linked)}</li>
          <li>{f.result.alreadyLinked(state.alreadyLinked)}</li>
          {state.failed.length > 0 ? <li>{f.result.failed(state.failed.length)}</li> : null}
        </ul>
      </div>
      {state.failed.length > 0 ? (
        <ul className={styles.failedList}>
          {state.failed.map((x) => (
            <li key={x.slug} className={styles.failedItem}>
              <span className={styles.repoSlug}>{x.slug}</span>
              <span className={styles.failedMsg}>{x.message}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.resultActions}>
        <button type="button" className="ds-btn ds-btn--sm ds-btn--filled-blue" onClick={onClose}>
          <span className="ds-btn__label">{f.result.close}</span>
        </button>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1={18} y1={6} x2={6} y2={18} />
      <line x1={6} y1={6} x2={18} y2={18} />
    </svg>
  );
}
