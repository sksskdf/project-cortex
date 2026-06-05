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
import { resolveHeadroom, wrapClaudeSpawn } from './headroom';
import { logger } from './logger';
import { recordLlmUsage } from './llm-cost';
import { getSettings } from './settings';

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
  // R4 (Phase 13.5) — 권한 정밀화. allowedTools 가 주어지면 `--dangerously-skip-permissions` 대신
  // `--allowed-tools <list>` 로 명시 허용 목록만 사용. dangerouslyAllowAllTools 와 동시 설정 시
  // allowedTools 가 우선(좁은 권한). 예: ['Edit','Bash(npm test)','Read'] — 자동 수정에 필요한
  // 도구만. 미지원 CLI 는 무시되거나 에러로 실패 → spawnClaude 의 degrade-retry 가 플래그 없이
  // 재시도(무회귀). 빈 배열은 "어떤 도구도 허용 안 함"으로 해석돼 의미 있을 수 있으므로 그대로 전달.
  allowedTools?: ReadonlyArray<string>;
  // R1 (Phase 13.6) — JSON Schema 강제. 주면 `--json-schema` 로 전달하고, 응답 봉투의
  // `structured_output`(스키마 검증된 객체)을 result.structured 로 돌려준다. 모델이 산문/펜스를
  // 섞어도 파싱 취약점(parseJsonFromText)을 우회. 미지원 CLI 대비: 도구 미사용(분석) 호출은
  // 비정상 종료 시 이 플래그 없이 1회 자동 재시도해 기존 동작으로 degrade.
  jsonSchema?: object;
  // R2 (Phase 13.6) — 기본 시스템 프롬프트에 덧붙일 텍스트(예: Cortex 방법론). 멀티라인이라
  // argv 쿼팅을 피하려 임시 파일에 쓰고 `--append-system-prompt-file` 로 전달. 슬래시 스킬은
  // `-p` 헤드리스에서 안 먹으므로, 코딩 자동화에 방법론을 일관 주입하는 경로.
  appendSystemPrompt?: string;
  // R5 (Phase 13.6) — 기본 모델이 과부하/은퇴(retired)면 자동 폴백할 모델. `--fallback-model`
  // 은 print 모드에서만 발효(문서) — Cortex 헤드리스에 적합. 미지원 CLI 대비: 분석(도구 미사용)
  // 호출은 비정상 종료 시 이 플래그 없이 1회 자동 재시도해 degrade.
  fallbackModel?: string;
};

// R3 (Phase 13.6) — `--output-format json` 봉투의 비용·토큰 사용량. 2026-06-15 부터 구독 플랜
// `claude -p` 가 별도 Agent SDK 크레딧을 소모하므로 호출별 관측이 중요. 봉투에 없으면 null.
export type ClaudeUsage = {
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type ClaudeRunResult =
  | { ok: true; text: string; structured?: unknown; usage?: ClaudeUsage }
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
  const usedEnhancements = Boolean(
    opts.jsonSchema || opts.appendSystemPrompt || opts.fallbackModel || opts.allowedTools,
  );
  if (usedEnhancements && !opts.dangerouslyAllowAllTools) {
    const retry = await runOnce(claude.path, opts, false);
    if (retry.ok) return strip(retry);
  }
  return strip(first);
}

type InternalResult =
  | { ok: true; text: string; structured?: unknown; usage?: ClaudeUsage; nonZeroExit?: false }
  | { ok: false; reason: string; nonZeroExit: boolean };

function strip(r: InternalResult): ClaudeRunResult {
  if (r.ok) return { ok: true, text: r.text, structured: r.structured, usage: r.usage };
  return { ok: false, reason: r.reason };
}

// 1회 spawn. useEnhancements=false 면 --json-schema / --append-system-prompt-file 를 생략.
// 비정상 종료 시 진단 메시지 빌더 — stderr 가 비어도 진단 가능하도록 stdout 의 tail 과 spawn 명령
// 요약을 폴백으로 노출. 일부 환경(특히 Windows)에선 claude CLI 가 에러를 stdout 으로 보내거나
// 둘 다 침묵하기도 한다(사용자 보고 2026-06-05: code 1 + 빈 stderr). 무회귀: 성공 경로 영향 0,
// 실패 메시지의 진단성만 향상. 순수 함수 — 단위 테스트.
export function formatExitReason(
  code: number | null,
  stderr: string,
  stdout: string,
  file: string,
  args: ReadonlyArray<string>,
): string {
  const errTail = stderr.slice(-300).trim();
  const outTail = stdout.slice(-200).trim();
  const flagSummary = args
    .filter((a) => a.startsWith('-'))
    .slice(0, 12)
    .join(' ');
  const diagnostic = errTail || outTail || `(empty stderr/stdout; ${file} ${flagSummary})`;
  return `claude CLI 비정상 종료 (code ${code}): ${diagnostic}`;
}

