// Phase 11 후속 — 대시보드 사이드의 핀 고정 메모 위젯.
// 핀 고정한 메모 최대 5개 (빠른 참조 보드). 클릭 시 /notes.

import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import type { NoteView } from '@/lib/notes';
import styles from './DashboardNotesWidget.module.css';

export function DashboardNotesWidget({ notes }: { notes: ReadonlyArray<NoteView> }) {
  if (notes.length === 0) {
    return <div className={styles.empty}>{t.notes.widget.empty}</div>;
  }
  return (
    <ul className={styles.list}>
      {notes.slice(0, 5).map((note) => (
        <li key={note.id} className={styles.item}>
          <span className={styles.pin} aria-hidden>
            ★
          </span>
          <Link href="/notes" className={styles.itemLink}>
            <span className={styles.title}>
              {note.title.trim().length === 0 ? t.notes.untitled : note.title}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
