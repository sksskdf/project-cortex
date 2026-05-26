import { restoreBackup, dbPath } from '../lib/backup';

// CLI: npm run db:restore -- <backupFile>
// 라이브 DB 가 열려 있으면 (dev 서버 등) OS 가 덮어쓰기를 거부할 수 있으니 먼저 종료하세요.
const backupPath = process.argv[2];

if (!backupPath) {
  console.error('usage: npm run db:restore -- <backupFile>');
  process.exit(1);
}

try {
  restoreBackup(backupPath);
  console.log(`restored ${backupPath} -> ${dbPath()}`);
} catch (err: unknown) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
