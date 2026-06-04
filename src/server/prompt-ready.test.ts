import { describe, expect, it } from 'vitest';
import { isPromptReady } from './prompt-ready';

describe('isPromptReady', () => {
  it('claude REPL 준비 힌트(`? for shortcuts`) 감지', () => {
    expect(isPromptReady('...\n? for shortcuts\n')).toBe(true);
    expect(isPromptReady('? FOR SHORTCUTS')).toBe(true); // 대소문자 무관
  });

  it('대체 신호(`for agents`) 도 감지', () => {
    expect(isPromptReady('… for agents …')).toBe(true);
  });

  it('준비 신호 없는 초기 배너/광고는 false', () => {
    expect(isPromptReady('Welcome to Claude Code\nLoading...')).toBe(false);
    expect(isPromptReady('')).toBe(false);
  });

  it('버퍼 어디에 있든(끝에 와도) 감지 — 등록 시점 1회 스캔에 쓰임', () => {
    const buffer = 'banner line 1\nbanner line 2\n╭─ tips ─╮\n? for shortcuts';
    expect(isPromptReady(buffer)).toBe(true);
  });
});
