// 브라우저 알림 on/off — 앱 레벨 사용자 선호 (localStorage, 클라이언트 전용).
// 브라우저 권한(Notification.permission)은 한 번 granted 되면 JS 로 끌 수 없으므로,
// 실제 알림 표시 여부는 이 플래그로 제어한다. 효과적 ON = 권한 granted + 이 플래그 true.

const KEY = 'cortex:browserNotifications';

// 토글 변경을 같은 탭의 다른 컴포넌트(WebhookListener)가 즉시 반영하도록 알리는 이벤트.
export const BROWSER_NOTIFY_PREF_EVENT = 'cortex:browser-notify-pref';

export function getBrowserNotifyPref(): boolean {
  if (typeof window === 'undefined') return false;
  // 디폴트 ON — 명시적으로 '0' 일 때만 OFF (기존 granted 사용자 동작 보존).
  return window.localStorage.getItem(KEY) !== '0';
}

export function setBrowserNotifyPref(on: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, on ? '1' : '0');
  window.dispatchEvent(new Event(BROWSER_NOTIFY_PREF_EVENT));
}
