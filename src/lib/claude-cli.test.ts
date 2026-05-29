import { describe, expect, it } from 'vitest';
import { extractResult, parseJsonFromText } from './claude-cli';

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
});
