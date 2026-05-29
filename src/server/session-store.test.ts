import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSessionStorePath,
  loadPersistedSessions,
  savePersistedSessions,
  type PersistedSession,
} from './session-store';

const sample: PersistedSession[] = [
  { id: 'a1', name: '세션 1', workspaceId: 3, createdAt: 1000, lastActivityAt: 2000, runId: null },
  { id: 'b2', name: 'foo', workspaceId: 7, createdAt: 1500, lastActivityAt: 2500, runId: 42 },
];

describe('session-store', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cortex-sessions-'));
    file = join(dir, 'agent-sessions.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips saved sessions', () => {
    savePersistedSessions(file, sample);
    expect(loadPersistedSessions(file)).toEqual(sample);
  });

  it('returns [] when the file does not exist', () => {
    expect(loadPersistedSessions(join(dir, 'missing.json'))).toEqual([]);
  });

  it('creates parent directories on save', () => {
    const nested = join(dir, 'a', 'b', 'sessions.json');
    savePersistedSessions(nested, sample);
    expect(loadPersistedSessions(nested)).toEqual(sample);
  });

  it('returns [] on corrupt JSON', () => {
    writeFileSync(file, '{ this is not json', 'utf8');
    expect(loadPersistedSessions(file)).toEqual([]);
  });

  it('returns [] when the JSON is not an array', () => {
    writeFileSync(file, JSON.stringify({ id: 'x' }), 'utf8');
    expect(loadPersistedSessions(file)).toEqual([]);
  });

  it('drops entries with missing or wrong-typed fields', () => {
    const mixed = [
      sample[0],
      { id: 'no-name', workspaceId: 1, createdAt: 1, lastActivityAt: 1 }, // name 없음
      { id: 'bad-ws', name: 'x', workspaceId: '2', createdAt: 1, lastActivityAt: 1 }, // ws 타입
      { name: 'no-id', workspaceId: 1, createdAt: 1, lastActivityAt: 1 }, // id 없음
      { id: '', name: 'empty-id', workspaceId: 1, createdAt: 1, lastActivityAt: 1 }, // 빈 id
    ];
    writeFileSync(file, JSON.stringify(mixed), 'utf8');
    expect(loadPersistedSessions(file)).toEqual([sample[0]]);
  });

  it('normalizes a missing runId to null (back-compat with old files)', () => {
    const legacy = [{ id: 'old', name: 'x', workspaceId: 1, createdAt: 1, lastActivityAt: 1 }];
    writeFileSync(file, JSON.stringify(legacy), 'utf8');
    expect(loadPersistedSessions(file)).toEqual([{ ...legacy[0], runId: null }]);
  });

  it('overwrites prior contents on re-save', () => {
    savePersistedSessions(file, sample);
    savePersistedSessions(file, [sample[0]]);
    expect(loadPersistedSessions(file)).toEqual([sample[0]]);
  });

  it('defaultSessionStorePath sits beside the DB path', () => {
    const prev = process.env.CORTEX_DB_PATH;
    process.env.CORTEX_DB_PATH = '/var/data/cortex.sqlite';
    try {
      expect(defaultSessionStorePath()).toBe(join('/var/data', 'agent-sessions.json'));
    } finally {
      if (prev === undefined) delete process.env.CORTEX_DB_PATH;
      else process.env.CORTEX_DB_PATH = prev;
    }
  });
});
