import { createBackup } from '../lib/backup';

// CLI: npm run db:backup [destDir]
const destDir = process.argv[2];

createBackup(destDir)
  .then((path) => {
    console.log(`backup created: ${path}`);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
