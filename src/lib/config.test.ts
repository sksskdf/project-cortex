import { describe, expect, it } from 'vitest';
import { resolveCurrentUser } from './config';

describe('resolveCurrentUser — Phase 19 첫 단계 (env 설정 가능, 무회귀)', () => {
  it('env 미설정이면 기존 기본값 (무회귀)', () => {
    const u = resolveCurrentUser({});
    expect(u).toEqual({
      name: '현우',
      role: '엔지니어링 리드',
      initials: 'HW',
      githubLogin: 'sksskdfg123',
    });
  });

  it('env 로 각 필드 오버라이드', () => {
    const u = resolveCurrentUser({
      CORTEX_USER_NAME: 'Alice',
      CORTEX_USER_ROLE: 'PM',
      CORTEX_USER_INITIALS: 'AL',
      CORTEX_USER_GITHUB_LOGIN: 'alice',
    });
    expect(u).toEqual({ name: 'Alice', role: 'PM', initials: 'AL', githubLogin: 'alice' });
  });

  it('빈/공백 env 는 기본값으로 폴백', () => {
    const u = resolveCurrentUser({ CORTEX_USER_NAME: '   ', CORTEX_USER_GITHUB_LOGIN: '' });
    expect(u.name).toBe('현우');
    expect(u.githubLogin).toBe('sksskdfg123');
  });
});
