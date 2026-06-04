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
import { getBrowserNotifyPref, setBrowserNotifyPref } from '@/lib/notify-pref';
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
  'analysis-failed': styles.dotRed,
  'conflict-resolved': styles.dotGreen,
  'conflict-resolve-failed': styles.dotRed,
  'tests-fixed': styles.dotGreen,
  'test-fix-failed': styles.dotRed,
  'review-addressed': styles.dotGreen,
  'review-fix-failed': styles.dotRed,
  'workspace-pulled': styles.dotGreen,
  'workspace-pull-failed': styles.dotRed,
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

  // 외부 클릭 + Escape 키로 닫힘 (드롭다운 표준 a11y — 모달 트랩은 안 걸지만 키보드 사용자도
  // 외부 클릭과 동등하게 닫을 수 있어야).
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // 새 알림이 도착하면(SSE → WebhookListener → router.refresh → unreadCount prop 갱신) 닫힌
  // 상태의 배지가 이를 반영해야 한다. optimisticUnread 는 useState(unreadCount) 로 1회만
  // 초기화돼 prop 변경 시 갱신되지 않아, 한 번 열었다 닫으면(0 으로 셋) 이후 새 알림이 와도
  // 배지가 0 에 고정됐다(리뷰 발견 — 하드 리로드 전까지 새 알림 누락). 닫힌 동안 prop 이
  // 바뀌면 동기화. (열린 동안은 아래 자동 읽음 effect 가 0 으로 관리.)
  useEffect(() => {
    if (!open) setOptimisticUnread(unreadCount);
  }, [unreadCount, open]);

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

// Phase 10.2 후속 — 브라우저 알림 토글 스위치.
// 브라우저 권한(Notification.permission)은 한 번 granted 되면 JS 로 끌 수 없으므로,
// 토글을 권한에 직접 묶으면 ON 에서 OFF 가 안 된다 (사용자 버그 신고). 그래서 앱 레벨
// 선호 플래그(notify-pref)로 분리 — 권한 granted 상태에서 자유롭게 on/off 토글.
// 효과적 ON = 권한 granted + 플래그 ON. default=권한 요청 / denied=차단(disabled + 빨강 hint).
function BrowserPermissionButton() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (typeof Notification === 'undefined') {
      setPerm('unsupported');
      return;
    }
    setPerm(Notification.permission);
    setEnabled(getBrowserNotifyPref());
  }, []);

  if (perm === 'unsupported') return null;

  const isDenied = perm === 'denied';
  // 효과적 ON = 권한 granted + 앱 플래그 ON.
  const isOn = perm === 'granted' && enabled;
  const title = isDenied
    ? t.notifications.browserPerm.deniedHint
    : t.notifications.browserPerm.tooltip;

  function onClick() {
    if (isDenied) return; // 브라우저가 차단 — JS 로 풀 수 없음.
    if (perm === 'default') {
      // 아직 권한 요청 전 — 권한 요청 후 granted 면 플래그 ON.
      void Notification.requestPermission().then((result) => {
        setPerm(result);
        if (result === 'granted') {
          setBrowserNotifyPref(true);
          setEnabled(true);
        }
      });
      return;
    }
    // 권한 granted — 앱 플래그만 자유롭게 토글 (OFF 가능).
    const next = !enabled;
    setEnabled(next);
    setBrowserNotifyPref(next);
  }

  return (
    <div className={styles.permRow} title={title}>
      <span className={styles.permLabel}>{t.notifications.browserPerm.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={t.notifications.browserPerm.label}
        onClick={onClick}
        disabled={isDenied}
        className={`${styles.switch} ${isOn ? styles.switchOn : ''} ${isDenied ? styles.switchDenied : ''}`}
      >
        <span className={styles.switchKnob} aria-hidden />
      </button>
    </div>
  );
}
