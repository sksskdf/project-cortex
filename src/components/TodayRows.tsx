'use client';

// Phase 20 — 대시보드 "지금 처리할 것" 행. 누르면 페이지 이동 대신 액션 모달(ActionablePeekModal)
// 을 띄워 가볍게 확인하고 모달 안에서 머지/변경요청까지. 앞뒤로 넘기며 여러 건 처리.
// 행 인라인 액션은 모달이 대신하므로 행은 모달 트리거 버튼.

import { useState } from 'react';
import type { PR, TagTone } from '@/lib/types';
import { Gauge } from './Gauge';
import { AgentFaceIcon, AlertIcon, InfoIcon } from './icons';
import { ActionablePeekModal } from './ActionablePeekModal';
import feed from '@/app/page.module.css';
import styles from './TodayRows.module.css';

const tagToneClass: Record<TagTone, string> = {
  red: 'ds-tag--red',
  yellow: 'ds-tag--yellow',
  purple: 'ds-tag--purple',
  green: 'ds-tag--green',
  gray: 'ds-tag--gray',
  'sky-blue': 'ds-tag--sky-blue',
  cyan: 'ds-tag--cyan',
};

export function TodayRows({ rows }: { rows: ReadonlyArray<PR> }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const viewIds = rows.map((r) => r.id);

  return (
    <div className={feed.todoList}>
      {rows.map((row, i) => {
        const isAlert = row.reason.tone === 'alert';
        return (
          <button
            key={row.id}
            type="button"
            className={`${feed.todoRow} ${styles.rowBtn}`}
            onClick={() => setOpenIndex(i)}
            aria-haspopup="dialog"
          >
            <Gauge value={row.gauge.value} tier={row.gauge.tier} />
            <div className={feed.todoBody}>
              <div className={feed.todoTitle}>{row.title}</div>
              <div className={feed.todoMeta}>
                <span
                  className={`${feed.author} ${row.author.kind === 'agent' ? feed.authorAgent : feed.authorHuman}`}
                >
                  <AgentFaceIcon />
                  {row.author.name}
                </span>
                {row.tags.map((tag) => (
                  <span key={tag.label} className={`ds-tag ds-tag--md ${tagToneClass[tag.tone]}`}>
                    {tag.label}
                  </span>
                ))}
              </div>
              <div className={`${feed.todoReason} ${isAlert ? '' : feed.todoReasonInfo}`}>
                {isAlert ? <AlertIcon size={12} /> : <InfoIcon size={12} />}
                {row.reason.text}
              </div>
            </div>
            <div className={feed.todoRight}>
              <span className={feed.todoDiff}>
                <span className={feed.todoDiffPlus}>+{row.additions}</span>
                <span className={feed.todoDiffMinus}>−{row.deletions}</span>
              </span>
              <span>{row.ageText}</span>
            </div>
          </button>
        );
      })}
      {openIndex !== null && (
        <ActionablePeekModal
          viewIds={viewIds}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      )}
    </div>
  );
}
