// Phase 13 — Claude CLI 통합 공통 헬퍼.
// 보안 (박제): spawn 대상은 화이트리스트(ALLOWED_COMMANDS)만. 임의 shell 명령 X.
// 작업 디렉토리는 Phase 12 로 등록된 워크스페이스 경로로만 제한 (pty 서버에서 DB 조회).

import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// spawn 허용 명령 — 이 배열 밖의 어떤 것도 spawn 하지 않습니다. 클라이언트는 명령을
// 고를 수 없고, 서버가 PATH 에서 존재하는 첫 항목을 선택합니다.
export const ALLOWED_COMMANDS = ['claude', 'claude-code'] as const;
export type AllowedCommand = (typeof ALLOWED_COMMANDS)[number];

// PATH 에서 실행 파일을 찾습니다 (which 와 동일). 없으면 null.
function resolveOnPath(command: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      if (existsSync(join(dir, command + ext))) return join(dir, command + ext);
    }
  }
  return null;
}

// 화이트리스트 중 PATH 에 존재하는 첫 명령. 없으면 null.
export function findClaudeCommand(): AllowedCommand | null {
  for (const cmd of ALLOWED_COMMANDS) {
    if (resolveOnPath(cmd)) return cmd;
  }
  return null;
}

export function isClaudeAvailable(): boolean {
  return findClaudeCommand() !== null;
}
