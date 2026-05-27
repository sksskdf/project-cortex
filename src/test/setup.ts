// vitest 셋업 — 모든 테스트 파일이 공유하는 환경 변수 설정.
// 테스트는 별도 DB 파일을 사용해 dev 데이터 보존.
import { unlinkSync } from 'node:fs';

const TEST_DB = 'data/test.sqlite';

// 다중 worker가 동시 unlinkSync 호출 시 race — ENOENT는 무시.
function safeUnlink(path: string) {
  try {
    unlinkSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

safeUnlink(TEST_DB);
safeUnlink(`${TEST_DB}-wal`);
safeUnlink(`${TEST_DB}-shm`);

process.env.CORTEX_DB_PATH = TEST_DB;

// 모든 LLM 작업은 claude CLI 경로 하나뿐 — 테스트는 setClaudeRunner 로 spawn 을 주입한다.
// (Anthropic API SDK 경로는 제거됨.)
