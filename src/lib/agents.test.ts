import { afterEach, describe, expect, it } from 'vitest';
import {
  getClaudeCliVersion,
  isClaudeAvailable,
  parseClaudeVersion,
  setVersionExec,
} from './agents';

afterEach(() => {
  setVersionExec(null);
});

describe('parseClaudeVersion — 순수 추출 (claude 유무 무관)', () => {
  it('첫 공백 토큰을 버전으로', () => {
    expect(parseClaudeVersion('1.2.3 (Claude Code)\n')).toBe('1.2.3');
    expect(parseClaudeVersion('  2.0.0-beta\n')).toBe('2.0.0-beta');
    expect(parseClaudeVersion('1.0.0')).toBe('1.0.0');
  });

  it('빈/공백 출력이면 null', () => {
    expect(parseClaudeVersion('')).toBeNull();
    expect(parseClaudeVersion('   \n\t')).toBeNull();
  });
});

describe('getClaudeCliVersion — Phase 13.6 CLI 버전 추적', () => {
  it('claude 미설치면 null (읽기 전용, 안전)', async () => {
    if (isClaudeAvailable()) return; // claude 있는 환경이면 이 케이스는 스킵.
    expect(await getClaudeCliVersion()).toBeNull();
  });

  it('claude 있으면 주입 exec 의 출력을 파싱 / 실패 시 null', async () => {
    if (!isClaudeAvailable()) return; // resolveClaude null 이면 주입 runner 미호출.
    setVersionExec(async () => '1.2.3 (Claude Code)\n');
    expect(await getClaudeCliVersion()).toBe('1.2.3');
    setVersionExec(async () => {
      throw new Error('spawn failed');
    });
    expect(await getClaudeCliVersion()).toBeNull();
  });
});
