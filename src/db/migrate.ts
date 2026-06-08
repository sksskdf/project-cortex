// 마이그레이션 CLI — 평소엔 drizzle migrate 를 그대로 실행.
//
// `--recover` 플래그(사용자 보고 2026-06-05): 이전 부분 실행으로 ALTER TABLE 은 적용됐지만
// __drizzle_migrations 가 갱신 안 된 경우 자동 복구. 각 마이그레이션 SQL 을 statement 단위로
// 시도하다가 "duplicate column name" 이면 already-applied 로 간주하고 다음으로 넘어가,
// 끝나면 __drizzle_migrations 에 해당 마이그레이션 hash 를 기록한다. 다른 종류 에러는 그대로 throw.

// db/client.ts 가 import 시점에 자동 migrate 를 돌리는데(평소 부팅 흐름), --recover 모드에서는
// 이 자동 migrate 가 바로 우리가 고치려는 충돌을 일으키므로 import 전에 꺼야 한다.
// → ES module 의 import hoisting 을 피하기 위해 dynamic import.
const RECOVER_MODE = process.argv.slice(2).includes('--recover');
if (RECOVER_MODE) process.env.CORTEX_SKIP_AUTO_MIGRATE = '1';

async function main(): Promise<void> {
  const crypto = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const { db } = await import('./client');

  const MIGRATIONS_DIR = 'src/db/migrations';

  type JournalEntry = { idx: number; tag: string; when: number };

  function readJournal(): JournalEntry[] {
    const journalPath = join(MIGRATIONS_DIR, 'meta', '_journal.json');
    const raw = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
    return raw.entries.sort((a, b) => a.idx - b.idx);
  }

  function migrationSql(tag: string): string {
    return readFileSync(join(MIGRATIONS_DIR, `${tag}.sql`), 'utf8');
  }

  // drizzle migrator 와 동일한 hash 계산 (sha256 of SQL content).
  function computeHash(sqlText: string): string {
    return crypto.createHash('sha256').update(sqlText).digest('hex');
  }

  function ensureMigrationsTable(): void {
    db.run(
      sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at NUMERIC
      )`,
    );
  }

  function appliedHashes(): Set<string> {
    ensureMigrationsTable();
    const rows = db.all<{ hash: string }>(sql`SELECT hash FROM __drizzle_migrations`);
    return new Set(rows.map((r) => r.hash));
  }

  function markApplied(hash: string, when: number): void {
    db.run(sql`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (${hash}, ${when})`);
  }

  // SQL 파일을 drizzle 의 statement-breakpoint 컨벤션으로 split.
  function splitStatements(sqlText: string): string[] {
    return sqlText
      .split(/--\s*>\s*statement-breakpoint\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function runRecover(): void {
    const journal = readJournal();
    const applied = appliedHashes();
    let recovered = 0;
    let appliedNew = 0;

    for (const entry of journal) {
      const sqlText = migrationSql(entry.tag);
      const hash = computeHash(sqlText);
      if (applied.has(hash)) {
        console.log(`[ok] ${entry.tag} — 이미 적용됨`);
        continue;
      }

      const statements = splitStatements(sqlText);
      let allAlreadyApplied = true;
      let anyApplied = false;

      for (const stmt of statements) {
        try {
          db.run(sql.raw(stmt));
          anyApplied = true;
          allAlreadyApplied = false;
        } catch (err) {
          const message = (err as Error).message ?? '';
          if (/duplicate column name/i.test(message)) {
            // 이미 적용된 statement — 정상 회복 케이스.
            continue;
          }
          if (/already exists/i.test(message)) {
            // CREATE TABLE/INDEX 같은 statement 도 idempotent 로.
            continue;
          }
          // 다른 에러는 진짜 실패 — 그대로 throw.
          throw err;
        }
      }

      markApplied(hash, Date.now());
      if (allAlreadyApplied) {
        recovered += 1;
        console.log(`[recover] ${entry.tag} — 스키마는 이미 있었음, journal 만 갱신`);
      } else if (anyApplied) {
        appliedNew += 1;
        console.log(`[applied] ${entry.tag} — 새로 적용 + journal 갱신`);
      }
    }

    console.log(`\n복구 완료: ${recovered}건 journal-only, ${appliedNew}건 신규 적용.`);
  }

  if (RECOVER_MODE) {
    runRecover();
  } else {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log('migrations applied');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
