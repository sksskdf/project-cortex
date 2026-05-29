'use client';

// Phase 20 — 액션 가능한 PR 라이트 모달. 목록(지금 처리할 것·인박스)에서 PR 을 누르면 페이지
// 이동 없이 요약·"확인할 부분"을 보고, 모달 안에서 바로 머지/변경요청/닫기까지 한다. 앞뒤로
// 넘기며(prev/next·←/→) 여러 PR 을 가볍게 처리. "전체 보기"로 상세 페이지 이동.
//
// 데이터는 열 때/넘길 때 getPRPeekAction 으로 가져온다(viewId 만 들고 다니고 lazy fetch).
// 액션은 기존 PRActions(머지/변경요청/닫기 — 이미 검증된 서버 액션) 재사용.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ko as t } from '@/copy/ko';
import { getPRPeekAction, type PRPeekData } from '@/actions/pr';
import type { GaugeTier } from '@/lib/types';
import { PRActions } from './PRActions';
import { useFocusTrap } from './useFocusTrap';
import { ChevronLeftIcon } from './icons';
import styles from './PRPeekModal.module.css';

const tierClass: Record<GaugeTier, string> = {
  success: styles.scoreSuccess,
  blue: styles.scoreBlue,
  warning: styles.scoreWarning,
  error: styles.scoreError,
};

type Props = {
  viewIds: ReadonlyArray<string>;
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
};

export function ActionablePeekModal({ viewIds, index, onClose, onNavigate }: Props) {
  const dialogRef = useFocusTrap<HTMLDivElement>({ onClose });
  const [data, setData] = useState<PRPeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const viewId = viewIds[index];
  const hasPrev = index > 0;
  const hasNext = index < viewIds.length - 1;
  const m = t.dashboard.peek;

  // 열 때/넘길 때 현재 PR 데이터를 lazy fetch.
  const refetch = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getPRPeekAction(viewId)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewId]);

  useEffect(() => refetch(), [refetch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onNavigate]);

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
            {data && <span className={styles.repo}>{data.repo}</span>}
            {data && <span className={styles.dot} aria-hidden />}
            {data && <span className={styles.number}>#{data.number}</span>}
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={m.close}>
            <CloseIcon />
          </button>
        </header>

        {loading || !data ? (
          <div className={styles.loading}>{loading ? m.loading : m.notFound}</div>
        ) : (
          <div className={styles.body}>
            <h2 className={styles.title}>{data.title}</h2>
            <div className={styles.sub}>
              <span
                className={data.authorKind === 'agent' ? styles.authorAgent : styles.authorHuman}
              >
                {data.authorName}
              </span>
              <span className={styles.dot} aria-hidden />
              <span>{data.ageText}</span>
              <span className={styles.dot} aria-hidden />
              <span className={`${styles.score} ${tierClass[data.tier]}`}>
                {m.score(data.score)}
              </span>
              <span className={styles.dot} aria-hidden />
              <span className={styles.diff}>
                <span className={styles.diffPlus}>+{data.additions}</span>{' '}
                <span className={styles.diffMinus}>−{data.deletions}</span>{' '}
                <span className={styles.files}>{m.files(data.filesChanged)}</span>
              </span>
            </div>

            {data.summary && <p className={styles.summary}>{data.summary}</p>}

            {data.whatToCheck !== null && (
              <section className={styles.checkSection} aria-label={t.pr.whatToCheck.ariaLabel}>
                <h3 className={styles.checkTitle}>{t.pr.whatToCheck.title}</h3>
                {data.whatToCheck.length > 0 ? (
                  <ul className={styles.checkList}>
                    {data.whatToCheck.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.checkEmpty}>{t.pr.whatToCheck.empty}</p>
                )}
              </section>
            )}

            {/* 모달 안에서 바로 머지/변경요청/닫기 — 기존 PRActions 재사용. */}
            <div className={styles.actions}>
              <PRActions
                viewId={data.viewId}
                canMerge={data.canMerge}
                isMerged={data.isMerged}
                canRequestChanges={data.canRequestChanges}
                mergeableState={data.mergeableState}
                mergeBlockedByCI={data.mergeBlockedByCI}
                testsPassed={data.testsPassed}
                autoMergeEnabled={data.autoMergeEnabled}
              />
            </div>
          </div>
        )}

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
            <span className={styles.counter}>{m.counter(index + 1, viewIds.length)}</span>
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
          <Link href={`/pr/${viewId}`} className="ds-btn ds-btn--sm ds-btn--outlined-basic">
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
