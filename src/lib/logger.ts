// 구조화 로깅 (Phase 7). 단일 Pino 인스턴스를 export 한다.
// - dev: pino-pretty 로 사람이 읽기 좋은 컬러 출력.
// - prod: JSON 한 줄 출력 (로그 수집·회전에 적합).
// - 레벨: LOG_LEVEL 환경변수 (없으면 dev=debug, prod=info).
//
// 서버 전용. 클라이언트 컴포넌트에서 import 하지 말 것 (Node 전용 API 사용).

import pino, { type Logger } from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

export const logger: Logger = pino(
  isProd
    ? { level }
    : {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      },
);
