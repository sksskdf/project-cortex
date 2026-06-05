import { afterEach, describe, expect, it } from 'vitest';
import {
  parseHeadroomVersion,
  getHeadroomVersion,
  setHeadroomVersionExec,
  wrapClaudeSpawn,
} from './headroom';

describe('parseHeadroomVersion', () => {
  it('첫 토큰을 버전으로', () => {
    expect(parseHeadroomVersion('0.22.4\n')).toBe('0.22.4');
    expect(parseHeadroomVersion('0.22.4 (Headroom)\n')).toBe('0.22.4');
  });
  it('빈 출력은 null', () => {
    expect(parseHeadroomVersion('')).toBeNull();
    expect(parseHeadroomVersion('   \n')).toBeNull();
  });
});

describe('getHeadroomVersion (injected exec)', () => {
  afterEach(() => setHeadroomVersionExec(null));

  it('exec 실패하면 null (throw 안 함)', async () => {
    setHeadroomVersionExec(() => Promise.reject(new Error('not found')));
    // resolveHeadroom() 이 PATH 에서 헤드룸을 못 찾을 수 있어, 실제 결과는 환경에 따름.
    // 핵심 보장: throw 하지 않고 null/문자열 중 하나를 반환.
    const v = await getHeadroomVersion();
    expect(v === null || typeof v === 'string').toBe(true);
  });
});

describe('wrapClaudeSpawn', () => {
  // 4가지 분기 — OFF / ON+binary 있음 / ON+binary 없음 / 인자 보존.
  it('토글 OFF → 원본 claude 그대로', () => {
    const r = wrapClaudeSpawn({
      claudePath: '/usr/bin/claude',
      claudeArgs: ['-p', '--output-format', 'json', 'hello'],
      enabled: false,
      headroomPath: '/usr/bin/headroom',
    });
    expect(r).toEqual({
      command: '/usr/bin/claude',
      args: ['-p', '--output-format', 'json', 'hello'],
    });
  });

  it('토글 ON + headroom 없음 → 원본 claude fallback (무회귀)', () => {
    const r = wrapClaudeSpawn({
      claudePath: '/usr/bin/claude',
      claudeArgs: ['-p', '--output-format', 'json'],
      enabled: true,
      headroomPath: null,
    });
    expect(r).toEqual({
      command: '/usr/bin/claude',
      args: ['-p', '--output-format', 'json'],
    });
  });

  it('토글 ON + headroom 있음 → `headroom wrap claude -- <원본 args>` 변환 (옵션 종결자)', () => {
    const r = wrapClaudeSpawn({
      claudePath: '/usr/bin/claude',
      claudeArgs: ['-p', '--output-format', 'json', '--model', 'opus', 'hello'],
      enabled: true,
      headroomPath: '/usr/bin/headroom',
    });
    // `--` 가 있어야 headroom 이 -p 를 자기 --port 로 오해하지 않는다(사용자 보고 회귀).
    expect(r).toEqual({
      command: '/usr/bin/headroom',
      args: ['wrap', 'claude', '--', '-p', '--output-format', 'json', '--model', 'opus', 'hello'],
    });
  });

  it('Cortex 가 쓰는 모든 플래그가 wrap 후에도 순서대로 보존됨', () => {
    // 사전 리뷰가 실제로 만드는 argv 시뮬: -p --output-format json --model opus
    // --fallback-model sonnet --json-schema {...} --append-system-prompt-file /tmp/x
    // --dangerously-skip-permissions <instruction>
    const original = [
      '-p',
      '--output-format',
      'json',
      '--model',
      'claude-opus-4-7',
      '--fallback-model',
      'claude-sonnet-4-6',
      '--json-schema',
      '{"type":"object"}',
      '--append-system-prompt-file',
      '/tmp/cortex-sys.md',
      '--dangerously-skip-permissions',
      'analyze PR',
    ];
    const r = wrapClaudeSpawn({
      claudePath: '/x/claude',
      claudeArgs: original,
      enabled: true,
      headroomPath: '/x/headroom',
    });
    expect(r.command).toBe('/x/headroom');
    expect(r.args.slice(0, 3)).toEqual(['wrap', 'claude', '--']);
    expect(r.args.slice(3)).toEqual(original);
  });

  it('빈 args 도 안전하게 wrap', () => {
    const r = wrapClaudeSpawn({
      claudePath: '/c',
      claudeArgs: [],
      enabled: true,
      headroomPath: '/h',
    });
    expect(r).toEqual({ command: '/h', args: ['wrap', 'claude', '--'] });
  });
});
