// Phase 13 — Claude CLI 통합 공통 헬퍼.
// 보안 (박제): spawn 대상은 화이트리스트(ALLOWED_COMMANDS)만. 임의 shell 명령 X.
// 작업 디렉토리는 Phase 12 로 등록된 워크스페이스 경로로만 제한 (pty 서버에서 DB 조회).

import { execFile } from 'node:child_process';
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

export type ResolvedClaude = { command: AllowedCommand; path: string };

// 화이트리스트 중 PATH 에 존재하는 첫 명령 + 그 실행 파일의 전체 경로. 없으면 null.
// 전체 경로를 반환하는 이유: Windows 전역 npm bin 은 claude.cmd 라 이름만으로는 node-pty
// (ConPTY) 가 실행 못 함 — 호출측이 경로 + 확장자로 spawn 방식을 정한다.
export function resolveClaude(): ResolvedClaude | null {
  for (const command of ALLOWED_COMMANDS) {
    const path = resolveOnPath(command);
    if (path) return { command, path };
  }
  return null;
}

export function isClaudeAvailable(): boolean {
  return resolveClaude() !== null;
}

// claude CLI / PTY spawn 용 환경변수. ANTHROPIC_API_KEY 를 제거해 claude 가 API 로
// 과금하지 않고 사용자 구독(claude login)으로 동작하게 한다 → 모든 AI 작업 크레딧 0.
// (key 가 환경에 있으면 claude CLI 가 -p / 대화형 무관하게 API 인증을 우선한다.)
// GIT_TERMINAL_PROMPT=0 으로 git 자격증명 대화형 프롬프트도 차단.
export function claudeSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

// Phase 13.6 — CLI 버전 추적(회귀 가드). `claude --version` 의 첫 토큰을 버전으로 본다
// (예: "1.2.3 (Claude Code)" → "1.2.3"). claude 미설치/실패 시 null — 읽기 전용이라 어떤
// spawn 동작에도 영향 없음. 지원 플래그·출력 스키마 변동 진단(예: readiness 신호·json-schema)
// 에 활용. 결과는 호출부가 로깅/표시.
type VersionExec = (path: string, args: string[]) => Promise<string>;
let _versionExec: VersionExec | null = null;
// 테스트 주입 — null 이면 실제 execFile.
export function setVersionExec(runner: VersionExec | null): void {
  _versionExec = runner;
}

function defaultVersionExec(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // Windows 전역 npm bin 은 claude.cmd (배치) — execFile 이 직접 못 띄우므로 shell 경유.
    const useShell = /\.(cmd|bat)$/i.test(path);
    execFile(
      path,
      args,
      { env: claudeSpawnEnv(), shell: useShell, timeout: 10_000 },
      (err, out) => {
        if (err) reject(err);
        else resolve(out);
      },
    );
  });
}

// `claude --version` 출력에서 버전 추출 — 첫 공백 구분 토큰("1.2.3 (Claude Code)" → "1.2.3").
// 빈 출력이면 null. 순수 함수 — claude 유무와 무관하게 테스트 가능.
export function parseClaudeVersion(output: string): string | null {
  const first = output.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

export async function getClaudeCliVersion(): Promise<string | null> {
  const claude = resolveClaude();
  if (!claude) return null;
  try {
    const out = await (_versionExec ?? defaultVersionExec)(claude.path, ['--version']);
    return parseClaudeVersion(out);
  } catch {
    return null;
  }
}
