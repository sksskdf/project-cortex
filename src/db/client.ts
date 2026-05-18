import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const DB_PATH = process.env.CORTEX_DB_PATH ?? 'data/cortex.sqlite';

mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// 모듈 로드 시 1회 자동 마이그레이션. drizzle이 __drizzle_migrations 테이블로
// 이미 적용된 항목은 스킵 → 멱등. seed는 파괴적이라 자동화 안 함 (수동 npm run db:seed).
// CORTEX_SKIP_AUTO_MIGRATE=1 로 끌 수 있음 (테스트·시드 스크립트 등 의도적 우회).
if (process.env.CORTEX_SKIP_AUTO_MIGRATE !== '1') {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
}

export { schema };
