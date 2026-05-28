'use client';

// Phase 18 — 이슈 상세에서 로드맵 산출물 연결/해제. select 변경 즉시 저장.
// 옵션은 서버 컴포넌트(page)가 이슈 프로젝트의 산출물을 미리 fetch 해 주입.

import { useState, useTransition } from 'react';
import { ko as t } from '@/copy/ko';
import { linkIssueToRoadmapItemAction } from '@/actions/issues';
import type { RoadmapItemOption } from '@/lib/roadmap';
import styles from './IssueRoadmapLink.module.css';

const c = t.issues.detail.roadmapLink;

export function IssueRoadmapLink({
  issueId,
  currentItemId,
  options,
}: {
  issueId: number;
  currentItemId: number | null;
  options: ReadonlyArray<RoadmapItemOption>;
}) {
  const [value, setValue] = useState<number | null>(currentItemId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  function onChange(next: number | null) {
    setValue(next);
    setError(false);
    startTransition(async () => {
      const r = await linkIssueToRoadmapItemAction(issueId, next);
      if (r.kind === 'error') setError(true);
    });
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{c.label}</span>
      {options.length === 0 ? (
        <span className={styles.empty}>{c.noItems}</span>
      ) : (
        <select
          className={styles.select}
          value={value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          disabled={pending}
          aria-label={c.label}
        >
          <option value="">{c.none}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {c.option(opt.phaseKey, opt.title)}
            </option>
          ))}
        </select>
      )}
      {pending ? <span className={styles.hint}>{c.saving}</span> : null}
      {error ? <span className={styles.errorHint}>{c.error}</span> : null}
    </div>
  );
}
