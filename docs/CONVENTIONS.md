# Conventions — Project Cortex

> 코드를 짤 때 따르는 자잘한 룰. 헷갈릴 때만 들어와 보세요.

---

## 1. TypeScript

- `tsconfig.json`은 `"strict": true`.
- `any` 금지. 정 필요하면 `unknown` 후 좁히기.
- 도메인 객체 타입은 전부 `src/lib/types.ts`에. 컴포넌트 파일에 인터페이스를 새로 정의하지 않음.

```ts
// src/lib/types.ts
export type PRStatus = 'open' | 'review-needed' | 'auto-merged' | 'merged' | 'closed';
export type ConfidenceTier = 'high' | 'medium' | 'low' | 'critical'; // 90+/70+/50+/<50
```

## 2. React / Next.js

- **Server Component 디폴트.** 'use client'는 인터랙션이 정말 필요할 때만.
- 페이지 컴포넌트(`app/*/page.tsx`)는 데이터 fetch + JSX. 비즈니스 로직 금지.
- 폼은 Server Action으로:
  ```tsx
  // src/actions/merge.ts
  'use server';
  export async function mergePR(prId: number) { ... }
  ```
- 상태 관리 라이브러리 도입 금지 (Redux/Zustand/Jotai). URL 쿼리·서버 상태로 해결.

## 3. 파일·폴더 네이밍

- 컴포넌트 파일: `PascalCase.tsx` (예: `PRRow.tsx`)
- 비-컴포넌트 모듈: `kebab-case.ts` (예: `pre-review.ts`)
- 폴더는 항상 소문자. 라우트 폴더는 의미 단어(`inbox`, `pr`).

## 4. 임포트 순서

```ts
// 1. React/Next
import { Suspense } from 'react';

// 2. 외부 라이브러리
import { z } from 'zod';

// 3. 절대 경로 (자체 모듈)
import { listInbox } from '@/lib/queue';
import { PRRow } from '@/components/PRRow';

// 4. 상대 경로 (가까운 파일)
import { categoryFilter } from './filter';

// 5. 타입 onlys
import type { PR } from '@/lib/types';
```

`@/` 별칭은 `src/`를 가리킵니다. (`tsconfig.json`에 설정)

## 5. CSS / 디자인 토큰

- **인라인 hex 절대 금지.** `var(--ds-*)`만 사용.
- 새 스타일은 두 군데에 둘 수 있습니다:
  1. **글로벌**: `src/app/globals.css` — `<AppShell>` 같은 최상위 레이아웃에 필요한 것
  2. **컴포넌트 인접**: `src/components/PRRow.module.css` — 해당 컴포넌트 안에서만 쓰이는 것
- Tailwind, styled-components, emotion 금지. **순수 CSS + CSS Module + 디자인 시스템 변수.**
- BEM 네이밍 (`.pr-row__title`, `.pr-row--selected`).

## 6. 카피 / i18n

- 모든 사용자 노출 문자열은 `src/copy/ko.ts`의 키로:
  ```ts
  // src/copy/ko.ts
  export const ko = {
    inbox: {
      title: '인박스',
      empty: '검토할 PR이 없어요. 멋진 하루 보내세요.',
      sortByPriority: '우선순위',
    },
    pr: {
      mergeButton: '머지',
      requestChanges: '변경 요청',
    },
  } as const;
  ```
- 컴포넌트에서 사용:
  ```tsx
  import { ko as t } from '@/copy/ko';
  <h1>{t.inbox.title}</h1>
  ```
- 영어 카피 / 다국어 지원은 비-목표. 영어 키만 사용하고 값은 한국어.

## 7. Fixture · Seed 데이터

