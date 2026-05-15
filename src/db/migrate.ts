import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './client';

migrate(db, { migrationsFolder: 'src/db/migrations' });
console.log('migrations applied');
