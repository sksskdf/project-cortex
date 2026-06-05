'use client';

// 대시보드 '에이전트 워크로드 ▸ 전체 보기' — 전역 에이전트 드로어를 연다(사이드바 '에이전트'와
// 동일 동작). 에이전트 기능은 라우트가 아닌 전역 드로어로 제공되므로 링크 대신 버튼.
import { useAgentDrawer } from './AgentDrawer';

export function OpenAgentDrawerButton({ className, label }: { className?: string; label: string }) {
  const { openDrawer } = useAgentDrawer();
  return (
    <button type="button" className={className} onClick={() => openDrawer()}>
      {label}
    </button>
  );
}
