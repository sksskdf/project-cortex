import { describe, expect, it } from 'vitest';
import {
  buildHeadlessArgs,
  extractResult,
  extractUsageFromStdout,
  formatExitReason,
  parseJsonFromText,
} from './claude-cli';
import type { ClaudeRunOptions } from './claude-cli';

describe('parseJsonFromText', () => {
  it('순수 JSON 파싱', () => {
    expect(parseJsonFromText('{"confidence":90,"flags":[]}')).toEqual({
      confidence: 90,
      flags: [],
    });
  });

  it('코드펜스(```json) 안쪽 파싱', () => {
    const t = '```json\n{"confidence":80,"flags":["migration"]}\n```';
    expect(parseJsonFromText(t)).toEqual({ confidence: 80, flags: ['migration'] });
  });

  it('펜스 앞뒤에 산문이 있어도 파싱', () => {
    const t = '분석 결과입니다:\n```json\n{"ok":true}\n```\n도움이 됐길 바랍니다.';
    expect(parseJsonFromText(t)).toEqual({ ok: true });
  });

  it('펜스 없이 산문 + JSON 객체가 섞여도 첫 객체 추출', () => {
    const t = '다음은 리뷰입니다. {"confidence":75,"flags":[],"summary":"ok"} 끝.';
    expect(parseJsonFromText(t)).toEqual({ confidence: 75, flags: [], summary: 'ok' });
  });

  it('문자열 안의 중괄호를 객체 경계로 오인하지 않음', () => {
    const t = 'before {"summary":"a } b","n":1} after';
    expect(parseJsonFromText(t)).toEqual({ summary: 'a } b', n: 1 });
  });

  it('JSON 객체가 전혀 없으면 throw', () => {
    expect(() => parseJsonFromText('JSON 없음')).toThrow();
  });

  // 회귀(리뷰 발견): 예전엔 `(?:json)?` 펜스 매칭이 `bash`/`ts` 등 다른 태그·태그 없는 펜스의
  // 본문까지 t 로 교체해, 모델이 예시 펜스를 먼저 출력하고 JSON 펜스를 나중에 출력하면
  // 응답을 통째로 버리고 throw 했다. 이제는 `json` 태그 펜스만 신뢰.
  it('비-JSON 펜스(```bash)가 먼저, ```json 이 나중에 와도 JSON 추출', () => {
    const t =
      '먼저 실행:\n```bash\nnpm test\n```\n결과 분석:\n```json\n{"confidence":85}\n```\n끝.';
    expect(parseJsonFromText(t)).toEqual({ confidence: 85 });
  });

  it('태그 없는 펜스 안의 JSON 도 extractFirstJsonObject 가 회수', () => {
    const t = '결과:\n```\n{"ok":true}\n```';
    expect(parseJsonFromText(t)).toEqual({ ok: true });
  });

  it('JSON 펜스 없이 비-JSON 펜스만 있으면 산문의 첫 객체 추출', () => {
    const t = '예시:\n```bash\nnpm test\n```\n실제 응답: {"x":1}';
    expect(parseJsonFromText(t)).toEqual({ x: 1 });
  });
});

