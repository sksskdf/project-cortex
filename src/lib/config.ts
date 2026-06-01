import type { CurrentUser } from '@/lib/types';

// 단일 사용자 모드 — DB에 사용자 테이블 없음. 본 객체는 "단일 사용자 가정"을 표현.
// Phase 19(인증) 첫 안전 단계 — 하드코딩 대신 env 로 설정 가능(인증 도입 전까지의 정체성 소스).
// env 미설정이면 기존 기본값 그대로(무회귀). 진짜 인증 주체 연동은 인증 게이트 도입 시 후속.
export function resolveCurrentUser(
  env: Record<string, string | undefined> = process.env,
): CurrentUser {
  return {
    name: env.CORTEX_USER_NAME?.trim() || '현우',
    role: env.CORTEX_USER_ROLE?.trim() || '엔지니어링 리드',
    initials: env.CORTEX_USER_INITIALS?.trim() || 'HW',
    githubLogin: env.CORTEX_USER_GITHUB_LOGIN?.trim() || 'sksskdfg123',
  };
}

export const currentUser: CurrentUser = resolveCurrentUser();