// 헤드리스 argv 빌더 — 순수 함수(파일 I/O 없음). sysPromptFile 은 호출자가 미리 써둔 경로
// (또는 null). useEnhancements=false 면 R1/R2/R4/R5 플래그를 모두 생략(미지원 CLI degrade).
// instruction(positional)은 항상 마지막. 단위 테스트로 모든 분기 검증.
export function buildHeadlessArgs(
  opts: ClaudeRunOptions,
  useEnhancements: boolean,
  sysPromptFile: string | null,
): string[] {
  const cliArgs = ['-p', '--output-format', 'json'];
  // 사용자 환경의 MCP 서버(Serena 등) 비활성화 — Cortex 의 헤드리스 호출은 자체 allowedTools 만
  // 쓰고 짧은 단발성이라 매 분석마다 사용자 MCP 가 spawn 되면 (a) 시작 지연·자원 낭비, (b) stdout
  // 핸드셰이크 잡음(사용자 보고 회귀), (c) 의도 외 도구 노출. `--strict-mcp-config` + 빈 `{}` 로
  // 사용자 `.mcp.json`/글로벌 설정을 무시. interactive PTY 세션(드로어)은 이 빌더 안 거치므로 영향 X.
  // useEnhancements=false(미지원 CLI degrade) 인 환경에선 flag 도 없을 수 있어 생략(무회귀).
  if (useEnhancements) {
    cliArgs.push('--strict-mcp-config', '--mcp-config', '{}');
  }
  if (opts.model) cliArgs.push('--model', opts.model);
  if (useEnhancements && opts.fallbackModel) {
    cliArgs.push('--fallback-model', opts.fallbackModel);
  }
  // 권한 모델 — 좁은 → 넓은 순:
  //   (1) allowedTools 명시  → `--allowed-tools <list>` (R4: 최소 권한, 추천)
  //   (2) dangerouslyAllowAllTools → `--dangerously-skip-permissions` (전부 허용)
  // useEnhancements=false 면 allowedTools 생략 → dangerously 만 폴백 유지(미지원 CLI degrade).
  if (useEnhancements && opts.allowedTools) {
    cliArgs.push('--allowed-tools', opts.allowedTools.join(','));
  } else if (opts.dangerouslyAllowAllTools) {
    cliArgs.push('--dangerously-skip-permissions');
  }
  if (useEnhancements && opts.jsonSchema) {
    cliArgs.push('--json-schema', JSON.stringify(opts.jsonSchema));
  }
  if (useEnhancements && sysPromptFile) {
    cliArgs.push('--append-system-prompt-file', sysPromptFile);
  }
  cliArgs.push(opts.instruction);
  return cliArgs;
}

