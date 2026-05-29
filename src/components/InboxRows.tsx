'use client';

// Phase 20 — 인박스 목록. PR 행을 누르면 페이지 이동 대신 액션 모달(ActionablePeekModal)을 띄워
// 가볍게 확인하고 모달 안에서 머지/변경요청까지. "지금 처리할 것"·최근 머지와 동일 동작(일관).
// "전체 보기" 로 상세 페이지 이동. PRRow 를 onOpen 모드로 재사용(행=모달 트리거, 인라인 액션은 모달).

import { useState } from 'react';
import type { PR } from '@/lib/types';
import { PRRow } from './PRRow';
import { ActionablePeekModal } from './ActionablePeekModal';

export function InboxRows({ rows }: { rows: ReadonlyArray<PR> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const viewIds = rows.map((r) => r.id);

  return (
    <>
      {rows.map((pr, i) => (
        <PRRow key={pr.id} pr={pr} selectable onOpen={() => setOpenIndex(i)} />
      ))}
      {openIndex !== null && (
        <ActionablePeekModal
          viewIds={viewIds}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      )}
    </>
  );
}
