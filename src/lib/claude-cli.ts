// Phase 13 — headless claude CLI 호출. 사전 리뷰·충돌 해결 같은 자동화 작업이 사용자의
// Claude 플랜으로 LLM 을 호출한다 (Anthropic API 크레딧 0). 대화형 pty(server/pty.ts)와
// 달리 비대화형 print 모드(`claude -p`)로 1회 응답을 받아 파싱한다.
//
// 보안 (박제):
// - spawn 대상은 resolveClaude() 화이트리스트(claude/claude-code)만. 임의 shell 명령 X.
// - shell 미사용 — 인자는 배열로 직접 전달. Windows 의 claude.cmd 는 cmd.exe /c 로 래핑.
// - 무거운/멀티라인 프롬프트(시스템 규칙 + diff)는 stdin 으로 전달 → 인자 쿼팅 문제 회피.
//   argv 에는 짧은 지시문만 (shell 메타문자 없는 한국어 한 줄).
//
// 테스트: setClaudeRunner 로 실제 spawn 을 대체 주입 (anthropic.ts/github.ts 와 동일 패턴).

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { claudeSpawnEnv, resolveClaude } from './agents';

// 사전 리뷰(Opus thinking) 는 오래 걸릴 수 있어 넉넉히. 호출부가 override 가능.
const DEFAULT_TIMEOUT_MS = 180_000;

export type ClaudeRunOptions = {
  // stdin 으로 전달할 본문 — 시스템 규칙 + 컨텍스트 + diff 등 무거운 내용.
  input: string;
  // argv 로 전달할 짧은 지시문 — ascii/한국어 한 줄, shell 메타문자 금지.
  instruction: string;
  // --model. alias(opus/sonnet/haiku) 또는 full id.
  model?: string;
  // 작업 디렉토리 — 충돌 해결처럼 repo 접근이 필요한 경우. 사전 리뷰는 불필요.
  cwd?: string;
  timeoutMs?: number;
  // 도구(파일 편집·Bash 등) 사용 허용 + 권한 프롬프트 우회. 충돌 해결처럼 claude 가
  // cwd 안에서 파일을 직접 고쳐야 하는 경우만 true. 사전 리뷰(분석만)는 false.
  // 비대화형이라 권한 프롬프트로 멈추면 안 되므로 --dangerously-skip-permissions 필요.
  // 위험: cwd 안에서 임의 파일 수정/명령 실행이 가능 — 호출부가 cwd 화이트리스트(등록된
  // 워크스페이스)로 제한해야 함.
  dangerouslyAllowAllTools?: boolean;
};

export type ClaudeRunResult = { ok: true; text: string } | { ok: false; reason: string };

type ClaudeRunner = (opts: ClaudeRunOptions) => Promise<ClaudeRunResult>;

// 테스트 주입용. null 이면 실제 spawn.
let _runner: ClaudeRunner | null = null;
export function setClaudeRunner(runner: ClaudeRunner | null): void {
  _runner = runner;
}

export async function runClaudeHeadless(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  if (_runner) return _runner(opts);
  return spawnClaude(opts);
}

function spawnClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const claude = resolveClaude();
  if (!claude) return Promise.resolve({ ok: false, reason: 'claude CLI 를 찾을 수 없습니다.' });

  // -p: 비대화형 print 모드. --output-format json: result 봉투. stdin 으로 본문 전달 +
  // argv 에 짧은 지시문. (--max-turns 는 한계 도달 시 에러 종료라 단일 응답 분석에서
  // 정상 완료를 실패로 오인할 위험이 있어 사용 안 함 — 자기완결 프롬프트라 도구 루프 위험 낮음.)
  const cliArgs = ['-p', '--output-format', 'json'];
  if (opts.model) cliArgs.push('--model', opts.model);
  // 충돌 해결 등 파일 수정이 필요한 작업만 도구 허용 + 권한 우회 (비대화형이라 프롬프트
  // 로 멈추면 안 됨). 분석 전용(사전 리뷰)은 이 플래그 없이 순수 텍스트 응답.
  if (opts.dangerouslyAllowAllTools) cliArgs.push('--dangerously-skip-permissions');
  cliArgs.push(opts.instruction);

  // Windows 전역 npm bin 은 claude.cmd (배치) — Node 가 .cmd 를 직접 spawn 못 하므로
  // cmd.exe /c 로 감싼다 (pty.ts 와 동일 전략). POSIX 는 resolve 된 경로 직접 실행.
  const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claude.path);
  const file = isWinScript ? (process.env.ComSpec ?? 'cmd.exe') : claude.path;
  const args = isWinScript ? ['/c', claude.path, ...cliArgs] : cliArgs;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(file, args, {
        // cwd 미지정(사전 리뷰 등 분석 전용)이면 중립 tmpdir 에서 실행 — repo cwd 에서 돌리면
        // claude 가 그 프로젝트의 CLAUDE.md·git 상태·도구 컨텍스트를 끌어와 코딩 에이전트로
        // 변질(분석 대신 "파일 커밋할까요?" 같은 응답)된다. 충돌 해결은 cwd(워크스페이스)를 명시 전달.
        cwd: opts.cwd ?? tmpdir(),
        env: claudeSpawnEnv(),
      });
    } catch (err) {
      resolve({ ok: false, reason: `claude spawn 실패: ${errMsg(err)}` });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r: ClaudeRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      done({ ok: false, reason: 'claude CLI 시간 초과' });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) => done({ ok: false, reason: `claude CLI 오류: ${err.message}` }));
    child.on('close', (code) => {
      if (code !== 0) {
        done({
          ok: false,
          reason: `claude CLI 비정상 종료 (code ${code}): ${stderr.slice(-300).trim()}`,
        });
        return;
      }
      const text = extractResult(stdout);
      if (text === null) {
        done({ ok: false, reason: `claude CLI 응답 파싱 실패: ${stdout.slice(0, 300)}` });
        return;
      }
      done({ ok: true, text });
    });

    // 무거운 본문은 stdin 으로 — argv 길이 한계·쿼팅 회피.
    child.stdin?.on('error', () => {
      // EPIPE 등 — close 핸들러가 종료 처리.
    });
    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

// `--output-format json` 봉투에서 모델 텍스트(result)를 꺼낸다. is_error 면 null.
function extractResult(stdout: string): string | null {
  try {
    const envelope = JSON.parse(stdout) as {
      result?: unknown;
      is_error?: unknown;
    };
    if (envelope.is_error === true) return null;
    return typeof envelope.result === 'string' ? envelope.result : null;
  } catch {
    return null;
  }
}

// 모델 응답에서 JSON 을 꺼낸다. 코드펜스(```json ... ```)를 벗기고, 산문이 섞여 있어도
// 첫 번째 균형 잡힌 {...} 객체를 추출해 파싱 (CLI 모델이 설명을 덧붙이는 경우 대비).
export function parseJsonFromText(text: string): unknown {
  let t = text.trim();
  // 코드펜스가 있으면 그 안쪽 우선 (앵커 없이 — 펜스 앞뒤 산문 허용).
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const obj = extractFirstJsonObject(t);
    if (obj !== null) return JSON.parse(obj);
    throw new Error('응답에서 JSON 객체를 찾지 못했습니다.');
  }
}

// 문자열에서 첫 번째 균형 잡힌 {...} 객체를 추출 (문자열 리터럴·이스케이프 고려).
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
