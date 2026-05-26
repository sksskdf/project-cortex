import Database from 'better-sqlite3';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  closeSync,
  rmSync,
} from 'node:fs';
import { dirname, join, basename } from 'node:path';

// SQLite/CLI 전용. UI·Server Action 에서 import 하지 않습니다 (서버/CLI only).
// client.ts 를 거치지 않고 직접 핸들을 열어 자동 migrate 부작용을 피합니다.

const DEFAULT_DB_PATH = 'data/cortex.sqlite';
const DEFAULT_BACKUP_DIR = 'data/backups';

// 모든 SQLite 파일은 이 16바이트 매직 헤더로 시작합니다.
const SQLITE_HEADER = 'SQLite format 3\0';

export function dbPath(): string {
  return process.env.CORTEX_DB_PATH ?? DEFAULT_DB_PATH;
}

export function backupDir(): string {
  return process.env.CORTEX_BACKUP_DIR ?? DEFAULT_BACKUP_DIR;
}

function timestamp(date = new Date()): string {
  // 파일명 안전한 정렬 가능 타임스탬프: YYYYMMDD-HHmmss.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function backupFileName(date = new Date()): string {
  const stem = basename(dbPath()).replace(/\.sqlite$/i, '');
  return `${stem}-${timestamp(date)}.sqlite`;
}

// 파일이 유효한 SQLite DB 인지 헤더 매직으로 검증.
export function isValidSqliteFile(path: string): boolean {
  if (!existsSync(path)) return false;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const read = readSync(fd, buf, 0, 16, 0);
    if (read < 16) return false;
    return buf.toString('utf8') === SQLITE_HEADER;
  } finally {
    closeSync(fd);
  }
}

// 온라인 백업 API 로 일관된 핫 카피 생성 (WAL 체크포인트 포함).
// 원시 파일 복사 대신 db.backup() 을 써서 동시 쓰기 중에도 안전한 스냅샷을 얻습니다.
export async function createBackup(destDir = backupDir()): Promise<string> {
  const source = dbPath();
  if (!existsSync(source)) {
    throw new Error(`Source database not found: ${source}`);
  }

  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, backupFileName());

  const source_db = new Database(source, { readonly: true });
  try {
    await source_db.backup(destPath);
  } finally {
    source_db.close();
  }

  if (!isValidSqliteFile(destPath)) {
    throw new Error(`Backup produced an invalid SQLite file: ${destPath}`);
  }
  return destPath;
}

// 백업본을 라이브 DB 위에 복원. 라이브 파일 잠금 여부는 안정적으로 감지하기 어려우므로
// 백업 파일 존재·유효성만 검증합니다 (열린 핸들이 있으면 OS 가 거부).
export function restoreBackup(backupPath: string, target = dbPath()): void {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  if (!isValidSqliteFile(backupPath)) {
    throw new Error(`Refusing to restore: not a valid SQLite file: ${backupPath}`);
  }

  mkdirSync(dirname(target), { recursive: true });
  // 복원 전에 현재 라이브 DB 를 안전 백업 (실수 복구용).
  if (existsSync(target) && isValidSqliteFile(target)) {
    copyFileSync(target, `${target}.pre-restore`);
  }
  copyFileSync(backupPath, target);
  // WAL 모드 사이드카가 남아 있으면 복원된 메인 파일을 덮어쓰므로 제거.
  // (백업은 이미 체크포인트된 단일 파일이라 사이드카 없이 일관됨.)
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
}
