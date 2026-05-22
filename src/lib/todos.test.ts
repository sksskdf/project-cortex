import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { todos } from '@/db/schema';
import {
  countOpenTodos,
  createTodo,
  deleteTodo,
  listTodos,
  toggleTodoStatus,
  updateTodo,
} from './todos';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(todos).run();
});

describe('createTodo', () => {
  it('creates with defaults', () => {
    const r = createTodo({ title: 'task 1' });
    expect(r.kind).toBe('created');
    if (r.kind === 'created') expect(r.id).toBeGreaterThan(0);
  });

  it('rejects empty title', () => {
    expect(createTodo({ title: '   ' }).kind).toBe('error');
  });

  it('stores priority + dueAt', () => {
    const due = new Date('2030-01-01');
    const r = createTodo({ title: 'x', priority: 'high', dueAt: due });
    expect(r.kind).toBe('created');
    const list = listTodos();
    expect(list[0].priority).toBe('high');
    expect(list[0].dueAt?.toISOString().slice(0, 10)).toBe('2030-01-01');
  });
});

describe('toggleTodoStatus', () => {
  it('marks done sets completedAt', () => {
    const r = createTodo({ title: 'x' });
    if (r.kind !== 'created') throw new Error('setup');
    toggleTodoStatus(r.id, 'done');
    const list = listTodos();
    expect(list[0].status).toBe('done');
    expect(list[0].completedAt).not.toBeNull();
  });

  it('back to open clears completedAt', () => {
    const r = createTodo({ title: 'x' });
    if (r.kind !== 'created') throw new Error('setup');
    toggleTodoStatus(r.id, 'done');
    toggleTodoStatus(r.id, 'open');
    const list = listTodos();
    expect(list[0].completedAt).toBeNull();
  });
});

describe('listTodos filter', () => {
  it('open / done split', () => {
    createTodo({ title: 'a' });
    const b = createTodo({ title: 'b' });
    if (b.kind === 'created') toggleTodoStatus(b.id, 'done');
    expect(listTodos('open').length).toBe(1);
    expect(listTodos('done').length).toBe(1);
    expect(listTodos('all').length).toBe(2);
  });
});

describe('updateTodo / deleteTodo', () => {
  it('update title', () => {
    const r = createTodo({ title: 'old' });
    if (r.kind !== 'created') throw new Error('setup');
    updateTodo(r.id, { title: 'new' });
    expect(listTodos()[0].title).toBe('new');
  });

  it('delete removes', () => {
    const r = createTodo({ title: 'x' });
    if (r.kind !== 'created') throw new Error('setup');
    deleteTodo(r.id);
    expect(listTodos().length).toBe(0);
  });
});

describe('countOpenTodos', () => {
  it('counts open + in-progress only', () => {
    createTodo({ title: 'a' });
    const b = createTodo({ title: 'b' });
    if (b.kind === 'created') toggleTodoStatus(b.id, 'done');
    expect(countOpenTodos()).toBe(1);
  });
});
