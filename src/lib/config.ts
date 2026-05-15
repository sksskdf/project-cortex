import type { CurrentUser } from '@/lib/types';

// 단일 사용자 모드 — Phase 7까지 DB에 사용자 테이블 없음.
// 본 객체는 ROADMAP의 "단일 사용자 가정"을 명시적으로 표현.
export const currentUser: CurrentUser = {
  name: '정현',
  role: '엔지니어링 리드',
  initials: 'JH',
};

export const favoriteProjects: ReadonlyArray<string> = ['cortex-web', 'payments-api'];
