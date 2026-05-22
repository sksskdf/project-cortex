'use client';

// 헤더 알림 버튼 + 드롭다운. 클릭 시 panel 토글, 외부 클릭 시 닫힘.
// 처음 열 때 모든 알림 자동 읽음 처리 — 사용자가 확인했다고 간주.

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import {
  markAllNotificationsReadAction,
  markNotificationsReadAction,
} from '@/actions/notifications';
import type { NotificationKind, NotificationView } from '@/lib/notifications';
import styles from './NotificationDropdown.module.css';

function bellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

const kindDotClass: Record<NotificationKind, string> = {
  'auto-merged': styles.dotGreen,
  'auto-merge-failed': styles.dotRed,
  'ci-failed': styles.dotRed,
  'cluster-created': styles.dotPurple,
  'revert-detected': styles.dotYellow,
};

export function NotificationDropdown({
  notifications,
  unreadCount,
}: {
  notifications: ReadonlyArray<NotificationView>;
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  // optimistic — 드롭다운 열자마자 unread 배지 0 으로 (서버 처리 끝나기 전에).
  const [optimisticUnread, setOptimisticUnread] = useState(unreadCount);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 외부 클릭 시 닫힘.
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  // 드롭다운 열릴 때 unread 자동 읽음 처리.
  useEffect(() => {
    if (!open) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setOptimisticUnread(0);
    startTransition(async () => {
      await markNotificationsReadAction(unreadIds);
    });
  }, [open, notifications]);

  function onMarkAll() {
    setOptimisticUnread(0);
    startTransition(async () => {
      await markAllNotificationsReadAction();
    });
  }

  const displayUnread = open ? 0 : optimisticUnread;

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.iconBtn}
        aria-label={t.notifications.open}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {bellIcon()}
        {displayUnread > 0 && (
          <span className={styles.badge} aria-label={`${displayUnread} unread`}>
            {t.notifications.unreadBadge(displayUnread)}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label={t.notifications.title}>
          <div className={styles.panelHead}>
            <span className={styles.panelTitle}>{t.notifications.title}</span>
            <div className={styles.panelHeadActions}>
              <BrowserPermissionButton />
              {notifications.some((n) => !n.read) && (
                <button
                  type="button"
                  className={styles.markAllBtn}
                  onClick={onMarkAll}
                  aria-label={t.notifications.markAllReadAria}
                >
                  {t.notifications.markAllRead}
                </button>
              )}
            </div>
          </div>

          {notifications.length === 0 ? (
            <div className={styles.empty}>{t.notifications.empty}</div>
          ) : (
            <ul className={styles.list}>
              {notifications.map((n) => (
                <li key={n.id} className={`${styles.item} ${!n.read ? styles.itemUnread : ''}`}>
                  {n.href ? (
                    <Link href={n.href} className={styles.itemLink} onClick={() => setOpen(false)}>
                      <NotificationContent n={n} />
                    </Link>
                  ) : (
                    <div className={styles.itemLink}>
                      <NotificationContent n={n} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationContent({ n }: { n: NotificationView }) {
  return (
    <>
      <span className={`${styles.dot} ${kindDotClass[n.kind]}`} aria-hidden />
      <div className={styles.itemBody}>
        <div className={styles.itemHead}>
          <span className={styles.itemKind}>{t.notifications.kindLabel[n.kind]}</span>
          <span className={styles.itemAge}>{n.ageText}</span>
        </div>
        <div className={styles.itemTitle}>{n.title}</div>
        {n.body && <div className={styles.itemBodyText}>{n.body}</div>}
      </div>
    </>
  );
}

// Phase 10.2 후속 — 브라우저 Notification 권한 토글 chip.
// 사용자 시그널 (2026-05-22): "그냥 ON OFF 토글로 해주면 안되나" — 긴 "켜기" 버튼 대신
// 작은 ON/OFF chip. granted=ON / default=OFF / denied=차단 (회색 비활성).
function BrowserPermissionButton() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPerm('unsupported');
      return;
    }
    setPerm(Notification.permission);
  }, []);

  if (perm === 'unsupported') return null;

  const isOn = perm === 'granted';
  const isDenied = perm === 'denied';
  const title = isDenied
    ? t.notifications.browserPerm.deniedHint
    : t.notifications.browserPerm.tooltip;

  function onClick() {
    if (isDenied || isOn) return; // 브라우저 권한은 한 번 granted/denied 면 JS 로 revoke 불가
    void Notification.requestPermission().then((result) => setPerm(result));
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={t.notifications.browserPerm.label}
      title={title}
      onClick={onClick}
      disabled={isDenied}
      className={`${styles.permToggle} ${isOn ? styles.permToggleOn : ''} ${isDenied ? styles.permToggleDenied : ''}`}
    >
      <span className={styles.permToggleLabel}>{t.notifications.browserPerm.label}</span>
      <span className={styles.permToggleState}>
        {isDenied
          ? t.notifications.browserPerm.deniedShort
          : isOn
            ? t.settings.ai.on
            : t.settings.ai.off}
      </span>
    </button>
  );
}
