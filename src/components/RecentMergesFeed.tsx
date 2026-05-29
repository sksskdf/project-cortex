'use client';

// Phase 20 — 대시보드 "최근 머지" 피드. 행을 누르면 페이지 이동 대신 라이트 모달(PRPeekModal)을
// 띄우고 앞뒤로 넘기며 훑어본다. 모달에서 본 PR 은 즉시 미확인 점을 지우고(낙관적), 모달을 닫을
// 때 본 것들을 일괄 READ 처리한다(markPRsReadAction — 한 번의 서버 왕복).

import { useCallback, useMemo, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { markPRsReadAction } from '@/actions/pr';
import type { ActivityFeedItem } from '@/lib/dashboard';
import { PRPeekModal, type PeekItem } from './PRPeekModal';
import feed from '@/app/page.module.css';
import styles from './RecentMergesFeed.module.css';

export function RecentMergesFeed({ items }: { items: ReadonlyArray<ActivityFeedItem> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // 이번 세션에 모달에서 본 미확인 PR 의 viewId — 닫을 때 일괄 READ 처리 + 낙관적 점 제거.
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const markViewed = useCallback((item: ActivityFeedItem) => {
    if (item.read) return; // 이미 확인됨.
    setViewed((prev) => {
      if (prev.has(item.href)) return prev;
      const next = new Set(prev);
      next.add(item.href);
      return next;
    });
  }, []);

  const open = useCallback(
    (i: number) => {
      setOpenIndex(i);
      markViewed(items[i]);
    },
    [items, markViewed],
  );

  const navigate = useCallback(
    (i: number) => {
      setOpenIndex(i);
      markViewed(items[i]);
    },
    [items, markViewed],
  );

  const close = useCallback(() => {
    setOpenIndex(null);
    const ids = [...viewed];
    if (ids.length > 0) {
      startTransition(async () => {
        await markPRsReadAction(ids);
      });
    }
  }, [viewed]);

  // 낙관적 read — 서버 revalidate 전이라도 본 항목은 점을 지운다.
  const peekItems: PeekItem[] = useMemo(
    () =>
      items.map((item) => ({
        viewId: item.href,
        title: item.title,
        repo: item.repo,
        number: item.number,
        author: item.agent,
        authorKind: item.authorKind,
        ageText: item.ageText,
        score: item.score,
        tier: item.tier,
        summary: item.summary,
        whatToCheck: item.whatToCheck,
        additions: item.additions,
        deletions: item.deletions,
        filesChanged: item.filesChanged,
        read: item.read || viewed.has(item.href),
        kindBadge: t.dashboard.feed.mergeKindBadge[item.kind],
      })),
    [items, viewed],
  );

  return (
    <div className={feed.feedCard}>
      <div className={feed.feed}>
        {items.map((item, i) => {
          const isRead = item.read || viewed.has(item.href);
          return (
            <button
              key={item.id}
              type="button"
              className={`${feed.feedItem} ${feed.clusterLink} ${styles.rowBtn}`}
              onClick={() => open(i)}
              aria-haspopup="dialog"
            >
              <span
                className={`${feed.feedKind} ${feed[`feedKind_${item.kind}`]}`}
                aria-hidden="true"
              >
                {t.dashboard.feed.mergeKindBadge[item.kind]}
              </span>
              <div className={feed.feedBody}>
                <div className={feed.feedText}>
                  {!isRead && (
                    <span
                      className={feed.unreadDot}
                      aria-label={t.dashboard.feed.unread}
                      title={t.dashboard.feed.unread}
                    />
                  )}
                  {t.dashboard.feed.merged(item.kind, item.agent, item.title, item.score)}
                </div>
                <span className={feed.feedTime}>
                  {item.repo} · #{item.number} · {item.ageText}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {openIndex !== null && (
        <PRPeekModal items={peekItems} index={openIndex} onClose={close} onNavigate={navigate} />
      )}
    </div>
  );
}
