import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/client';
import { appSettings } from '@/db/schema';
import { getSettings, setAiEnabled } from './settings';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(appSettings).run();
});

describe('settings — 전역 단일 row', () => {
  it('첫 호출 시 lazy init — aiEnabled=true 디폴트', () => {
    const s = getSettings();
    expect(s.id).toBe(1);
    expect(s.aiEnabled).toBe(true);
  });

  it('setAiEnabled 가 row 갱신 — 다음 getSettings 가 새 값 반환', () => {
    getSettings(); // init
    const updated = setAiEnabled(false);
    expect(updated.aiEnabled).toBe(false);
    expect(getSettings().aiEnabled).toBe(false);
  });

  it('row 없는 상태에서 setAiEnabled 호출해도 안전 (upsert)', () => {
    const r = setAiEnabled(false);
    expect(r.aiEnabled).toBe(false);
  });

  it('여러 번 호출해도 항상 id=1 단일 row', () => {
    getSettings();
    setAiEnabled(false);
    setAiEnabled(true);
    const rows = db.select().from(appSettings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });
});