function runOnce(
  claudePath: string,
  opts: ClaudeRunOptions,
  useEnhancements: boolean,
): Promise<InternalResult> {
  // 임시 파일(시스템 프롬프트) — 빌더 호출 전에 쓰고 finally 에서 정리.
  let sysPromptFile: string | null = null;
  if (useEnhancements && opts.appendSystemPrompt) {
    sysPromptFile = join(tmpdir(), `cortex-sysprompt-${randomBytes(8).toString('hex')}.md`);
    try {
      writeFileSync(sysPromptFile, opts.appendSystemPrompt, 'utf8');
    } catch {
      // 임시 파일 쓰기 실패 — 방법론 주입은 best-effort, 플래그 없이 진행.
      sysPromptFile = null;
    }
  }
  const cliArgs = buildHeadlessArgs(opts, useEnhancements, sysPromptFile);

  // Headroom wrap 적용(opt-in 토글) — ON + binary 감지면 `headroom wrap claude <원본 args...>` 로
  // 감싸 토큰 절감(README "zero code changes" — stdin/stdout pass-through). OFF/미감지면 원본 그대로.
  // 토글 ON 인데 binary 미감지면 warning 1회.
  const settings = getSettings();
  const headroomPath = settings.headroomEnabled ? resolveHeadroom() : null;
  if (settings.headroomEnabled && headroomPath === null) {
    logger.warn(
      { source: 'claude-cli' },
      'headroomEnabled=ON 인데 PATH 에 headroom 이 없음 — 원본 claude 로 fallback',
    );
  }
  const wrapped = wrapClaudeSpawn({
    claudePath,
    claudeArgs: cliArgs,
    enabled: settings.headroomEnabled,
    headroomPath,
  });

  // Windows 전역 npm bin 은 claude.cmd (배치) — Node 가 .cmd 를 직접 spawn 못 하므로
  // cmd.exe /c 로 감싼다 (pty.ts 와 동일 전략). POSIX 는 resolve 된 경로 직접 실행.
  // headroom 도 .cmd/.bat 가능(npm 글로벌) — 동일 처리.
  const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(wrapped.command);
  const file = isWinScript ? (process.env.ComSpec ?? 'cmd.exe') : wrapped.command;
  const args = isWinScript ? ['/c', wrapped.command, ...wrapped.args] : wrapped.args;

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
      // R3 — 비용·토큰 관측을 **결과 파싱과 분리**해 가장 먼저 기록. 구독 과금(2026-06-15+)은
      // is_error 응답·overload 에도 발생하는데, 예전엔 extractResult 가 is_error/빈 result 에
      // null 을 반환하기 전이라 그 비용이 통째로 누락돼 /reports 가 과소 집계됐다(리뷰 발견).
      // 이제는 봉투에 사용량이 있으면 성공/실패·is_error 무관하게 기록. best-effort.
      recordUsageFromStdout(stdout, opts.model ?? null);

      if (code !== 0) {
        done({
          ok: false,
          reason: formatExitReason(code, stderr, stdout, file, args),
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
      done({
        ok: true,
        text: extracted.text,
        structured: extracted.structured,
        usage: extracted.usage,
      });
    });

    // 무거운 본문은 stdin 으로 — argv 길이 한계·쿼팅 회피.
    child.stdin?.on('error', () => {
      // EPIPE 등 — close 핸들러가 종료 처리.
    });
    child.stdin?.write(opts.input);
    child.stdin?.end();
  });
}

// `--output-format json` 봉투에서 모델 텍스트(result) + 구조화 출력(structured_output) +
// 비용·토큰 사용량을 꺼낸다. is_error 면 null. result·structured_output 둘 다 없으면 파싱 실패(null).
// 테스트 위해 export (실 spawn 없이 봉투 파싱만 검증).
// 회귀(사용자 보고): headroom wrap 이 claude 실행 전 stdout 에 ANSI 박스 배너를 출력해 봉투가
// "<배너>\n{...}" 형태가 됐다 → JSON.parse 가 첫 자에서 throw → "응답 파싱 실패".
// 후속 회귀(사용자 보고 2026-06-05 #281 머지 후): claude 가 시작될 때 사용자 환경의 MCP 서버
// (Serena 등)가 JSON-RPC 핸드셰이크 `{"jsonrpc":"2.0","result":{...},"id":1}` 를 stdout 으로
// 먼저 찍으면 첫 균형 잡힌 객체가 그 핸드셰이크가 되어 claude 의 진짜 봉투(`result:"..."` 가
// 문자열인 것)를 놓쳤다. → stdout 안의 **모든** 균형 잡힌 객체를 후보로 두고 claude envelope
// 시그너처(result:string · structured_output · is_error · total_cost_usd 중 하나라도)에 맞는
// 것만 채택한다. (MCP 의 result 는 객체라 typeof === 'string' 체크에서 자연히 걸러진다.)

// stdout 안에서 균형 잡힌 모든 top-level {...} 객체를 차례로 산출(문자열 리터럴 안의 중괄호 무시).
function* findAllJsonObjects(s: string): Generator<string> {
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{', i);
    if (start < 0) return;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = start; j < s.length; j += 1) {
      const c = s[j];
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
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) return; // 미균형 — 더 찾을 객체 없음.
    yield s.slice(start, end);
    i = end;
  }
}

// claude `--output-format json` 봉투의 식별 시그너처. 다른 도구(MCP JSON-RPC 등)의 메시지와
// 구분하기 위해 사용. 하나라도 있으면 claude 봉투로 간주.
function isClaudeEnvelope(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== 'object') return false;
  const e = parsed as Record<string, unknown>;
  return (
    typeof e.result === 'string' || // 모델 텍스트(string — JSON-RPC 의 object result 와 구분).
    e.structured_output !== undefined || // R1 구조화 출력.
    e.is_error === true || // 에러 봉투.
    typeof e.total_cost_usd === 'number' // 비용 정보 있는 봉투(보조 시그너처).
  );
}

