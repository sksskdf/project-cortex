// vitest 셋업 — 모든 테스트 파일이 공유하는 환경 변수 설정.
// 테스트는 별도 DB 파일을 사용해 dev 데이터 보존.
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = 'data/test.sqlite';

if (existsSync(TEST_DB)) {
  unlinkSync(TEST_DB);
}
if (existsSync(`${TEST_DB}-wal`)) {
  unlinkSync(`${TEST_DB}-wal`);
}
if (existsSync(`${TEST_DB}-shm`)) {
  unlinkSync(`${TEST_DB}-shm`);
}

process.env.CORTEX_DB_PATH = TEST_DB;
