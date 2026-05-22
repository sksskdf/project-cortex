// Phase 11 후속 — 자유 마크다운 메모 CRUD. todos 와 별개.
// todos = 작업 (체크박스), notes = 기록 (마크다운 본문).
// 1차 plain text body — 마크다운 렌더링은 후속 (현재는 줄바꿈만 보존).

import { desc, eq, like, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { notes, projects, prs, type NoteRow } from '@/db/schema';

export type NoteView = {
  id: number;
  title: string;
  body: string;
  pinned: boolean;
  projectId: number | null;
  projectSlug: string | null;
  prId: number | null;
  prNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToView(
  row: NoteRow,
  projectById: Map<number, string>,
  prNumberById: Map<number, number>,
): NoteView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    pinned: row.pinned,
    projectId: row.projectId,
    projectSlug: row.projectId !== null ? (projectById.get(row.projectId) ?? null) : null,
    prId: row.prId,
    prNumber: row.prId !== null ? (prNumberById.get(row.prId) ?? null) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// pinned 먼저, 그 다음 최근 갱신 순. 검색은 단순 LIKE (title + body).
export function listNotes(query?: string): NoteView[] {
  const q = query?.trim();
  const whereClause =
    q && q.length > 0 ? or(like(notes.title, `%${q}%`), like(notes.body, `%${q}%`)) : undefined;
  const rows = (whereClause ? db.select().from(notes).where(whereClause) : db.select().from(notes))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt))
    .all();

  const projectIds = Array.from(
    new Set(rows.map((r) => r.projectId).filter((id): id is number => id !== null)),
  );
  const prIds = Array.from(
    new Set(rows.map((r) => r.prId).filter((id): id is number => id !== null)),
  );
  const projectById = new Map<number, string>();
  const prNumberById = new Map<number, number>();
  if (projectIds.length > 0) {
    const pRows = db.select({ id: projects.id, slug: projects.slug }).from(projects).all();
    for (const r of pRows) projectById.set(r.id, r.slug);
  }
  if (prIds.length > 0) {
    const pRows = db.select({ id: prs.id, number: prs.number }).from(prs).all();
    for (const r of pRows) prNumberById.set(r.id, r.number);
  }

  return rows.map((r) => rowToView(r, projectById, prNumberById));
}

export function getNote(id: number): NoteView | null {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) return null;
  const projectById = new Map<number, string>();
  const prNumberById = new Map<number, number>();
  if (row.projectId !== null) {
    const p = db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .get();
    if (p) projectById.set(row.projectId, p.slug);
  }
  if (row.prId !== null) {
    const p = db.select({ number: prs.number }).from(prs).where(eq(prs.id, row.prId)).get();
    if (p) prNumberById.set(row.prId, p.number);
  }
  return rowToView(row, projectById, prNumberById);
}

export type CreateNoteInput = {
  title: string;
  body?: string;
  projectId?: number | null;
  prId?: number | null;
};

export function createNote(
  input: CreateNoteInput,
): { kind: 'created'; id: number } | { kind: 'error'; message: string } {
  const title = input.title.trim();
  if (title.length === 0) return { kind: 'error', message: '제목은 필수' };
  const row = db
    .insert(notes)
    .values({
      title,
      body: input.body ?? '',
      projectId: input.projectId ?? null,
      prId: input.prId ?? null,
    })
    .returning({ id: notes.id })
    .get();
  return { kind: 'created', id: row.id };
}

export function updateNote(
  noteId: number,
  patch: Partial<{ title: string; body: string; pinned: boolean }>,
): { kind: 'updated' } | { kind: 'not-found' } {
  const existing = db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get();
  if (!existing) return { kind: 'not-found' };
  const cleanPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (t.length === 0) return { kind: 'not-found' }; // 빈 제목 reject (호출자가 막아야 함)
    cleanPatch.title = t;
  }
  if (patch.body !== undefined) cleanPatch.body = patch.body;
  if (patch.pinned !== undefined) cleanPatch.pinned = patch.pinned;
  db.update(notes).set(cleanPatch).where(eq(notes.id, noteId)).run();
  return { kind: 'updated' };
}

export function deleteNote(noteId: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db.select({ id: notes.id }).from(notes).where(eq(notes.id, noteId)).get();
  if (!existing) return { kind: 'not-found' };
  db.delete(notes).where(eq(notes.id, noteId)).run();
  return { kind: 'deleted' };
}

export function countNotes(): number {
  return db.select({ id: notes.id }).from(notes).all().length;
}

// 검색 결과에서 매치 위치 highlight 용. lib/notes-preview.ts 로 분리 (클라이언트 안전).
export { previewWithMatch } from './notes-preview';
