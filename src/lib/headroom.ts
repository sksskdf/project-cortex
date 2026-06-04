// Headroom 통합 — LLM 컨텍스트를 LLM 에 보내기 전 로컬 압축(60-95% 토큰 절감, CCR 가역).
// https://github.com/chopratejas/headroom
//
// 통합 모드 선택 근거:
// - Cortex 는 Anthropic SDK 를 안 씁니다(Phase 4.6 #136 — 크레딧 0, claude CLI 전용). 따라서
//   Headroom 의 proxy(SDK baseURL 가리키기)·inline SDK(withHeadroom(new Anthropic())) 모드는
//   적용 불가. CLI wrap 모드(`headroom wrap claude ...`)만 자연스럽게 맞음.
// - wrap 은 argv 앞에 `headroom wrap` 만 붙이는 패턴 — stdin/stdout pass-through(README "zero
//   code changes") 가정으로 기존 flag(`--json-schema`, `--append-system-prompt-file`,
//   `--fallback-model`, `--dangerously-skip-permissions`, `-p --output-format json`)가 그대로
//   forwarding 된다는 전제. 실 호환성은 런타임 검증 필요(사용자 머신).
//
// 적용 범위(1차): headless 자동화 4종(runClaudeHeadless 경로). PTY 인터랙티브 세션은 별도 후속.
//
// 안전망:
// - 기본 OFF(opt-in). settings 의 headroomEnabled 토글로 켬.
// - ON 이라도 binary 미감지면 원본 claude 직접 spawn(warning 로그) — 무회귀.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// PATH 에서 `headroom` 실행 파일 위치. 없으면 null.
// (agents.ts 의 resolveOnPath 와 동일 패턴 — 헤드룸은 독립 binary 라 화이트리스트 분리.)
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

export function resolveHeadroom(): string | null {
  return resolveOnPath('headroom');
}

export function isHeadroomAvailable(): boolean {
  return resolveHeadroom() !== null;
}

// `headroom --version` 첫 토큰 추출 — getClaudeCliVersion 과 동일 컨벤션.
// 미설치/실패 시 null. 서버 시작 시 1회 로깅해 회귀 진단.
type VersionExec = (path: string, args: string[]) => Promise<string>;
let _versionExec: VersionExec | null = null;
export function setHeadroomVersionExec(runner: VersionExec | null): void {
  _versionExec = runner;
}

function defaultVersionExec(path: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const useShell = /\.(cmd|bat)$/i.test(path);
    execFile(path, args, { shell: useShell, timeout: 10_000 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

export function parseHeadroomVersion(output: string): string | null {
  const first = output.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

export async function getHeadroomVersion(): Promise<string | null> {
  const path = resolveHeadroom();
  if (!path) return null;
  try {
    const out = await (_versionExec ?? defaultVersionExec)(path, ['--version']);
    return parseHeadroomVersion(out);
  } catch {
    return null;
  }
}

// spawn argv 변환 — 토글 + binary 가용성에 따라 (command, args) 결정.
// 입력: 원본 claude command(path) + 원본 args. 토글 ON + headroom 사용 가능이면
// command 를 headroom 으로 바꾸고 `wrap claude` 를 args 앞에 추가. 그 외엔 원본 그대로.
// 순수 함수 — 외부 상태 안 읽음, 테스트 용이.
export type SpawnTarget = { command: string; args: string[] };
export type WrapInput = {
  // 원본 claude 실행 경로 (resolveClaude().path).
  claudePath: string;
  // claude 에 전달할 원본 argv (-p --output-format json --model ...).
  claudeArgs: ReadonlyArray<string>;
  // settings.headroomEnabled 값.
  enabled: boolean;
  // resolveHeadroom() 결과. 미감지면 null.
  headroomPath: string | null;
};

export function wrapClaudeSpawn(input: WrapInput): SpawnTarget {
  if (!input.enabled || input.headroomPath === null) {
    // OFF 거나 binary 미감지 — 원본 claude 직접 spawn(무회귀).
    return { command: input.claudePath, args: [...input.claudeArgs] };
  }
  // ON + binary 감지 — `headroom wrap claude <원본 args...>`.
  // claude 자체는 PATH 에서 headroom 이 다시 찾는다(절대경로 전달 불필요 — headroom 의 wrap
  // 책임). 만약 claude 가 PATH 에 없는 환경이면 headroom 이 실패 → spawn 에러로 자연 종료
  // → 사전 리뷰 1회 실패 → 다음 분석 시 재시도. (정상 환경에선 둘 다 PATH 에 있음.)
  return { command: input.headroomPath, args: ['wrap', 'claude', ...input.claudeArgs] };
}