function parseEnvelope(stdout: string): unknown | null {
  // 1차: 전체 JSON.parse — 잡음 없는 정상 케이스(가장 흔함).
  try {
    const parsed = JSON.parse(stdout);
    if (isClaudeEnvelope(parsed)) return parsed;
  } catch {
    /* fall through */
  }
  // 2차: 모든 후보 객체를 시도, claude shape 인 첫 것만 채택. (배너만 끼는 케이스도 자연히 처리.)
  for (const candidate of findAllJsonObjects(stdout)) {
    try {
      const parsed = JSON.parse(candidate);
      if (isClaudeEnvelope(parsed)) return parsed;
    } catch {
      /* skip unparseable candidate */
    }
  }
  return null;
}

export function extractResult(
  stdout: string,
): { text: string; structured?: unknown; usage?: ClaudeUsage } | null {
  const parsed = parseEnvelope(stdout);
  if (parsed === null || typeof parsed !== 'object') return null;
  const envelope = parsed as {
    result?: unknown;
    structured_output?: unknown;
    is_error?: unknown;
    total_cost_usd?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  if (envelope.is_error === true) return null;
  const text = typeof envelope.result === 'string' ? envelope.result : '';
  const structured = envelope.structured_output;
  if (text === '' && structured === undefined) return null;
  const usage = extractUsage(envelope);
  return {
    text,
    ...(structured === undefined ? {} : { structured }),
    ...(usage === null ? {} : { usage }),
  };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// 봉투에서 비용·토큰을 뽑는다. 셋 다 없으면 null (사용량 정보 없는 응답).
function extractUsage(envelope: {
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}): ClaudeUsage | null {
  const costUsd = num(envelope.total_cost_usd);
  const inputTokens = num(envelope.usage?.input_tokens);
  const outputTokens = num(envelope.usage?.output_tokens);
  if (costUsd === null && inputTokens === null && outputTokens === null) return null;
  return { costUsd, inputTokens, outputTokens };
}

// stdout 봉투에서 비용·토큰만 추출 — is_error·result 유무와 무관(extractResult 와 달리 항상 시도).
// 구독 과금은 error 응답에도 발생하므로 성공/실패 가리지 않고 관측해야 /reports 비용이 정확.
// stdout 이 JSON 봉투가 아니면(프로세스 크래시 등) null. 배너·MCP 핸드셰이크가 앞에 끼어도
// 사용량 필드(total_cost_usd/usage)가 있는 객체를 찾아 비용 관측이 끊기지 않게 한다.
export function extractUsageFromStdout(stdout: string): ClaudeUsage | null {
  // 1차: 전체 파싱.
  try {
    const parsed = JSON.parse(stdout);
    if (parsed && typeof parsed === 'object') {
      const u = extractUsage(parsed as Record<string, unknown>);
      if (u !== null) return u;
    }
  } catch {
    /* fall through */
  }
  // 2차: 후보 객체 중 사용량 필드 있는 첫 것.
  for (const candidate of findAllJsonObjects(stdout)) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        const u = extractUsage(parsed as Record<string, unknown>);
        if (u !== null) return u;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

// 봉투의 사용량을 로깅 + DB 기록 (best-effort — 관측 실패가 호출 흐름을 막지 않게).
function recordUsageFromStdout(stdout: string, model: string | null): void {
  const usage = extractUsageFromStdout(stdout);
  if (!usage) return;
  logger.info({ source: 'claude-cli', model, ...usage }, 'headless 호출 사용량');
  try {
    recordLlmUsage(model, usage);
  } catch (err) {
    logger.error({ source: 'claude-cli', err }, 'llm usage 기록 실패');
  }
}

// 모델 응답에서 JSON 을 꺼낸다. 코드펜스(```json ... ```)를 벗기고, 산문이 섞여 있어도
// 첫 번째 균형 잡힌 {...} 객체를 추출해 파싱 (CLI 모델이 설명을 덧붙이는 경우 대비).
export function parseJsonFromText(text: string): unknown {
  let t = text.trim();
  // 펜스 처리: `json` 태그 펜스만 신뢰. 예전엔 `(?:json)?` 로 태그 없는/다른 태그(```bash, ```ts
  // 예시 등) 펜스의 본문도 t 로 교체해, 그 안에 JSON 이 없으면 throw 했다(리뷰 발견 — 모델이
  // shell 예시 펜스를 먼저, JSON 펜스를 나중에 출력하면 본문 응답을 통째로 버림). 이제는 json 태그
  // 펜스를 찾으면 그 안쪽만 사용하고, 없으면 t 를 그대로 둬 extractFirstJsonObject 가 전체 텍스트
  // (태그 없는 펜스 본문 포함)에서 첫 균형 객체를 찾도록 한다.
  const jsonFence = t.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonFence) t = jsonFence[1].trim();
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
