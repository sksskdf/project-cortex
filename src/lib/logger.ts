// 구조화 로깅 (Phase 7). 단일 Pino 인스턴스를 export 한다.
// - dev: pino-pretty 로 사람이 읽기 좋은 컬러 출력.
// - prod: JSON 한 줄 출력 (로그 수집·회전에 적합).
// - 레벨: LOG_LEVEL 환경변수 (없으면 dev=debug, prod=info).
//
// 서버 전용. 클라이언트 컴포넌트에서 import 하지 말 것 (Node 전용 API 사용).
//
// pino-pretty 는 transport(worker thread) 가 아닌 동일 스레드 스트림으로 연결한다.
// transport 방식은 thread-stream worker 진입점이 Next 번들 경로
// (.next/server/vendor-chunks/lib/worker.js) 로 잘못 잡혀
// "Cannot find module ... worker.js" / "worker thread exited" 를 유발한다.

import pino, { type Logger } from 'pino';
import pretty from 'pino-pretty';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

export const logger: Logger = isProd
  ? pino({ level })
  : pino(
      { level },
      pretty({ colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' }),
    );