- DB로 표현 가능한 도메인 데이터는 `src/db/seed.ts`에 시드. 페이지는 `src/lib/*`로 받음.
- 외부 시스템이 채울 데이터(git diff, LLM 출력, 운영 메트릭 등)는 `src/fixtures/`에 둠. 각 파일 상단에 "어떤 Phase에서 자동 생성될 예정"인지 한 줄 주석.
- 컴포넌트 파일 안에 inline 데이터 금지.
- 데이터는 실제 타입(`@/lib/types`)을 만족해야 함:
  ```ts
  // src/fixtures/dashboard.ts
  import type { StatDelta } from '@/lib/types';
  export const statDeltas: { autoMerged: StatDelta } = { ... };
  ```

## 8. 에러 / 로깅

- 사용자에게 보이는 에러: 구체적으로 작성 (`이메일 형식을 확인해주세요.`). 일반론 금지.
- 개발자 로그: `console.error` 디폴트. 추후 Pino 도입 검토.
- 절대 `alert()`/`confirm()`/`prompt()` 사용 안 함. Toast 또는 Modal 컴포넌트.

## 9. 테스트

- 비즈니스 로직 (`src/lib/*`)만 테스트. UI 스냅샷 테스트 안 함.
- 한 파일 5–10개 케이스. 더 늘어나면 함수가 너무 커진 것.
- 도구: `vitest`.

```
src/lib/triage.ts
src/lib/triage.test.ts   ← 같은 폴더에 인접 배치
```

## 10. 커밋 / PR

- 한 PR = 한 변경. 다른 일은 다른 PR.
- 커밋 메시지: 영어 한 줄, 50자 이내. `feat: add cluster auto-merge`.
- PR 제목 한국어 OK. PR 본문은 한국어 + 변경 요약 3줄 이내.
- 거대한 PR을 만들 것 같으면 멈추고 사람에게 묻기.

## 11. 의존성 추가

새 npm 패키지를 추가할 때:
- 이미 있는 도구로 못 하는지 먼저 검토 (디자인 시스템·Drizzle·zod는 이미 있음).
- 추가 결정은 사람 승인 필요. PR 본문에 이유를 1–2줄로 명시.
- 런타임 의존성은 최대한 줄임. devDependency는 비교적 자유.

## 12. 환경 변수

- `.env.local`은 절대 커밋하지 않음.
- 키 이름은 `SCREAMING_SNAKE_CASE`. 접두사는 도메인 (`GITHUB_*`, `ANTHROPIC_*`).
- Next.js의 `NEXT_PUBLIC_*` 접두사가 붙은 변수만 클라이언트로 노출됨. 비밀은 절대 이 접두사 금지.

## 13. Git

- 메인 브랜치: `master`. 직접 푸시 금지.
- 작업 브랜치: `feat/<짧은-이름>`, `fix/<짧은-이름>`, `chore/<짧은-이름>`, `docs/<짧은-이름>`, `refactor/<짧은-이름>`.
- 모든 변경은 master로 PR. 머지는 **squash** (커밋 1개로 압축).
- `--force-push` 금지 (자기 작업 브랜치 정리는 예외).

## 14. 시간·날짜

- 모든 시간은 서버에서 UTC, UI에서 KST(`Asia/Seoul`) 표시.
- 표시 포맷:
  - 1분 이내: "방금 전"
  - 1시간 이내: "N분 전"
  - 24시간 이내: "N시간 전"
  - 어제: "어제"
  - 그 외: "5월 12일" (월·일 한국어)

이 룰은 `src/lib/format-time.ts` 한 곳에서 처리. 인라인 분기 금지.

## 15. 숫자 / 통계

- 숫자는 Spoqa 폰트로:
  ```tsx
  <span style={{ fontFamily: 'var(--ds-typography-font-family-number)' }}>87</span>
  ```
- 천 단위 콤마: `n.toLocaleString('ko-KR')`. 인라인 분기 금지 — `formatNumber` 헬퍼.
- 퍼센트는 단위(%)를 작게:
  ```tsx
  <span>87<small>%</small></span>
  ```
