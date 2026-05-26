// Phase 13 — '에이전트'는 전역 드로어로 이동 (AppShell 마운트, 화면 이동에도 세션 유지).
// 라우트는 은퇴 — 사이드바 '에이전트'가 드로어를 연다. 북마크/직접 진입은 홈으로 보냄.

import { redirect } from 'next/navigation';

export default function AgentsPage() {
  redirect('/');
}
