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
import { randomBytes } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // R1 (Phase 13.6) — JSON Schema 강제. 주면 `--json-schema` 로 전달하고, 응답 봉투의
  // `structured_output`(스키마 검증된 객체)을 result.structured 로 돌려준다. 모델이 산문/펜스를
  // 섞어도 파싱 취약점(parseJsonFromText)을 우회. 미지원 CLI 대비: 도구 미사용(분석) 호출은
  // 비정상 종료 시 이 플래그 없이 1회 자동 재시도해 기존 동작으로 degrade.
  jsonSchema?: object;
  // R2 (Phase 13.6) — 기본 시스템 프롬프트에 덧붙일 텍스트(예: Cortex 방법론). 멀티라인이라
  // argv 쿼팅을 피하려 임시 파일에 쓰고 `--append-system-prompt-file` 로 전달. 슬래시 스킬은
  // `-p` 헤드리스에서 안 먹으므로, 코딩 자동화에 방법론을 일관 주입하는 경로.
  appendSystemPrompt?: string;
};

export type ClaudeRunResult =
  | { ok: true; text: string; structured?: unknown }
  | { ok: false; reason: string };

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

async function spawnClaude(opts: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const claude = resolveClaude();
  if (!claude) return { ok: false, reason: 'claude CLI 를 찾을 수 없습니다.' };

  // 향상 플래그(--json-schema / --append-system-prompt-file)를 켠 1차 시도.
  const first = await runOnce(claude.path, opts, true);
  if (first.ok || !first.nonZeroExit) return strip(first);

  // 미지원 CLI 등으로 비정상 종료 + 도구 미사용(분석, 부작용 없음) 이면 향상 플래그 없이
  // 1회 재시도 → 기존 동작으로 안전하게 degrade. 도구 사용(코딩 자동화)은 부분 편집
  // 재실행 위험이 있어 재시도하지 않는다.
  const usedEnhancements = Boolean(opts.jsonSchema || opts.appendSystemPrompt);
  if (usedEnhancements && !opts.dangerouslyAllowAllTools) {
    const retry = await runOnce(claude.path, opts, false);
    if (retry.ok) return strip(retry);
  }
  return strip(first);
}

type InternalResult =
  | { ok: true; text: string; structured?: unknown; nonZeroExit?: false }
  | { ok: false; reason: string; nonZeroExit: boolean };

function strip(r: InternalResult): ClaudeRunResult {
  if (r.ok) return { ok: true, text: r.text, structured: r.structured };
  return { ok: false, reason: r.reason };
}

// 1회 spawn. useEnhancements=false 면 --json-schema / --append-system-prompt-file 를 생략.
function runOnce(
  claudePath: string,
  opts: ClaudeRunOptions,
  useEnhancements: boolean,
): Promise<InternalResult> {
  // -p: 비대화형 print 모드. --output-format json: result 봉투. stdin 으로 본문 전달 +
  // argv 에 짧은 지시문. (--max-turns 는 한계 도달 시 에러 종료라 단일 응답 분석에서
  // 정상 완료를 실패로 오인할 위험이 있어 사용 안 함 — 자기완결 프롬프트라 도구 루프 위험 낮음.)
  const cliArgs = ['-p', '--output-format', 'json'];
  if (opts.model) cliArgs.push('--model', opts.model);
  // 충돌 해결 등 파일 수정이 필요한 작업만 도구 허용 + 권한 우회 (비대화형이라 프롬프트
  // 로 멈추면 안 됨). 분석 전용(사전 리뷰)은 이 플래그 없이 순수 텍스트 응답.
  if (opts.dangerouslyAllowAllTools) cliArgs.push('--dangerously-skip-permissions');

  // 임시 파일(시스템 프롬프트) 경로 — finally 에서 정리.
  let sysPromptFile: string | null = null;
  if (useEnhancements && opts.jsonSchema) {
    cliArgs.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }
  if (useEnhancements && opts.appendSystemPrompt) {
    sysPromptFile = join(tmpdir(), `cortex-sysprompt-${randomBytes(8).toString('hex')}.md`);
    try {
      writeFileSync(sysPromptFile, opts.appendSystemPrompt, 'utf8');
      cliArgs.push('--append-system-prompt-file', sysPromptFile);
    } catch {
      // 임시 파일 쓰기 실패 — 방법론 주입은 best-effort, 플래그 없이 진행.
      sysPromptFile = null;
    }
  }
  cliArgs.push(opts.instruction);

  // Windows 전역 npm bin 은 claude.cmd (배치) — Node 가 .cmd 를 직접 spawn 못 하므로
  // cmd.exe /c 로 감싼다 (pty.ts 와 동일 전략). POSIX 는 resolve 된 경로 직접 실행.
  const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(claudePath);
  const file = isWinScript ? (process.env.ComSpec ?? 'cmd.exe') : claudePath;
  const args = isWinScript ? ['/c', claudePath, ...cliArgs] : cliArgs;

  const cleanup = () => {
    if (sysPromptFile) {
      try {
        rmSync(sysPromptFile, { force: true });
      } catch {
        // 무시 — tmpdir 는 OS 가 정리.
      }
    }
  };

  return new Promise<InternalResult>((resolve) => {
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
      cleanup();
      resolve({ ok: false, reason: `claude spawn 실패: ${errMsg(err)}`, nonZeroExit: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (r: InternalResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(r);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      done({ ok: false, reason: 'claude CLI 시간 초과', nonZeroExit: false });
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));
    child.on('error', (err) =>
      done({ ok: false, reason: `claude CLI 오류: ${err.message}`, nonZeroExit: false }),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        done({
          ok: false,
          reason: `claude CLI 비정상 종료 (code ${code}): ${stderr.slice(-300).trim()}`,
          nonZeroExit: true,
        });
        return;
      }
      const extracted = extractResult(stdout);
      if (extracted === null) {
        done({
          ok: false,
          reason: `claude CLI 응답 파싱 실패: ${stdout.slice(0, 300)}`,
          nonZeroExit: false,
        });
        return;
      }
      done({ ok: true, text: extracted.text, structured: extracted.structured });
    });

    // 무거운 본문은 stdin 으로 — argv 길이 한계·쿼팅 회피.
    child.stdin?.on('error', () => {
      // EPIPE 등 — close 핸들러가 종료 처리.
    });
    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

// `--output-format json` 봉투에서 모델 텍스트(result) + 구조화 출력(structured_output)을 꺼낸다.
// is_error 면 null. result·structured_output 둘 다 없으면 파싱 실패(null).
function extractResult(stdout: string): { text: string; structured?: unknown } | null {
  try {
    const envelope = JSON.parse(stdout) as {
      result?: unknown;
      structured_output?: unknown;
      is_error?: unknown;
    };
    if (envelope.is_error === true) return null;
    const text = typeof envelope.result === 'string' ? envelope.result : '';
    const structured = envelope.structured_output;
    if (text === '' && structured === undefined) return null;
    return structured === undefined ? { text } : { text, structured };
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
