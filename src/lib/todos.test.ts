import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { issues, projects, todos } from '@/db/schema';
import {
  countOpenTodos,
  createTodo,
  deleteTodo,
  linkTodoToIssue,
  listTodos,
  promoteTodoToIssue,
  toggleTodoStatus,
  updateTodo,
} from './todos';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  // todos 가 issues 를 참조하므로 todos → issues → projects 순으로 정리.
  db.delete(todos).run();
  db.delete(issues).run();
  db.delete(projects).run();
});

function seedIssue(): number {
  const repoId = db
    .insert(projects)
    .values({ slug: 'p', name: 'p' })
    .returning({ id: projects.id })
    .get().id;
  return db
    .insert(issues)
    .values({ repoId, title: 'issue', spec: 'spec', assigneeKind: 'human', assigneeId: 'me' })
    .returning({ id: issues.id })
    .get().id;
}

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

describe('linkTodoToIssue', () => {
  it('이슈 링크 기본값은 null', () => {
    createTodo({ title: 'x' });
    expect(listTodos()[0].issueId).toBeNull();
  });

  it('링크 설정 후 view 에 issueId 노출, null 로 해제', () => {
    const issueId = seedIssue();
    const r = createTodo({ title: 'x' });
    if (r.kind !== 'created') throw new Error('setup');

    expect(linkTodoToIssue(r.id, issueId).kind).toBe('updated');
    expect(listTodos()[0].issueId).toBe(issueId);

    expect(linkTodoToIssue(r.id, null).kind).toBe('updated');
    expect(listTodos()[0].issueId).toBeNull();
  });

  it('없는 todo 는 not-found', () => {
    expect(linkTodoToIssue(999, null).kind).toBe('not-found');
  });
});

describe('promoteTodoToIssue — Phase 18 승격', () => {
  function seedProject(): number {
    return db.insert(projects).values({ slug: 'p', name: 'p' }).returning({ id: projects.id }).get()
      .id;
  }

  it('프로젝트 연결된 TODO 를 이슈로 승격 + 연결 + in-progress', () => {
    const repoId = seedProject();
    const r = createTodo({ title: '버그 고치기', note: '수용 기준 X', projectId: repoId });
    if (r.kind !== 'created') throw new Error('setup');

    const promoted = promoteTodoToIssue(r.id, { delegateToClaude: true, humanAssigneeId: 'me' });
    expect(promoted.kind).toBe('promoted');
    if (promoted.kind === 'promoted') {
      expect(promoted.repoId).toBe(repoId);
      expect(promoted.spec).toBe('수용 기준 X'); // note 가 spec
      // 생성된 이슈 확인.
      const issue = db.select().from(issues).where(eq(issues.id, promoted.issueId)).get();
      expect(issue?.title).toBe('버그 고치기');
      expect(issue?.assigneeKind).toBe('agent'); // delegate=true
    }
    // TODO 가 이슈에 연결 + in-progress.
    const todo = listTodos()[0];
    expect(todo.issueId).toBe(promoted.kind === 'promoted' ? promoted.issueId : -1);
    expect(todo.status).toBe('in-progress');
  });

  it('note 없으면 제목을 spec 으로', () => {
    const repoId = seedProject();
    const r = createTodo({ title: '제목만', projectId: repoId });
    if (r.kind !== 'created') throw new Error('setup');
    const promoted = promoteTodoToIssue(r.id, { delegateToClaude: true, humanAssigneeId: 'me' });
    expect(promoted.kind === 'promoted' && promoted.spec).toBe('제목만');
  });

  it('프로젝트 미연결(개인) TODO 는 no-project', () => {
    const r = createTodo({ title: 'personal' });
    if (r.kind !== 'created') throw new Error('setup');
    expect(promoteTodoToIssue(r.id, { delegateToClaude: true, humanAssigneeId: 'me' }).kind).toBe(
      'no-project',
    );
  });

  it('이미 이슈 연결된 TODO 는 already-linked', () => {
    const repoId = seedProject();
    const r = createTodo({ title: 'x', projectId: repoId });
    if (r.kind !== 'created') throw new Error('setup');
    const first = promoteTodoToIssue(r.id, { delegateToClaude: true, humanAssigneeId: 'me' });
    expect(first.kind).toBe('promoted');
    const second = promoteTodoToIssue(r.id, { delegateToClaude: true, humanAssigneeId: 'me' });
    expect(second.kind).toBe('already-linked');
  });

  it('없는 todo 는 not-found', () => {
    expect(promoteTodoToIssue(999, { delegateToClaude: true, humanAssigneeId: 'me' }).kind).toBe(
      'not-found',
    );
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
