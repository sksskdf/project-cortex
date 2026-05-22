'use server';

// Phase 11 후속 — notes Server Actions.

import { revalidatePath } from 'next/cache';
import { createNote, deleteNote, updateNote, type CreateNoteInput } from '@/lib/notes';

export type NoteActionState =
  | { kind: 'idle' }
  | { kind: 'created'; id: number }
  | { kind: 'updated' }
  | { kind: 'deleted' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

function revalidateNotes() {
  revalidatePath('/notes');
  revalidatePath('/');
}

export async function createNoteAction(input: CreateNoteInput): Promise<NoteActionState> {
  try {
    const r = createNote(input);
    if (r.kind === 'created') {
      revalidateNotes();
      return { kind: 'created', id: r.id };
    }
    return { kind: 'error', message: r.message };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateNoteAction(
  noteId: number,
  patch: Partial<{ title: string; body: string; pinned: boolean }>,
): Promise<NoteActionState> {
  try {
    const r = updateNote(noteId, patch);
    if (r.kind === 'updated') revalidateNotes();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteNoteAction(noteId: number): Promise<NoteActionState> {
  try {
    const r = deleteNote(noteId);
    if (r.kind === 'deleted') revalidateNotes();
    return r;
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
