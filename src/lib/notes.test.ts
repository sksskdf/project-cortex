import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { notes } from '@/db/schema';
import {
  countNotes,
  createNote,
  deleteNote,
  listNotes,
  listPinnedNotes,
  previewWithMatch,
  updateNote,
} from './notes';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(notes).run();
});

describe('createNote', () => {
  it('creates with defaults', () => {
    const r = createNote({ title: 'first' });
    expect(r.kind).toBe('created');
    if (r.kind === 'created') expect(r.id).toBeGreaterThan(0);
    expect(countNotes()).toBe(1);
  });

  it('rejects empty title', () => {
    expect(createNote({ title: '   ' }).kind).toBe('error');
  });

  it('stores body', () => {
    createNote({ title: 't', body: '본문 내용' });
    expect(listNotes()[0].body).toBe('본문 내용');
  });
});

describe('updateNote', () => {
  it('updates title + body', () => {
    const r = createNote({ title: 'old' });
    if (r.kind !== 'created') throw new Error('setup');
    updateNote(r.id, { title: 'new', body: 'new body' });
    const n = listNotes()[0];
    expect(n.title).toBe('new');
    expect(n.body).toBe('new body');
  });

  it('toggles pinned + pinned 가 목록 상단', () => {
    const a = createNote({ title: 'a' });
    const b = createNote({ title: 'b' });
    if (a.kind !== 'created' || b.kind !== 'created') throw new Error('setup');
    updateNote(b.id, { pinned: true });
    const list = listNotes();
    expect(list[0].title).toBe('b'); // pinned 가 상단
    expect(list[0].pinned).toBe(true);
  });
});

describe('listNotes search', () => {
  it('title + body LIKE 매칭', () => {
    createNote({ title: 'first', body: 'apple banana' });
    createNote({ title: 'second', body: 'cherry' });
    expect(listNotes('apple').length).toBe(1);
    expect(listNotes('second').length).toBe(1);
    expect(listNotes('nomatch').length).toBe(0);
  });
});

describe('deleteNote', () => {
  it('removes', () => {
    const r = createNote({ title: 'x' });
    if (r.kind !== 'created') throw new Error('setup');
    deleteNote(r.id);
    expect(countNotes()).toBe(0);
  });
});

describe('listPinnedNotes', () => {
  it('핀 고정만 반환', () => {
    const a = createNote({ title: 'pinned' });
    createNote({ title: 'normal' });
    if (a.kind !== 'created') throw new Error('setup');
    updateNote(a.id, { pinned: true });
    const pinned = listPinnedNotes();
    expect(pinned.length).toBe(1);
    expect(pinned[0].title).toBe('pinned');
  });

  it('핀 0개면 빈 배열', () => {
    createNote({ title: 'x' });
    expect(listPinnedNotes()).toEqual([]);
  });
});

describe('previewWithMatch', () => {
  it('첫 매칭 위치 ± 40자', () => {
    const body = 'a'.repeat(80) + 'TARGET' + 'b'.repeat(120);
    const p = previewWithMatch(body, 'TARGET');
    expect(p).toContain('TARGET');
    expect(p.startsWith('…')).toBe(true);
    expect(p.endsWith('…')).toBe(true);
  });

  it('매칭 없으면 앞 120자', () => {
    const body = 'x'.repeat(200);
    const p = previewWithMatch(body, 'nope');
    expect(p.length).toBe(120);
  });
});
