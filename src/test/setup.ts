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

// 사전 리뷰 LLM 백엔드는 테스트에선 'api' 디폴트 — mock Anthropic 으로 검증하기 위함.
// 운영 디폴트는 'cli'(claude CLI spawn) 라 명시 안 하면 테스트가 실제 spawn 을 시도해
// 실패한다. CLI 경로 전용 테스트는 자체 beforeEach 에서 'cli' 로 override.
process.env.CORTEX_PRE_REVIEW_BACKEND = 'api';
