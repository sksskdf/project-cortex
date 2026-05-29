'use client';

// Phase 20 — 라이트 PR 미리보기 모달. 목록(대시보드 최근 머지 등)에서 PR 을 누르면 페이지
// 이동 없이 요약을 모달로 띄우고, 앞뒤로 넘기며(prev/next) 훑어볼 수 있다. 본문/전체 diff 가
// 아니라 "확인할 부분 + 요약 + 규모" 만 가볍게. 넘기며 본 PR 은 컨테이너가 READ 처리한다.

import Link from 'next/link';
import { useEffect } from 'react';
import { ko as t } from '@/copy/ko';
import type { GaugeTier } from '@/lib/types';
import { useFocusTrap } from './useFocusTrap';
import { ChevronLeftIcon } from './icons';
import styles from './PRPeekModal.module.css';

export type PeekItem = {
  viewId: string; // "pr-N" — READ 액션 + 상세 링크
  title: string;
  repo: string;
  number: number;
  author: string;
  authorKind: 'agent' | 'human';
  ageText: string;
  score: number;
  tier: GaugeTier;
  summary: string | null;
  whatToCheck: string[];
  additions: number;
  deletions: number;
  filesChanged: number;
  read: boolean;
  // 선택 — 머지 종류(자동/수동/외부) 같은 컨텍스트 배지.
  kindBadge?: string;
};

const tierClass: Record<GaugeTier, string> = {
  success: styles.scoreSuccess,
  blue: styles.scoreBlue,
  warning: styles.scoreWarning,
  error: styles.scoreError,
};

type Props = {
  items: ReadonlyArray<PeekItem>;
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
};

export function PRPeekModal({ items, index, onClose, onNavigate }: Props) {
  const dialogRef = useFocusTrap<HTMLDivElement>({ onClose });
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // 좌우 화살표로 앞뒤 이동 (포커스 트랩의 Escape 와 별개).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onNavigate]);

  if (!item) return null;
  const m = t.dashboard.peek;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={m.ariaLabel}
      >
        <header className={styles.head}>
          <div className={styles.headMeta}>
            <span className={styles.repo}>{item.repo}</span>
            <span className={styles.dot} aria-hidden />
            <span className={styles.number}>#{item.number}</span>
            {item.kindBadge && <span className={styles.kindBadge}>{item.kindBadge}</span>}
            {!item.read && <span className={styles.unreadTag}>{t.dashboard.feed.unread}</span>}
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={m.close}>
            <CloseIcon />
          </button>
        </header>

        <div className={styles.body}>
          <h2 className={styles.title}>{item.title}</h2>
          <div className={styles.sub}>
            <span className={item.authorKind === 'agent' ? styles.authorAgent : styles.authorHuman}>
              {item.author}
            </span>
            <span className={styles.dot} aria-hidden />
            <span>{item.ageText}</span>
            <span className={styles.dot} aria-hidden />
            <span className={`${styles.score} ${tierClass[item.tier]}`}>{m.score(item.score)}</span>
            <span className={styles.dot} aria-hidden />
            <span className={styles.diff}>
              <span className={styles.diffPlus}>+{item.additions}</span>{' '}
              <span className={styles.diffMinus}>−{item.deletions}</span>{' '}
              <span className={styles.files}>{m.files(item.filesChanged)}</span>
            </span>
          </div>

          {item.summary && <p className={styles.summary}>{item.summary}</p>}

          <section className={styles.checkSection} aria-label={t.pr.whatToCheck.ariaLabel}>
            <h3 className={styles.checkTitle}>{t.pr.whatToCheck.title}</h3>
            {item.whatToCheck.length > 0 ? (
              <ul className={styles.checkList}>
                {item.whatToCheck.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.checkEmpty}>{t.pr.whatToCheck.empty}</p>
            )}
          </section>
        </div>

        <footer className={styles.foot}>
          <div className={styles.nav}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--ghost-basic"
              onClick={() => hasPrev && onNavigate(index - 1)}
              disabled={!hasPrev}
              aria-label={m.prev}
            >
              <ChevronLeftIcon />
              <span className="ds-btn__label">{m.prev}</span>
            </button>
            <span className={styles.counter}>{m.counter(index + 1, items.length)}</span>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--ghost-basic"
              onClick={() => hasNext && onNavigate(index + 1)}
              disabled={!hasNext}
              aria-label={m.next}
            >
              <span className="ds-btn__label">{m.next}</span>
              <span className={styles.chevronRight} aria-hidden>
                <ChevronLeftIcon />
              </span>
            </button>
          </div>
          <Link href={`/pr/${item.viewId}`} className="ds-btn ds-btn--sm ds-btn--outlined-basic">
            <span className="ds-btn__label">{m.openFull}</span>
          </Link>
        </footer>
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
