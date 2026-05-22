// Phase 11 후속 — /notes 페이지. 자유 마크다운 메모.

import { ko as t } from '@/copy/ko';
import { NotesView } from '@/components/NotesView';
import { listNotes } from '@/lib/notes';
import styles from './page.module.css';

export default function NotesPage() {
  const notes = listNotes();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t.notes.title}</h1>
        <p className={styles.subtitle}>{t.notes.subtitle}</p>
      </header>
      <NotesView initialNotes={notes} />
    </div>
  );
}
