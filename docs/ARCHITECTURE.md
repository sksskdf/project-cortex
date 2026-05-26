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
├── docs/                         ← ARCHITECTURE · DESIGN · CONVENTIONS · DOMAIN · ROADMAP
├── prototype/                    ← 정적 HTML 프로토타입 (디자인 참고용)
├── package.json · tsconfig.json · next.config.mjs · drizzle.config.ts
├── public/design-system/         ← Urock CSS (colors_and_type · dark · lib · fonts)
└── src/
    ├── app/                      ← Next.js App Router (라우트 = 폴더)
    │   ├── layout.tsx            ← AppShell (Sidebar 공유)
    │   ├── globals.css
    │   ├── page.tsx              ← / Dashboard
    │   ├── inbox/page.tsx
    │   ├── pr/[id]/page.tsx
    │   ├── cluster/[id]/page.tsx
    │   ├── clusters/page.tsx     ← 클러스터 인덱스 (#62)
    │   ├── settings/page.tsx     ← AI 토글 (#61) 등
    │   └── api/
    │       ├── webhooks/github/route.ts
    │       └── events/route.ts   ← SSE — webhook 도착 push (router.refresh)
    ├── components/               ← UI only (DB·외부 API 직접 호출 금지)
    │   ├── AppShell.tsx · Sidebar.tsx
    │   ├── PRRow.tsx · PRActions.tsx · DiffHunk.tsx
    │   ├── ClusterActions.tsx · Gauge.tsx · AuthorChip.tsx
    │   ├── AiToggle.tsx · AnalyzeRequestButton.tsx
    │   └── WebhookListener.tsx   ← SSE 클라이언트 (router.refresh debounce)
    ├── lib/                      ← 비즈니스 로직 (React import 금지)
    │   ├── types.ts · confidence.ts · format.ts · queue.ts
    │   ├── pre-review.ts · diff-budget.ts · diff-parser.ts
    │   ├── triage.ts · risk-flags.ts · clustering.ts · cluster-pattern.ts
    │   ├── github.ts · webhook-verify.ts · webhook-payload.ts · sync.ts
    │   ├── auto-merge.ts         ← attemptHumanMerge · deleteMergedBranch · submitRequestChanges
    │   ├── inbox.ts · pr.ts · cluster.ts · dashboard.ts
    │   ├── settings.ts           ← appSettings 단일행 (AI on/off)
    │   ├── env.ts · events.ts
    │   └── prompts/pre-review.ts
    ├── db/
    │   ├── schema.ts             ← Drizzle 스키마
    │   ├── client.ts             ← 단일 DB 핸들 + 자동 migrate
    │   └── migrations/           ← 0000_*.sql … (PR description, branchDeletedAt, app_settings 등)
    ├── actions/                  ← Server Actions
    │   ├── pr.ts                 ← mergePRAction · deletePRBranchAction · requestAnalysisAction · requestChangesAction
    │   ├── cluster.ts            ← mergeClusterAction · dissolveClusterAction
    │   └── settings.ts           ← toggleAiEnabledAction
    ├── copy/ko.ts                ← 모든 한국어 카피
    └── fixtures/                 ← 시드/폴백 데이터 (PR 미분석/installation 없는 경우)
        ├── dashboard.ts · pr-detail.ts · cluster.ts
```

폴더 단위 책임은 §모듈 경계 참조. 실제 디렉토리 트리의 일부만 발췌 — 새 파일은 위 카테고리 중 하나에 매칭되면 그 폴더로.

## 모듈 경계 (지키면 토큰 절감)

- **`src/app/*`은 얇게.** 페이지 컴포넌트는 데이터 fetch + JSX만. 비즈니스 로직 금지.
- **`src/components/*`는 UI만.** DB·외부 API 직접 호출 금지. props로 받음.
- **`src/lib/*`은 UI 없음.** React/Next.js import 금지.
- **`src/actions/*`은 UI와 lib를 잇는 얇은 어댑터.** `'use server'` 함수.
- **`src/db/*`은 lib만 import.** UI에서 db를 직접 import하지 않음.

이 경계가 어긋나기 시작하면 작업당 컨텍스트가 부풀어 오릅니다.

## 데이터 흐름 (대표 시나리오)

| 시나리오 | 흐름 |
|---|---|
| 새 PR 도착 (webhook) | `api/webhooks/github` → `lib/webhook-verify` (HMAC) → `lib/sync.upsertPR` → `lib/pre-review.analyzePR` (Haiku 1차 + Sonnet 조건부) → `lib/triage.decide` → 자동 머지면 `lib/auto-merge.attemptAutoMerge`. 마지막에 `events.emit('sync')` → SSE 푸시 |
| 사용자가 인박스 열기 | `app/inbox/page.tsx` (Server Component) → `lib/inbox.listInboxQueue` + `getInboxCategories` → `<PRRow>` 렌더 |
| 사용자가 PR 머지 | `<PRActions>` → `actions/pr.mergePRAction` → `lib/auto-merge.attemptHumanMerge` → `revalidatePath`. SSE 가 `events` 로 갱신 푸시 |
| 클러스터 자동 묶음 | `lib/sync.tryClusterPR` (synchronize webhook 처리 중 호출) → `lib/clustering.findOrCreateCluster` |

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

## Phase 9 — 서비스 등록

> 일상 도구로 굳히기. OS 부팅·로그인 시 자동 실행하고, 서비스 목록에서 켜고 끕니다. 클라우드 호스팅은 SQLite 영속화·long-running 작업 한계로 부적합해 로컬 머신에 서비스로 등록합니다.

등록 스크립트는 `scripts/service/`에 있고, 모두 프로덕션 시작 명령(`npm run start` = `NODE_ENV=production tsx server.ts`)을 레포 디렉토리에서 실행합니다. 외부 도구(NSSM·launchd)는 번들하지 않으니 먼저 설치해주세요.

### Windows (NSSM)

NSSM은 임의 프로세스를 진짜 Windows 서비스로 감싸 부팅 시 자동 실행되게 합니다. 먼저 설치합니다.

```
winget install NSSM.NSSM      또는      choco install nssm
```

관리자 PowerShell에서 실행합니다.

```
./scripts/service/windows-install.ps1            설치 + 시작 (services.msc 에 "Cortex")
./scripts/service/windows-uninstall.ps1          중지 + 제거
```

- 로그는 `%APPDATA%\Cortex\logs\`에 쌓이고 10MB 단위로 회전합니다.
- 포트·서비스명은 `-Port`·`-ServiceName` 인자로 바꿀 수 있습니다.

### macOS (launchd)

`scripts/service/com.cortex.server.plist`는 placeholder가 있는 템플릿입니다. 파일 상단 주석의 `sed` 한 줄로 경로를 채워 `~/Library/LaunchAgents/`에 복사한 뒤 등록합니다.

```
launchctl load ~/Library/LaunchAgents/com.cortex.server.plist        로그인 시 자동 실행
launchctl unload ~/Library/LaunchAgents/com.cortex.server.plist      해제
```

- `RunAtLoad`로 로그인 시 시작, `KeepAlive`로 비정상 종료 시 자동 재시작합니다.
- 로그는 `~/Library/Logs/Cortex/`에 쌓입니다.

### 업데이트 절차

코드를 갱신할 때는 `git pull` 후 서비스를 재시작합니다 (자동 업데이트는 비-목표).

- Windows: `nssm restart Cortex`
- macOS: `launchctl unload` 후 다시 `launchctl load`
