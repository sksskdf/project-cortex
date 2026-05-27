'use client';

// Phase 13 — '새 이슈' 작성 + Claude Code 위임. 대시보드 헤더 버튼이 이 모달을 연다.
// 위임 토글 ON 이면 이슈를 assignee=agent 로 기록하고, 생성 후 에이전트 드로어를 열어
// 반환된 위임 프롬프트로 Claude Code 세션을 시작하도록 안내한다 (PTY 세션 spawn 은 드로어).

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { createIssueAction } from '@/actions/issues';
import type { IssueRepo } from '@/lib/issues';
import { useAgentDrawer, type PendingStart } from './AgentDrawer';
import styles from './NewIssueDialog.module.css';

const f = t.dashboard.newIssueForm;

export function NewIssueDialog({ repos }: { repos: ReadonlyArray<IssueRepo> }) {
  const [open, setOpen] = useState(false);
  const { openDrawer } = useAgentDrawer();

  return (
    <>
      <button
        type="button"
        className="ds-btn ds-btn--md ds-btn--filled-blue"
        onClick={() => setOpen(true)}
        aria-label={t.dashboard.header.newIssueHint}
        title={t.dashboard.header.newIssueHint}
      >
        <span className="ds-btn__icon" aria-hidden="true">
          <PlusIcon />
        </span>
        <span className="ds-btn__label">{t.dashboard.newIssue}</span>
      </button>
      {open ? (
        <NewIssueModal repos={repos} onClose={() => setOpen(false)} openDrawer={openDrawer} />
      ) : null}
    </>
  );
}

function NewIssueModal({
  repos,
  onClose,
  openDrawer,
}: {
  repos: ReadonlyArray<IssueRepo>;
  onClose: () => void;
  openDrawer: (pending?: PendingStart) => void;
}) {
  const [repoId, setRepoId] = useState<number | ''>(repos[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [spec, setSpec] = useState('');
  const [delegate, setDelegate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = 폼 입력 중. 문자열 = 위임 생성 완료 — 세션 시작용 프롬프트.
  const [delegatedPrompt, setDelegatedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = repoId !== '' && title.trim().length > 0 && spec.trim().length > 0 && !pending;

  function submit() {
    if (repoId === '') return;
    setError(null);
    startTransition(async () => {
      const res = await createIssueAction({ repoId, title, spec, delegateToClaude: delegate });
      if (res.kind === 'created') {
        if (res.delegate) {
          // 워크스페이스가 있으면 이슈명 세션을 자동 spawn (수동 복사 불필요). 없으면 프롬프트만.
          openDrawer(res.delegate.autoStart ?? undefined);
          if (res.delegate.autoStart) {
            onClose();
          } else {
            setDelegatedPrompt(res.delegate.prompt);
          }
        } else {
          onClose();
        }
        return;
      }
      if (res.kind === 'invalid' || res.kind === 'error') {
        setError(res.message);
      }
    });
  }

  async function copyPrompt() {
    if (delegatedPrompt === null) return;
    try {
      await navigator.clipboard.writeText(delegatedPrompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={f.title}>
        <header className={styles.head}>
          <h2 className={styles.title}>{f.title}</h2>
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

        {delegatedPrompt !== null ? (
          <div className={styles.body}>
            <div className={styles.delegated}>
              <strong className={styles.delegatedTitle}>{f.delegatedTitle}</strong>
              <p className={styles.delegatedDesc}>{f.delegatedDesc}</p>
            </div>
            <pre className={styles.prompt}>{delegatedPrompt}</pre>
            <div className={styles.footer}>
              <button
                type="button"
                className="ds-btn ds-btn--sm ds-btn--outlined-basic"
                onClick={copyPrompt}
              >
                <span className="ds-btn__label">{copied ? f.copied : f.copyPrompt}</span>
              </button>
              <button
                type="button"
                className="ds-btn ds-btn--sm ds-btn--filled-blue"
                onClick={onClose}
              >
                <span className="ds-btn__label">{f.close}</span>
              </button>
            </div>
          </div>
        ) : repos.length === 0 ? (
          <div className={styles.body}>
            <div className={styles.empty}>
              <p>{f.noRepos}</p>
              <Link
                className="ds-btn ds-btn--sm ds-btn--outlined-basic"
                href="/projects"
                onClick={onClose}
              >
                <span className="ds-btn__label">{f.noReposCta}</span>
              </Link>
            </div>
          </div>
        ) : (
          <form
            className={styles.body}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submit();
            }}
          >
            <label className={styles.field}>
              <span className={styles.label}>{f.repo}</span>
              <select
                className={styles.select}
                value={repoId}
                onChange={(e) => setRepoId(Number(e.target.value))}
              >
                {repos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.slug}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>{f.issueTitle}</span>
              <input
                className={styles.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={f.issueTitlePlaceholder}
                maxLength={200}
                autoFocus
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>{f.spec}</span>
              <textarea
                className={styles.textarea}
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder={f.specPlaceholder}
                rows={5}
                maxLength={4000}
              />
            </label>

            <div className={styles.delegateRow}>
              <span className={styles.label}>{f.delegate}</span>
              <button
                type="button"
                role="switch"
                aria-checked={delegate}
                className={`${styles.switch} ${delegate ? styles.switchOn : ''}`}
                onClick={() => setDelegate((v) => !v)}
                aria-label={f.delegate}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>

            {error ? <p className={styles.error}>{error}</p> : null}

            <div className={styles.footer}>
              <button
                type="button"
                className="ds-btn ds-btn--sm ds-btn--outlined-basic"
                onClick={onClose}
              >
                <span className="ds-btn__label">{f.cancel}</span>
              </button>
              <button
                type="submit"
                className="ds-btn ds-btn--sm ds-btn--filled-blue"
                disabled={!canSubmit}
              >
                <span className="ds-btn__label">{pending ? f.submitting : f.submit}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function PlusIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1={12} y1={5} x2={12} y2={19} />
      <line x1={5} y1={12} x2={19} y2={12} />
    </svg>
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
