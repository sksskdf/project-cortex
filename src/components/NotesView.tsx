'use client';

// Phase 11 후속 — 메모 뷰. 상단 검색 + 추가 / 본문 list.
// 한 화면에서 추가 · 수정 · 삭제 · 핀 토글 가능 (별도 detail 페이지 X — 단순).
// 본문은 plain text 줄바꿈 보존 (마크다운 렌더 후속).

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ko as t } from '@/copy/ko';
import { createNoteAction, deleteNoteAction, updateNoteAction } from '@/actions/notes';
import { previewWithMatch } from '@/lib/notes-preview';
import { formatRelativeAge } from '@/lib/format';
import type { NoteView } from '@/lib/notes';
import styles from './NotesView.module.css';

export function NotesView({ initialNotes }: { initialNotes: ReadonlyArray<NoteView> }) {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // 클라이언트 필터 (서버에서도 listNotes(query) 가능하지만 인터랙티브 검색 부담 X).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialNotes;
    return initialNotes.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );
  }, [query, initialNotes]);

  return (
    <div className={styles.view}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.notes.searchPlaceholder}
        />
        <button
          type="button"
          className="ds-btn ds-btn--md ds-btn--filled-blue"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          <span className="ds-btn__label">{t.notes.add}</span>
        </button>
      </div>

      {adding && <AddNoteForm onClose={() => setAdding(false)} />}

      {filtered.length === 0 ? (
        <div className={styles.empty}>
          {query.trim() ? t.notes.emptySearch(query.trim()) : t.notes.empty}
        </div>
      ) : (
        <ul className={styles.list}>
          {filtered.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              query={query}
              expanded={expandedId === n.id}
              onToggle={() => setExpandedId((cur) => (cur === n.id ? null : n.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddNoteForm({ onClose }: { onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await createNoteAction({ title, body });
      if (r.kind === 'created') {
        setTitle('');
        setBody('');
        onClose();
      } else if (r.kind === 'error') {
        setError(r.message);
      }
    });
  }

  return (
    <form className={styles.addForm} onSubmit={onSubmit}>
      <input
        type="text"
        className={styles.titleInput}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t.notes.titlePlaceholder}
        autoFocus
        disabled={pending}
        required
      />
      <textarea
        className={styles.bodyInput}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t.notes.bodyPlaceholder}
        disabled={pending}
        rows={5}
      />
      {error && <span className={styles.error}>{t.notes.error.generic(error)}</span>}
      <div className={styles.formActions}>
        <button
          type="button"
          className="ds-btn ds-btn--sm ds-btn--outlined-basic"
          onClick={onClose}
          disabled={pending}
        >
          <span className="ds-btn__label">{t.notes.cancel}</span>
        </button>
        <button
          type="submit"
          className="ds-btn ds-btn--sm ds-btn--filled-blue"
          disabled={pending}
          aria-busy={pending}
        >
          <span className="ds-btn__label">{t.notes.save}</span>
        </button>
      </div>
    </form>
  );
}

function NoteRow({
  note,
  query,
  expanded,
  onToggle,
}: {
  note: NoteView;
  query: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editTitle, setEditTitle] = useState(note.title);
  const [editBody, setEditBody] = useState(note.body);

  function onPin() {
    startTransition(async () => {
      await updateNoteAction(note.id, { pinned: !note.pinned });
    });
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await updateNoteAction(note.id, { title: editTitle, body: editBody });
      if (r.kind === 'updated') setEditing(false);
    });
  }

  function onConfirmDelete() {
    startTransition(async () => {
      await deleteNoteAction(note.id);
    });
  }

  const title = note.title.trim().length === 0 ? t.notes.untitled : note.title;
  const preview = previewWithMatch(note.body, query);

  return (
    <li className={`${styles.item} ${note.pinned ? styles.itemPinned : ''}`}>
      <div className={styles.itemHead}>
        <button
          type="button"
          className={styles.titleBtn}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {note.pinned && (
            <span className={styles.pinMarker} title={t.notes.pinnedLabel} aria-hidden>
              ★
            </span>
          )}
          <span className={styles.itemTitle}>{title}</span>
          {(note.projectSlug || note.prNumber !== null) && (
            <span className={styles.meta}>
              {note.projectSlug}
              {note.prNumber !== null && note.prId !== null && (
                <>
                  {note.projectSlug ? ' · ' : ''}
                  <Link href={`/pr/${note.prId}`} className={styles.metaLink}>
                    #{note.prNumber}
                  </Link>
                </>
              )}
            </span>
          )}
        </button>
        <span className={styles.itemAge}>{formatRelativeAge(note.updatedAt.getTime())}</span>
      </div>

      {!expanded && note.body.trim().length > 0 && <p className={styles.itemPreview}>{preview}</p>}

      {expanded && !editing && !confirmDelete && (
        <>
          <pre className={styles.itemBodyView}>{note.body || ' '}</pre>
          <div className={styles.itemActions}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={onPin}
              disabled={pending}
            >
              <span className="ds-btn__label">{note.pinned ? t.notes.unpin : t.notes.pin}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={() => {
                setEditTitle(note.title);
                setEditBody(note.body);
                setEditing(true);
              }}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.notes.edit}</span>
            </button>
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
            >
              {t.notes.delete}
            </button>
          </div>
        </>
      )}

      {expanded && editing && (
        <form className={styles.editForm} onSubmit={onSaveEdit}>
          <input
            type="text"
            className={styles.titleInput}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            disabled={pending}
            required
          />
          <textarea
            className={styles.bodyInput}
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            disabled={pending}
            rows={Math.max(5, editBody.split('\n').length + 1)}
          />
          <div className={styles.formActions}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.notes.cancel}</span>
            </button>
            <button
              type="submit"
              className="ds-btn ds-btn--sm ds-btn--filled-blue"
              disabled={pending}
              aria-busy={pending}
            >
              <span className="ds-btn__label">{t.notes.save}</span>
            </button>
          </div>
        </form>
      )}

      {expanded && confirmDelete && (
        <div className={styles.confirmPanel} role="alertdialog">
          <span className={styles.confirmText}>{t.notes.deleteConfirm}</span>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--outlined-basic"
              onClick={() => setConfirmDelete(false)}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.notes.deleteConfirmNo}</span>
            </button>
            <button
              type="button"
              className="ds-btn ds-btn--sm ds-btn--filled-red"
              onClick={onConfirmDelete}
              disabled={pending}
            >
              <span className="ds-btn__label">{t.notes.deleteConfirmYes}</span>
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
