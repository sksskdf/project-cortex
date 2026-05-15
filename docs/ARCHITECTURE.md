# Architecture — Project Cortex

> 모노리식 Node.js. 백·프런트 티어 없음. 한 프로세스가 SSR과 API를 다 합니다.

## 한 줄 요약

**Next.js (App Router) + TypeScript + SQLite(Drizzle) + Urock CSS 그대로.**

이 조합을 고른 이유:
- **티어 분리 없음** — Next.js는 한 프로세스에서 페이지 렌더와 API를 함께 합니다. 별도 백엔드 서버를 운영하지 않음.
- **File-based routing** — 화면 추가는 파일 추가로 끝. 라우터 설정 코드 없음.
- **Server Actions** — 폼 전송·머지 같은 액션을 별도 API route 만들지 않고 함수 호출처럼 씁니다.
- **SQLite** — 단일 파일 DB. 마이그레이션도 단순. Drizzle은 코드 자동완성이 가장 잘 됩니다.
- **Tailwind 안 씀** — Urock 디자인 시스템이 이미 CSS Variable로 토큰을 노출합니다. 빌드 도구를 더 끼우지 않습니다.

## 디렉토리 구조

```
project-cortex/
├── README.md
├── AGENTS.md
├── docs/
│   ├── ARCHITECTURE.md          ← 이 파일
│   ├── DESIGN.md
│   └── CONVENTIONS.md
├── prototype/                    ← 정적 HTML 프로토타입 (디자인 참고용, 코드 베이스 아님)
│   └── ...
├── package.json
├── tsconfig.json
├── next.config.mjs
├── drizzle.config.ts
├── public/
│   └── design-system/            ← prototype/design-system/ 그대로 옮김
│       ├── colors_and_type.css
│       ├── lib/lib.css
│       └── fonts/
└── src/
    ├── app/                      ← Next.js App Router (라우트 = 폴더)
    │   ├── layout.tsx            ← AppShell (Sidebar 공유 — 한 번만 정의)
    │   ├── globals.css           ← /public/design-system/* import
    │   ├── page.tsx              ← / → Dashboard
    │   ├── inbox/page.tsx        ← /inbox
    │   ├── pr/[id]/page.tsx      ← /pr/1142
    │   ├── cluster/[id]/page.tsx ← /cluster/i18n-labels
    │   ├── projects/page.tsx
    │   ├── agents/page.tsx
    │   ├── settings/page.tsx
    │   └── api/                  ← API routes (Webhook 등 외부 호출만)
    │       └── webhooks/
    │           ├── github/route.ts
    │           └── agent/route.ts
    ├── components/               ← 공유 UI 컴포넌트
    │   ├── AppShell.tsx          ← 사이드바 + 메인 영역 grid
    │   ├── Sidebar.tsx           ← 한 곳에만 정의
    │   ├── Gauge.tsx             ← 신뢰 점수 원형 게이지
    │   ├── AuthorChip.tsx        ← 에이전트/사람 라벨
    │   ├── PRRow.tsx             ← 인박스 + 대시보드 공통
    │   ├── DiffHunk.tsx          ← PR 화면 hunk 단위
    │   ├── ConfidenceTag.tsx
    │   └── ...
    ├── lib/                      ← 비즈니스 로직 (UI 없음)
    │   ├── types.ts              ← 도메인 타입 (Issue, PR, AgentRun, ...)
    │   ├── pre-review.ts         ← Anthropic API 호출 + 결과 파싱
    │   ├── triage.ts             ← 자동 머지 / 사람 검토 / 클러스터 결정 로직
    │   ├── clustering.ts         ← PR 유사도 계산 + 묶기
    │   ├── github.ts             ← GitHub API 어댑터
    │   └── confidence.ts         ← 점수 색·라벨 매핑 한 곳
    ├── db/
    │   ├── schema.ts             ← Drizzle 스키마
    │   ├── client.ts             ← 단일 DB 핸들
    │   └── migrations/
    ├── actions/                  ← Server Actions (UI ↔ lib 연결)
    │   ├── merge.ts              ← `mergePR(id)`
    │   ├── triage.ts             ← `markForReview(id)` 등
    │   └── cluster.ts
    ├── copy/
    │   └── ko.ts                 ← 모든 한국어 카피의 단일 출처
    └── mocks/                    ← 디자인 데모용 데이터 (점진적으로 실 데이터로 대체)
        ├── inbox.ts
        ├── pr.ts
        └── cluster.ts
```

## 모듈 경계 (지키면 토큰 절감)

- **`src/app/*`은 얇게.** 페이지 컴포넌트는 데이터 fetch + JSX만. 비즈니스 로직 금지.
- **`src/components/*`는 UI만.** DB·외부 API 직접 호출 금지. props로 받음.
- **`src/lib/*`은 UI 없음.** React/Next.js import 금지.
- **`src/actions/*`은 UI와 lib를 잇는 얇은 어댑터.** `'use server'` 함수.
- **`src/db/*`은 lib만 import.** UI에서 db를 직접 import하지 않음.

이 경계가 어긋나기 시작하면 작업당 컨텍스트가 부풀어 오릅니다.

## 데이터 흐름 (대표 시나리오 한 줄씩)

| 시나리오 | 흐름 |
|---|---|
| 새 PR 도착 (webhook) | `api/webhooks/github` → `lib/pre-review` → `lib/triage` → DB 저장 (자동 머지면 `lib/github.merge`) |
| 사용자가 인박스 열기 | `app/inbox/page.tsx` (Server Component) → `lib/queue.list()` → JSX |
| 사용자가 PR 머지 | `<MergeButton>` → `actions/merge.ts` (`'use server'`) → `lib/github.merge` → revalidate |
| 클러스터 자동 묶음 (cron/배치) | scheduled job → `lib/clustering` → DB 업데이트 |

## 외부 통합

- **GitHub** — Webhooks + REST API. 어댑터 한 곳 `lib/github.ts`.
- **AI 사전 리뷰** — Anthropic API. `lib/pre-review.ts`. 결과는 DB에 캐시 (같은 commit SHA는 다시 호출 안 함).
- **외부 에이전트 (Devin/Codex 등)** — Cortex는 에이전트에 이슈를 위임하지 않고, **에이전트가 만든 PR을 받아 처리**합니다. 즉 통합 지점은 "에이전트가 PR을 GitHub에 푸시 → 우리가 webhook으로 받음" 이 한 곳.

## 마이그레이션 / 환경

- **로컬 DB**: `data/cortex.sqlite`. `.gitignore`에 포함.
- **환경 변수**: `.env.local` (예: `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`).
- **배포**: 단일 컨테이너 (Dockerfile 한 개). Fly.io · Railway · Render 어디든 가능.

## 비-목표

- 마이크로서비스, 별도 백엔드 분리
- 메시지 큐 (필요할 때 BullMQ/Redis 도입 검토 — 지금은 함수 호출이면 충분)
- GraphQL
- 자체 IDE·코드 에디터
