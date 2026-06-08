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
//
// next build 도중에는 migrate 를 절대 돌리지 않는다 — 빌드는 페이지 데이터 수집 단계에서
// 이 모듈을 import 만 할 뿐이고, 실제 DB 변경은 런타임(서버 부팅)에 해야 한다. 이전엔 빌드
// 시점에 migrate 가 돌아 사용자 DB 상태(예: 이전 dev 실행으로 컬럼이 이미 추가됨)와 충돌해
// "duplicate column name" 으로 빌드 자체가 실패하던 문제가 있었음(사용자 보고 2026-06-05).
const isNextBuild = process.env.NEXT_PHASE === 'phase-production-build';

if (process.env.CORTEX_SKIP_AUTO_MIGRATE !== '1' && !isNextBuild) {
  try {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
  } catch (err) {
    // 회복 경로(사용자 보고 패턴): 이전 실행에서 ALTER TABLE 까지 적용됐는데
    // __drizzle_migrations 에 기록이 안 된 경우 → 다음 마이그레이션이 "duplicate column name"
    // 으로 실패. 자동 복구는 위험하므로(어느 migration 이 부분적용됐는지 안전히 추론 불가)
    // 명확한 진단 메시지 + 복구 명령을 안내. `npm run db:migrate` 의 idempotent 변종을 쓰게.
    const cause = (err as { cause?: { message?: string; code?: string } }).cause;
    if (cause?.code === 'SQLITE_ERROR' && /duplicate column name/i.test(cause.message ?? '')) {
      const msg =
        'DB 마이그레이션 충돌: 새 컬럼이 이미 존재합니다 ' +
        `(${cause.message}). ` +
        '이전 부분 실행으로 스키마만 적용되고 __drizzle_migrations 가 갱신 안 된 상태입니다. ' +
        '복구: `npm run db:migrate -- --recover` 실행 후 다시 시도하세요.';
      throw new Error(msg);
    }
    throw err;
  }
}

export { schema };