describe('extractResult', () => {
  it('result 텍스트를 꺼낸다', () => {
    expect(extractResult(JSON.stringify({ result: 'hello' }))).toEqual({ text: 'hello' });
  });

  it('is_error 면 null', () => {
    expect(extractResult(JSON.stringify({ result: 'x', is_error: true }))).toBeNull();
  });

  it('result·structured_output 둘 다 없으면 null', () => {
    expect(extractResult(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it('R1 — structured_output 를 함께 꺼낸다', () => {
    const out = extractResult(JSON.stringify({ result: '', structured_output: { a: 1 } }));
    expect(out).toEqual({ text: '', structured: { a: 1 } });
  });

  it('R3 — total_cost_usd · usage 토큰을 꺼낸다', () => {
    const out = extractResult(
      JSON.stringify({
        result: 'ok',
        total_cost_usd: 0.0123,
        usage: { input_tokens: 1500, output_tokens: 300 },
      }),
    );
    expect(out).toEqual({
      text: 'ok',
      usage: { costUsd: 0.0123, inputTokens: 1500, outputTokens: 300 },
    });
  });

  it('R3 — 사용량 정보가 없으면 usage 키 자체를 안 붙임', () => {
    const out = extractResult(JSON.stringify({ result: 'ok' }));
    expect(out).toEqual({ text: 'ok' });
    expect(out && 'usage' in out).toBe(false);
  });

  it('깨진 JSON 은 null', () => {
    expect(extractResult('{ not json')).toBeNull();
  });

  // 회귀(사용자 보고 2026-06-05): headroom wrap 이 claude 실행 전 stdout 에 박스 배너를 출력해
  // "<배너>\n{...}" 형태가 되면 JSON.parse 가 첫 자에서 throw → '응답 파싱 실패'. 이제는
  // extractFirstJsonObject 폴백으로 안의 균형 잡힌 객체를 회수.
  it('stdout 앞에 잡음(headroom 배너 등)이 끼어도 안의 JSON 객체 회수', () => {
    const banner =
      '╔═══════════════╗\n║ HEADROOM WRAP ║\n╚═══════════════╝\nProxy ready on http://127.0.0.1:8787\n';
    const stdout = banner + JSON.stringify({ result: 'hello', total_cost_usd: 0.01 });
    expect(extractResult(stdout)).toEqual({
      text: 'hello',
      usage: { costUsd: 0.01, inputTokens: null, outputTokens: null },
    });
  });
});

describe('extractUsageFromStdout — is_error 무관 비용 관측 (리뷰 회귀)', () => {
  it('is_error=true 봉투에서도 비용·토큰 추출 (extractResult 는 null 이지만)', () => {
    const stdout = JSON.stringify({
      result: '',
      is_error: true,
      total_cost_usd: 0.0042,
      usage: { input_tokens: 900, output_tokens: 0 },
    });
    // extractResult 는 is_error 라 null (결과 파싱 실패) — 하지만 비용은 살아있어야.
    expect(extractResult(stdout)).toBeNull();
    expect(extractUsageFromStdout(stdout)).toEqual({
      costUsd: 0.0042,
      inputTokens: 900,
      outputTokens: 0,
    });
  });

  it('result·structured 둘 다 없어도(빈 응답) 비용 추출', () => {
    const stdout = JSON.stringify({ total_cost_usd: 0.001 });
    expect(extractResult(stdout)).toBeNull();
    expect(extractUsageFromStdout(stdout)).toEqual({
      costUsd: 0.001,
      inputTokens: null,
      outputTokens: null,
    });
  });

  it('사용량 정보 없으면 null', () => {
    expect(extractUsageFromStdout(JSON.stringify({ result: 'ok' }))).toBeNull();
  });

  it('깨진 JSON(프로세스 크래시 stdout)은 null — throw 안 함', () => {
    expect(extractUsageFromStdout('partial garbage not json')).toBeNull();
    expect(extractUsageFromStdout('')).toBeNull();
  });

  it('stdout 앞에 잡음(headroom 배너 등)이 끼어도 비용 관측은 계속됨', () => {
    const banner = '╔══╗\n║HEADROOM║\n╚══╝\n';
    const stdout =
      banner +
      JSON.stringify({
        result: 'ok',
        total_cost_usd: 0.0042,
        usage: { input_tokens: 900, output_tokens: 50 },
      });
    expect(extractUsageFromStdout(stdout)).toEqual({
      costUsd: 0.0042,
      inputTokens: 900,
      outputTokens: 50,
    });
  });
});

describe('buildHeadlessArgs — argv 빌더(R1/R2/R4/R5 + degrade + priority)', () => {
  const base: ClaudeRunOptions = { input: 'body', instruction: 'do it' };

  it('기본 — -p --output-format json + instruction (마지막)', () => {
    const a = buildHeadlessArgs(base, true, null);
    expect(a.slice(0, 3)).toEqual(['-p', '--output-format', 'json']);
    expect(a[a.length - 1]).toBe('do it');
  });

  it('--model + R5 --fallback-model', () => {
    const a = buildHeadlessArgs({ ...base, model: 'opus', fallbackModel: 'sonnet' }, true, null);
    expect(a).toContain('--model');
    expect(a[a.indexOf('--model') + 1]).toBe('opus');
    expect(a).toContain('--fallback-model');
    expect(a[a.indexOf('--fallback-model') + 1]).toBe('sonnet');
  });

  it('R1 --json-schema (직렬화 JSON)', () => {
    const schema = { type: 'object' };
    const a = buildHeadlessArgs({ ...base, jsonSchema: schema }, true, null);
    expect(a).toContain('--json-schema');
    expect(a[a.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
  });

  it('R2 --append-system-prompt-file (호출자가 쓴 경로)', () => {
    const a = buildHeadlessArgs(
      { ...base, appendSystemPrompt: 'irrelevant — 파일은 호출자가 씀' },
      true,
      '/tmp/cortex-sys-xyz.md',
    );
    expect(a).toContain('--append-system-prompt-file');
    expect(a[a.indexOf('--append-system-prompt-file') + 1]).toBe('/tmp/cortex-sys-xyz.md');
  });

  // R4 권한 정밀화 — 핵심 회귀.
  it('R4 --allowed-tools — 명시 시 dangerously-skip-permissions 안 씀(좁은 권한 우선)', () => {
    const a = buildHeadlessArgs(
      { ...base, allowedTools: ['Read', 'Edit', 'Bash'], dangerouslyAllowAllTools: true },
      true,
      null,
    );
    expect(a).toContain('--allowed-tools');
    expect(a[a.indexOf('--allowed-tools') + 1]).toBe('Read,Edit,Bash');
    expect(a).not.toContain('--dangerously-skip-permissions');
  });

  it('allowedTools 없고 dangerously=true → --dangerously-skip-permissions', () => {
    const a = buildHeadlessArgs({ ...base, dangerouslyAllowAllTools: true }, true, null);
    expect(a).toContain('--dangerously-skip-permissions');
    expect(a).not.toContain('--allowed-tools');
  });

  it('빈 allowedTools 배열도 그대로 전달(=어떤 도구도 허용 안 함)', () => {
    const a = buildHeadlessArgs({ ...base, allowedTools: [] }, true, null);
    expect(a).toContain('--allowed-tools');
    expect(a[a.indexOf('--allowed-tools') + 1]).toBe('');
  });

  // useEnhancements=false — degrade-retry 경로(미지원 CLI). allowedTools/json-schema/fallback/
  // append 모두 생략하되 dangerously 는 폴백 유지(기존 동작 보존).
  it('degrade(useEnhancements=false) — R1/R2/R4/R5 전부 생략, dangerously 만 유지', () => {
    const a = buildHeadlessArgs(
      {
        ...base,
        model: 'opus',
        fallbackModel: 'sonnet',
        jsonSchema: {},
        allowedTools: ['Read'],
        dangerouslyAllowAllTools: true,
      },
      false,
      '/tmp/x.md',
    );
    expect(a).toContain('--model'); // --model 은 enhancement 아님
    expect(a).not.toContain('--fallback-model');
    expect(a).not.toContain('--json-schema');
    expect(a).not.toContain('--allowed-tools');
    expect(a).not.toContain('--append-system-prompt-file');
    // dangerously 는 폴백으로 살아남음(없으면 자동화가 권한 프롬프트로 멈춤).
    expect(a).toContain('--dangerously-skip-permissions');
  });

  it('instruction 은 항상 argv 마지막', () => {
    const a = buildHeadlessArgs(
      {
        ...base,
        model: 'opus',
        fallbackModel: 'sonnet',
        jsonSchema: {},
        allowedTools: ['Read'],
        appendSystemPrompt: 'x',
      },
      true,
      '/tmp/sys.md',
    );
    expect(a[a.length - 1]).toBe('do it');
  });
});

describe('formatExitReason — 비정상 종료 진단(사용자 보고 회귀)', () => {
  it('stderr 우선', () => {
    const r = formatExitReason(1, 'oauth 실패', '', '/usr/bin/claude', ['-p']);
    expect(r).toBe('claude CLI 비정상 종료 (code 1): oauth 실패');
  });
  it('stderr 비어있으면 stdout tail', () => {
    const r = formatExitReason(1, '', 'fatal: something', '/usr/bin/claude', ['-p']);
    expect(r).toContain('fatal: something');
  });
  // 회귀: 사용자 보고 — code 1 + 빈 stderr/stdout 시 'code 1): ' 만 보였다.
  it('둘 다 비어있으면 spawn 파일·플래그 요약 노출 (진단 가능)', () => {
    const r = formatExitReason(1, '', '', 'C:\\claude.cmd', [
      '/c',
      'claude.cmd',
      '-p',
      '--output-format',
      'json',
      'analyze',
    ]);
    expect(r).toMatch(/code 1\)/);
    expect(r).toContain('empty stderr/stdout');
    expect(r).toContain('claude.cmd');
    expect(r).toContain('-p');
    expect(r).toContain('--output-format');
    // instruction(positional) 같은 비-플래그는 노출 안 함(노이즈 방지).
    expect(r).not.toContain('analyze');
  });
  it('stderr 300자 초과 시 끝 300자만 사용', () => {
    const long = 'x'.repeat(500) + 'TAIL';
    const r = formatExitReason(2, long, '', '/c', []);
    expect(r).toContain('TAIL');
    expect(r.length).toBeLessThan(600);
  });
  it('code=null(SIGTERM 등) 도 그대로 노출', () => {
    expect(formatExitReason(null, 'sig', '', '/c', [])).toContain('code null');
  });
});
