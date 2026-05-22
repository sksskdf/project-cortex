# Roadmap — Project Cortex

> 프로토타입 4개 화면을 본격 제품으로 옮기는 단계별 계획.

각 Phase는 **산출물(deliverable)**, **핵심 파일**, **완료 기준(DoD)** 으로 구성. Phase 간 의존성을 지키면 컨텍스트가 부풀지 않습니다.

마일스톤 표기 시간은 **AI + 사람 1인 협업** 기준 추정. 사람만이면 ×3, AI만이면 ×0.5.

---

## Phase 0 — 스캐폴딩 (1–2일)

> 빈 폴더에서 첫 화면이 뜨기까지.

**산출물**
- Next.js 14+ App Router 프로젝트
- TypeScript strict, ESLint, Prettier
- 디자인 시스템 CSS 통합 (prototype → public/) — 라이트 + **다크 오버레이**
- `<html data-theme="dark">`가 디폴트
- 첫 빌드·dev 서버 동작

**핵심 파일**
```
package.json        next.config.mjs   tsconfig.json
.eslintrc.json      .prettierrc       .gitignore
src/app/layout.tsx  src/app/page.tsx  src/app/globals.css
public/design-system/{colors_and_type.css, dark.css, lib/lib.css, fonts/}
```

**DoD**
- `npm run dev` → `http://localhost:3000`에서 **다크 배경**에 Urock 폰트 적용된 빈 페이지
- TypeScript 에러 0건
- `globals.css`에 디자인 시스템 세 파일 import (colors_and_type → dark → lib)
- `<html>` 루트에 `data-theme="dark"` 박혀 있음

---

## Phase 1 — UI 셸 + 정적 화면 (3–5일)

> 4개 프로토타입을 React 컴포넌트로 옮긴다. 데이터는 mock.

**산출물**
- `<AppShell>` + `<Sidebar>` (마크업 중복 제거)
- 4개 라우트 동작: `/`, `/inbox`, `/pr/[id]`, `/cluster/[id]`
- mock 데이터로 모든 화면 렌더
- 공유 컴포넌트 라이브러리

**핵심 파일**
```
src/app/layout.tsx                    ← AppShell
src/app/page.tsx                      ← Dashboard
src/app/inbox/page.tsx
src/app/pr/[id]/page.tsx
src/app/cluster/[id]/page.tsx
src/components/Sidebar.tsx
src/components/Gauge.tsx              ← 신뢰 점수 게이지
src/components/AuthorChip.tsx
src/components/PRRow.tsx              ← Dashboard + Inbox 공통
src/components/DiffHunk.tsx
src/components/Segment.tsx            ← ds-segment wrapper
src/copy/ko.ts                        ← 프로토타입 모든 카피 수집
src/mocks/inbox.ts, pr.ts, cluster.ts, dashboard.ts
```

**DoD**
- 사이드바에서 4개 화면을 클릭으로 이동 가능
- 인박스 → PR → 머지 흐름이 시각적으로 동작 (실제 머지는 안 됨)
- 인라인 한글 문자열·hex 색 0건 (`AGENTS.md` 룰 통과)
- Sidebar 마크업은 `Sidebar.tsx` 한 곳에만 존재

---

## Phase 2 — 도메인 모델 + DB (2–3일)

> mock 데이터를 SQLite로 옮긴다.

**산출물**
- Drizzle 스키마 (6개 객체 — `docs/DOMAIN.md` 참조)
- SQLite DB 파일 + seed 스크립트
- `lib/types.ts` 도메인 타입 (스키마 → 타입 자동 생성)
- 기본 CRUD lib (`lib/inbox.ts`, `lib/pr.ts`, `lib/cluster.ts`)
- mock → DB 마이그레이션 (seed 데이터로 같은 시각 결과)

**핵심 파일**
```
src/db/schema.ts
src/db/client.ts
src/db/migrations/0001_init.sql
src/db/seed.ts
src/lib/types.ts
src/lib/inbox.ts        ← listInbox(), getPR(), getCluster()
drizzle.config.ts
```

**DoD**
- `npm run db:migrate && npm run db:seed`로 8개 PR + 1개 클러스터가 들어감
- Phase 1의 mock import를 lib 함수 호출로 대체
- 화면이 mock 때와 같은 모습 (회귀 없음)
- `lib/*`에 React import 0건

---

## Phase 3 — GitHub 통합 (3–5일)

> 외부 git의 PR을 받는다.

**산출물**
- **GitHub App 등록 (개인 계정 발급, 개인+회사 둘 다 install)** — 회사 조직이 third-party App 설치를 허용한다는 전제. PAT는 폴백.
- **다중 credential 스키마** — `credentials` 테이블(App installation 또는 PAT) + `projects.credential_id` FK. 프로젝트별로 어느 계정으로 호출할지 지정.
- Webhook 수신 엔드포인트 (HMAC 서명 검증)
- Octokit 어댑터 (`lib/github.ts`) — credential별 `getOctokitFor(projectId)` 팩토리
- PR 생성·업데이트 동기화
- 머지 API 호출

**핵심 파일**
```
src/app/api/webhooks/github/route.ts
src/lib/github.ts                     ← getOctokitFor, getPRDetails, mergePR
src/lib/sync.ts                       ← webhook payload → DB upsert
src/lib/credentials.ts                ← 암호화·복호화, installation 토큰 갱신
src/db/schema.ts                      ← credentials + projects.credential_id 추가
src/app/settings/credentials/page.tsx ← credential 등록·삭제 UI
.env.local                            ← GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
                                        GITHUB_WEBHOOK_SECRET, CORTEX_SECRET
                                        (CORTEX_SECRET으로 DB 내 token 암호화)
```

**DoD**
- 개인 계정 install + 회사 조직 install이 별도 row로 등록됨
- 각 프로젝트가 자기 credential로 GitHub API 호출 (잘못된 토큰 사용 0건)
- 테스트 레포에 PR을 만들면 5초 이내 Cortex DB에 표시됨
- 인박스에서 머지 버튼이 GitHub PR을 실제로 머지
- webhook 서명 검증 + installation 토큰 자동 갱신 (1시간 만료 대응)
- 동기화 실패 시 에러 로깅 (사용자 노출 X)

**구현 순서 (PR 단위)**
- 3.1: Octokit 어댑터 + vitest (단일 토큰 가정) ✅ PR #11
- 3.2: lib/sync upsert + 단위 테스트 ✅ PR #14
- 3.3: webhook 라우트 + HMAC 서명 검증 (단일 토큰 유지)
- 3.4: credentials 스키마 + `getOctokitFor` + 설정 UI

**후속 작업 (백로그) — PR 동기화 정합성**

문제: 현재 인박스 진입은 webhook 수신 시점에만 동작. 다운타임 중 도착한 webhook 은 GitHub 가 재시도(보통 8회) 후 영구 손실. 첫 onboard 시점에 이미 열려 있던 open PR 도 안 보임. DB 손실/마이그레이션 후 복구 메커니즘 없음.

해결안 (옵션 1 + 4 조합 추천, 1 은 후순위):

1. **수동 reconcile 트리거 (`/settings` 또는 `/projects` 의 "GitHub 와 동기화" 버튼)** — 첫 도입 권장. 등록된 projects 의 open PR 을 `octokit.pulls.list` 로 가져와 `handlePullRequestWebhook` 의 upsert 로직과 같은 흐름으로 멱등 처리. **AI 분석 명시적 bypass** (크레딧 0).
2. **서버 시작 시 자동 reconcile** — Phase 7 (운영) 견고성 단계에서 추가. 옵션 1 의 같은 로직을 startup hook 에서 1회 실행. dev 환경에선 자주 재시작되므로 토글로 끌 수 있게.

AI bypass 흐름: `handlePullRequestWebhook` 에 `source: 'webhook' | 'reconcile'` 옵션 추가. `reconcile` 이면 `safeAnalyze` · `runTriage` skip → PR 이 인박스에 `미분석` 상태로 등장. **이 흐름은 PR #63 (미분석 PR 도 실 diff 표시 + 분석 요청 버튼) 와 자연스럽게 들어맞음** — 사용자가 PR 상세 진입 시 diff 가 GitHub API 로 직접 fetch 되어 보임. 명시적으로 "AI 분석 요청" 누르면 그때 Anthropic 호출.

비-목표: GitHub missed webhook replay (App 이벤트 로그 API 가 복잡 + 한정), 주기적 polling (webhook 의미 약화 + rate limit 소모).

---

## Phase 4 — AI 사전 리뷰 (3–4일)

> PR이 들어오면 Cortex AI가 분석한다.

**산출물**
- Anthropic API 호출 (`lib/pre-review.ts`)
- Diff fetch + 토큰 분할 + 분석 프롬프트
- 신뢰 점수·위험 플래그·인라인 코멘트 추출
- 결과 캐시 (`(prId, headSha)` 유니크)

**핵심 파일**
```
src/lib/pre-review.ts                 ← analyzePR(prId)
src/lib/prompts/pre-review.ts         ← system + user 프롬프트
src/lib/confidence.ts                 ← score → tier 매핑
src/lib/risk-flags.ts                 ← 정규식·휴리스틱 + LLM 결과 결합
.env.local                            ← ANTHROPIC_API_KEY
```

**DoD**
- PR이 새로 들어오거나 push가 발생하면 자동으로 PreReview 생성
- PR 화면에 신뢰 점수·hunk 어노테이션·인라인 코멘트가 표시됨
- 같은 SHA에 대해 두 번째 호출은 캐시 hit (API 호출 0회)
- 위험 플래그 7종(`payment-domain`, `auth-domain`, `migration`, `security-sensitive`, `external-api-new`, `low-coverage`, `large-change`)이 동작

**진척 (후속)**
- **`testsPassed` 채우기 + check webhook 재트라이아지** (#TBD) — analyzePR 가 `listCheckRunsForRef` 호출해 초기값 채우고, `check_run`/`check_suite` (`action='completed'`) webhook 이 도착하면 preReview 갱신 + auto-merge 재시도.

**후속 작업 (백로그)**
- **`coverage` 실 채우기** — Codecov / Coveralls / GitHub Actions artifact / PR comment 파싱 중 택일. 통합 ROI 가 명확한 코드베이스만 적용.

---

## Phase 4.5 — LLM 비용 최적화 (2–3일)

> Anthropic API 사용량을 줄이면서 분석 품질은 유지.
> Phase 4 의 단순 1회 호출 구조를 다듬는 후속.

**배경** — Pro/Max plan 으로는 백엔드 자동화 호출을 못 함 (약관·rate limit). API key 결제는 유지하되 토큰 소비를 줄이는 두 축.

**산출물**

### 4.5a — diff 토큰 절감
- 큰 diff 자르기 (`lib/pre-review.ts`): hunk 우선순위(수정/추가 라인 많은 파일 먼저) 로 정렬 후 상한까지만 LLM 에 전달
- lock 파일·생성 파일 (`*.lock`, `dist/`, `generated/`) 은 통계만 보내고 본문 제외
- 잘린 부분은 프롬프트에 "n개 hunk 생략" 명시 → confidence 보수적으로 추정하게 유도

### 4.5b — Haiku 1차 필터 + Sonnet 재분석
- Haiku 로 1차 분류 (`needs-deep-review: bool`) — 토큰가는 Sonnet의 약 1/4
- 1차 결과가 `false` 면 그 응답 그대로 PreReview 로 저장
- 1차 결과가 `true` 거나 위험 플래그 후보 매칭이면 Sonnet 로 재분석
- 두 단계 비용 합이 단일 Sonnet 호출보다 낮은지 메트릭으로 검증

**핵심 파일**
```
src/lib/pre-review.ts                 ← 분기 로직 (Haiku 1차 → Sonnet 조건부)
src/lib/diff-budget.ts                ← hunk 우선순위 + 토큰 상한
src/lib/prompts/pre-review.ts         ← 1차 분류 프롬프트 추가
.env.local                            ← ANTHROPIC_HAIKU_MODEL · ANTHROPIC_SONNET_MODEL
```

**DoD**
- 1MB 이상 diff PR도 LLM 호출이 timeout 없이 통과
- 단순 의존성 업데이트·문서 변경 PR은 Haiku 만으로 처리 (Sonnet 호출 0)
- 복잡 PR (위험 플래그 후보, 큰 변경) 은 자동으로 Sonnet 재분석
- 월 분석 토큰이 Phase 4 베이스라인 대비 40%+ 감소
- 캐시·재시도·에러 폴백은 Phase 4 와 동일하게 유지

**비-목표**
- Pro/Max plan OAuth 토큰을 백엔드에서 쓰는 우회 (약관 위반 — 2026-04 부터 명시 금지)
- 자체 호스팅 LLM (운영 복잡도 vs 비용 trade-off 가 현재 규모에서 안 맞음)

---

## Phase 5 — 트라이아지 엔진 (3–4일)

> "이 PR을 어디로 보낼지" 자동 결정.

**산출물**
- 자동 머지 정책 (`lib/triage.ts` — `docs/DOMAIN.md` §4 룰)
- "왜 사람이 봐야 하는지" 이유 생성
- 사람 검토 큐 배치 + 우선순위 계산
- 자동 머지 실행

**핵심 파일**
```
src/lib/triage.ts                     ← decideTriage(pr, preReview) → TriageDecision
src/lib/queue.ts                      ← orderInbox(prs) — 우선순위 정렬
src/lib/auto-merge.ts                 ← 정책 체크 후 mergePR 호출
```

**DoD**
- 신뢰 점수 90+ & 위험 플래그 없음 PR이 자동 머지됨
- 자동 머지 시 대시보드 "최근 자동 머지" 피드에 노출
- 사람 검토 PR은 인박스에 "왜 큐에 있는지" 한 줄 사유 표시
- 자동 머지 실패 시 사람 검토로 폴백

---

## Phase 6 — 클러스터링 (4–5일)

> 비슷한 PR을 자동으로 묶는다.

**산출물**
- 유사도 계산 (파일 자카드 + diff 임베딩 코사인)
- 클러스터 자동 생성·해제
- 공통 패턴 추출 (대표 hunk 선택)
- 일괄 머지 액션

**핵심 파일**
```
src/lib/clustering.ts                 ← findClusters(), updateCluster()
src/lib/embeddings.ts                 ← diff → 벡터 (Anthropic 또는 로컬 모델)
src/lib/cluster-pattern.ts            ← 공통 패턴·차이점 추출
src/actions/cluster.ts                ← mergeCluster(id), dissolveCluster(id)
```

**DoD**
- 24시간 이내, 같은 에이전트, 유사도 0.85+ 인 PR 3개 이상이 자동으로 클러스터됨
- 클러스터 화면에서 "전체 머지" 1클릭으로 N개 PR 일괄 머지
- 강한 위험 플래그(`payment-domain` 등)는 클러스터링 제외
- 사람이 클러스터 해제 시 각 PR이 개별 인박스로 복귀

**진척**
- 6.1 자카드 유사도 (#26) · 6.2 일괄 머지/해체 액션 (#36) · 6.3 derive 패턴 (#37) · sync wire-up (#43) 완료.
- 임베딩 기반 의미 유사도 (`embeddings.ts`) 는 후속 — 자카드 만으로도 i18n 류 동일 파일 반복 패턴은 잘 잡힘.

**후속 작업 (백로그)**
- **클러스터 일괄 머지 후 브랜치 일괄 삭제** — PR #46 의 `deleteMergedBranch` 를 `mergeCluster` 후처리로 묶기. UI 결과 토스트에 삭제 N건 같이 표시.
- **머지 충돌 해결 흐름** — 일괄 머지 중 한 PR 이 GitHub `mergeable_state` 가 `dirty` 또는 머지 호출이 409 (conflict) 반환 시:
  - 현재: 그 PR 만 `failed` 처리, 나머지는 진행, 클러스터 status='partially-merged'.
  - 개선 후보: (a) 충돌 PR 만 자동으로 base 에서 rebase 시도 (octokit `repos.merge` 로 base→head 머지 커밋) → 성공 시 재머지. (b) 사용자에게 충돌 PR 목록 + "GitHub 에서 해결" 링크 노출. (c) "충돌 PR 빼고 다시 머지" 액션.
  - 우선순위 (b) > (c) > (a). 자동 rebase 는 base history 가 바뀌므로 의도치 않은 변경 위험.
- **해제된 PR 들의 재클러스터링** — `dissolveCluster` 후 같은 PR 들이 다시 자동 묶이지 않도록 `dissolved_at` 기준 짧은 cooldown 또는 사용자 명시적 "다시 묶기" 버튼.
- **클러스터의 진짜 공통 hunk 추출** — 현재 `derivePatternLines` 가 첫 PR 의 첫 hunk 만 발췌. 멤버 PR diff 들의 라인 교집합 (또는 임베딩 cluster head) 으로 진짜 공통 패턴 노출.
- **머지 후 클러스터 상태 표시 강화** — PR #36 의 ClusterActions 가 `cluster.status` 기준 disable 처리 (해당 PR 에서 적용 예정).

---

## Phase 7 — 운영 (지속)

> 출시 후 유지하는 데 필요한 것.

**진척**
- 대시보드 stat delta 실 계산 시작 (#50) — `pendingReview` · `autoMerged` · `avgConfidence` 모두 이번 7일 vs 지난 7일 비교. `fixtures/dashboard` 의 `statDeltas` 제거.
- **`/reports` 페이지 + 알림 시스템 활성화** — 자동 머지율·일별 인입·일별 머지 추이 (자동/수동/외부)·평균 신뢰 점수 추이·revert 감지를 SVG 로 시각화 (chart 라이브러리 X). `notifications` 테이블 + 헤더 드롭다운 + 자동 hook (auto-merge 성공/실패 · CI 실패 · 새 클러스터 · revert 감지). 사이드바 `/reports` comingSoon 해제, 대시보드 헤더 알림 버튼 활성화.
- 구조화 로깅 · Sentry · 배포 자동화는 후속.

**산출물**
- 구조화 로깅 (Pino 또는 Next.js logger)
- 에러 트래킹 (Sentry 옵션)
- 메트릭 대시보드 (자동 머지율·평균 신뢰 점수·revert율)
- 배포 자동화 (GitHub Actions → Fly.io/Railway)
- 백업·복구 절차

**핵심 파일**
```
src/lib/logger.ts                     ← 단일 로거 인스턴스
src/app/api/metrics/route.ts          ← 운영 메트릭 (내부용)
.github/workflows/deploy.yml
Dockerfile
```

**DoD**
- 자동 머지된 PR 중 24시간 내 revert율 측정 가능
- 에러 발생 시 Sentry/Slack 알림
- 배포 자동화 (메인 머지 → 5분 내 배포)

**후속 작업 (백로그)**
- **머지/삭제 액션 후 라벨 깜빡임** — `useTransition` 의 `pending` 이 RSC refresh 까지 감싸서 머지 직후 `브랜치 삭제` 버튼이 `삭제 중...` 으로 잠깐 잘못 표시. `inFlight` 별도 추적으로 1차 완화 (PR #67) 했지만 dev 모드에서 여전히 재현. 근본 해결은 `useOptimistic` 도입 + Server Action 후 자동 refresh 시점에 RSC 트리 안정성 확보. 보류 사유 — 사용자 인지된 후 dev 환경 artifact 가능성 점검 우선.
- **PR description 마크다운 렌더링** — 현재 `prs.body` 를 평문으로 표시해 `###`, `**` 같은 마크업이 그대로 노출. react-markdown 또는 lightweight parser 도입 (새 dependency — 사용자 승인 필요).
- **revalidatePath 정밀화** — 현재 모든 액션이 `'/'` `'/inbox'` 등 광범위 revalidate. 영향 범위 명시화 (페이지 vs 레이아웃) + 불필요한 호출 제거.

---

## Phase 8 — 기존 프로젝트 인테이크 (첫 실사용 마일스톤) (3–5일)

> `C:\dev\projects` 6개 프로젝트를 Cortex로 이관·통합. 도구가 자기 자신의 첫 사용자가 됨.

**대상 프로젝트** (디지털 포렌식·감사 도메인):

| 프로젝트 | 특징 |
|---|---|
| `dfasee2` | 가장 본격적 — git + README + 서브모듈 3개 (`agent`, `backend`, `frontend`) — **인테이크 1순위** |
| `gofas` | Python `app.py` 기반 + license 시스템 + 빌드 자동화 |
| `dfas-ent`, `dfasee` | DFAS 시리즈 — `prod/` 위주 |
| `gm-pro`, `mcq` | `src/` + `doc/` 기반 |

**통합 방식**: **Adopt** — 코드는 그대로 둠. Cortex는 PR/이슈/머지 워크플로우만 통합 (= ARCHITECTURE.md "Cortex는 oversight layer" 원칙 유지). 모노레포 흡수 아님.

**산출물**
- `Project` 객체 6개 (DB에 레포 메타 등록: URL · 기본 브랜치 · 자동 머지 정책 토글)
- 각 레포의 GitHub Webhook 설정 (필요 시 GitHub Personal Repo는 PAT, 조직 레포는 GitHub App)
- 인테이크 마법사 화면 (`/onboarding/intake`): "레포를 등록하세요 → 사전 분석 1회 실행 → 자동 머지 정책 선택"
- 도메인별 위험 플래그 튜닝 — 포렌식 도메인은 `license-tampering`, `evidence-handling` 같은 추가 플래그 후보

**핵심 파일**
```
src/app/onboarding/intake/page.tsx     ← 인테이크 마법사
src/lib/intake.ts                      ← 레포 등록 + webhook 자동 설정
src/lib/risk-flags.ts                  ← 포렌식 도메인 플래그 추가
src/db/seed-projects.ts                ← 6개 프로젝트 초기 등록 스크립트
data/cortex.sqlite                     ← 첫 실데이터 적재 시작
```

**DoD**
- 6개 레포가 Cortex 인박스에 등록되고 새 PR이 5초 이내 동기화됨
- 각 레포에 대해 자동 머지 정책이 개별 토글됨 (보수적 시작: 모두 OFF로 두고 1주 관찰 후 ON)
- 가장 본격적인 `dfasee2`부터 시작 — 첫 자동 머지가 24시간 내 발생
- 6개 레포의 첫 주 메트릭이 대시보드에 표시됨

**후속 작업 (백로그)**
- **레포 등록 마법사 UX** — 사용자가 GitHub URL 붙여 넣으면 (a) App install 안내 (없으면) → (b) webhook 자동 설정 → (c) 첫 분석 1회 실행 → (d) 자동 머지 정책 옵션 노출. 단계별 진행 상태 표시.
- **포렌식 도메인 위험 플래그 추가** — `license-tampering` · `evidence-handling` · `chain-of-custody` 후보. risk-flags.ts 의 정규식·LLM 프롬프트에 합류.
- **레포별 분석 모델 선택** — Phase 4.5b 의 Haiku/Opus 분기 외에 레포별 디폴트 모델 지정 (e.g. dfas 시리즈는 보수적으로 Opus 강제).

**비-목표 (이 Phase에서도)**
- 코드를 한 모노레포로 통합하는 작업 (의도적으로 안 함)
- 비-Cortex 외부 사용자에게 공개 (단일 사용자 전용)

---

## Phase 9 — Desktop 서비스 패키징 (2–3일)

> 일상 도구로 굳히기. OS 부팅 시 자동 실행 + 서비스 목록에서 제어 가능.

**산출물**
- Windows 서비스 등록 스크립트 (NSSM 기반)
- macOS launchd `.plist` + 설치 스크립트
- Linux systemd unit (선택)
- OS별 표준 데이터·로그 경로
- 첫 실행 시 자동 마이그레이션 (PR #13 이후 client.ts가 처리) + 시드 옵션 안내
- 업데이트 절차 문서 (git pull + 서비스 재시작)

**핵심 파일**
```
service/
├── win/
│   ├── install.ps1           ← nssm install Cortex node ...
│   ├── uninstall.ps1
│   └── README.md
├── mac/
│   ├── com.cortex.plist      ← launchd 등록 (RunAtLoad=true, KeepAlive=true)
│   ├── install.sh            ← ~/Library/LaunchAgents/에 복사 + launchctl load
│   ├── uninstall.sh
│   └── README.md
└── linux/
    └── cortex.service        ← systemd unit (선택)
src/lib/paths.ts              ← OS별 데이터·로그·런타임 경로 헬퍼
```

**표준 경로**

| OS | 데이터 | 로그 |
|---|---|---|
| Windows | `%APPDATA%\Cortex\cortex.sqlite` | `%APPDATA%\Cortex\logs\` |
| macOS | `~/Library/Application Support/Cortex/cortex.sqlite` | `~/Library/Logs/Cortex/` |
| Linux | `~/.local/share/cortex/cortex.sqlite` | `~/.local/state/cortex/logs/` |

`CORTEX_DB_PATH` 환경변수가 있으면 우선. 없으면 OS 기본값.

**DoD**
- Windows: `services.msc`에 "Cortex" 표시, 시작/중지/재시작 동작. 재부팅 후 자동 실행.
- macOS: `launchctl list | grep cortex` 보임, `sudo launchctl unload` 등으로 제어. 로그인 시 자동 실행.
- 한 명령으로 설치·제거 가능 (예: `pwsh ./service/win/install.ps1`).
- 로그 파일 회전(rotation) 적용 — Pino daily rotate 또는 OS 로그 시스템 활용.
- 단일 인스톨러로 노드·의존성·DB 위치 셋업 완료.
- 업데이트 절차 문서화.

**선택지 비교**

| 방식 | 장점 | 단점 |
|---|---|---|
| **NSSM (Windows)** | 가장 단순, 검증됨 | 별도 다운로드 필요 |
| **node-windows** | npm 한 줄, 코드 통합 | UAC 권한 필요 |
| **단일 실행 파일 (pkg/nexe/sea)** | 사용자 친화 | 빌드 복잡, 크기 증가 |
| **launchd (Mac)** | OS 표준 | macOS 전용 |

기본 접근: **NSSM + launchd**. Linux는 systemd unit 템플릿 제공(선택).

**비-목표 (이 Phase에서도)**
- 자동 업데이트 (manual `git pull`로 충분)
- GUI 트레이 아이콘 (브라우저 탭이 UI)
- 멀티 인스턴스 / 멀티 사용자 (단일 사용자 가정 유지)
- 코드 서명·노타라이제이션 (개인 사용 전제)

---

## 의존성 그래프

```
Phase 0 → 1 → 2 → 3 → 4 → 4.5 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13
                      (병렬: 3, 4)
```

Phase 3·4 는 도메인이 다르니 병렬. Phase 4.5 는 Phase 4 사용 후 토큰 사용량이 보이면 진입. Phase 5 는 Phase 3·4 가 모두 끝나야 함. Phase 8 은 **Phase 7 까지 안정** 된 후. Phase 9 는 Phase 8 의 첫 실사용 확인 후 굳히는 단계. Phase 10–13 은 단일 사용자의 일상 도구로 성장시키는 후속 — Phase 10 (로드맵) 부터는 가설성이 높아 사용 데이터 본 후 우선순위 재조정.

---

## 의사결정 일지 (Decision Log)

새 라이브러리·런타임·아키텍처 결정은 여기 한 줄로 박제. 새 PR에서 어긋나는 결정을 하려면 이 일지를 먼저 수정.

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-05-15 | Next.js App Router 채택 | 모노리식 + SSR + Server Actions의 자연스러운 선택 |
| 2026-05-15 | Tailwind 미사용 | Urock CSS 변수가 이미 토큰을 노출 — 빌드 도구 절약 |
| 2026-05-15 | SQLite + Drizzle | 단일 파일 DB로 시작, 타입 안전성 우수 |
| 2026-05-15 | 클러스터 강한 플래그 제외 룰 | 결제·인증 도메인은 묶음 머지의 리스크가 큼 |
| 2026-05-15 | **다크 모드 디폴트** | 사용자 지시 — 라이트는 향후 옵션. `design-system/dark.css` 오버레이로 토큰만 재정의 |
| 2026-05-15 | **단일 사용자 모드 유지** | 첫 사용자가 사용자 본인. 멀티 테넌시·권한·빌링은 비-목표 |
| 2026-05-15 | **Adopt 방식 통합** | `C:\dev\projects` 6개를 모노레포로 흡수하지 않고 Cortex가 PR/이슈만 위에서 관리. 각 레포의 git 히스토리·도구 체인 보존 |
| 2026-05-18 | **다중 GitHub App installation** | 단일 사용자가 개인 + 회사 두 계정의 repo를 한 Cortex 인스턴스로 다룸. App 하나(개인 계정 발급)를 두 곳에 install. 회사 정책상 App 불가 repo는 PAT 폴백. `credentials` 테이블로 토큰 분리, `projects.credential_id`로 매핑 |
| 2026-05-18 | **Desktop 서비스 패키징(Phase 9)** | 단일 사용자 시나리오. 클라우드 호스팅(Vercel 등)은 SQLite 영속화·long-running 작업 한계로 부적합. 로컬 머신에 NSSM(Win) / launchd(Mac)로 서비스 등록 |
| 2026-05-20 | **Anthropic API key 결제 유지 + 토큰 절감 (Phase 4.5)** | Pro/Max plan OAuth 토큰을 백엔드에서 쓰는 건 2026-04 부터 약관 금지 + rate limit 도 부적합. API key 는 유지하되 diff 토큰 절감 + Haiku 1차 필터 + Sonnet 재분석 두 축으로 비용 최적화 |
| 2026-05-20 | **자동 클러스터링 활성화 (Phase 6 wire-up)** | `tryClusterPR`(Phase 6.1) 가 `sync.ts` 의 webhook 흐름에 wire-up 됨 (#43). 같은 작성자 · 24h · 자카드 0.85+ · 차단 플래그 없음 3건 모이면 자동 묶임 — 인박스에선 사라지고 `/clusters` 에서 일괄 처리 |
| 2026-05-20 | **PR description 저장** | webhook 의 `pull_request.body` 가 DB 로 안 전달돼 PR 상세에서 본문을 못 봄 (#56). `prs.body` 컬럼 추가 + sync 가 upsert 시 저장. 빈 body 도 자연스럽게 (UI 가 섹션 자체 숨김) |
| 2026-05-21 | **변경 요청은 위험 PR 전용 게이트** | Cortex 는 AI 가 만든 코드의 게이트키퍼. 모든 PR 에서 '변경 요청' 활성화하면 사람이 일일이 판단해야 해 도구의 의도와 어긋남. `reason.tone alert/warn` (PR #65, gating #67 후속) PR 에서만 버튼 노출. 거절 의사 push 후 코드 수정은 Cortex 가 처리하지 않음 — Claude Code (사용자 Plan) 가 별도 세션에서 응답하고, Cortex 는 다음 webhook 으로 재분석만 |
| 2026-05-21 | **Phase 10 → 정식 + Phase 11/12/13 추가** | 가설이던 프로젝트별 로드맵을 정식 Phase 10 으로 격상. 사용자의 일상 도구 통합 방향으로 Phase 11 (TODO/노트/캘린더), Phase 12 (로컬 워크스페이스), Phase 13 (Claude Code 터미널 임베드) 추가. Phase 13 은 기술적 미해결 (보안 모델) 많아 가장 마지막 |
| 2026-05-21 | **외부 에이전트는 Claude 단일** | `/agents` · '에이전트 시작' 의 외부 에이전트 통합 범위를 Claude (Claude Code · Claude API) 만으로 좁힘. Devin · Codex 등 타사 에이전트는 비-목표. 이유 — 단일 사용자가 실제로 사용 중인 에이전트가 Claude 뿐, 다중 에이전트 추상화는 사용 데이터 없이는 over-engineer. Phase 13 (터미널 임베드) 와 자연 통합 |
| 2026-05-21 | **자동 머지 활성화 디폴트 + Claude Code marker 식별** | 자동 머지 5조건 중 사용자의 실 시나리오에서 두 군데가 항상 막혀 한 번도 발화 못 함: (1) 자동 onboard 시 `autoMergeEnabled` 명시 안 해 schema default(false) 적용, (2) 사용자 본인 계정으로 push 한 Claude Code PR 이 'human' 분류. → onboard 시 `autoMergeEnabled: true` 명시 (App 설치 자체가 자동화 의지의 표명), `classifyAuthor` 에 PR body 의 `https://claude.ai/code/` marker 검사 추가. 기존 onboard 된 row 는 SQL 로 직접 갱신 필요 |
| 2026-05-21 | **Check Runs 통합으로 자동 머지 실효화** | analyzePR 가 `listCheckRunsForRef` 호출해 testsPassed 초기값 채움. `check_run`·`check_suite` (`completed`) webhook 받아 preReview 갱신 + 재트라이아지 → CI 가 늦게 끝나도 자동 머지 트리거. neutral/skipped 는 비-카운트, failure/cancelled/timed_out/action_required 는 false. coverage 는 별도 (Codecov/PR 코멘트 — 백로그) |
| 2026-05-21 | **자동 머지 정책 토글 UI (임시)** | 기존 onboard 된 projects 의 `autoMergeEnabled=0` 을 끄거나 켜려면 SQL 만 가능했던 사각지대 해결. `/settings` 에 "자동 머지 정책" 섹션 — installation 있는 프로젝트별 토글. Phase 8 의 인테이크 마법사가 들어오면 거기로 흡수 예정. 사용자 시그널: "DB 값 바꿔야 되는 거면 UI 에서 가능해야 한다" |
| 2026-05-21 | **PR 인박스 진입은 webhook 만 — reconcile 백로그** | 현재 인박스 진입 트리거가 webhook 수신 시점에만 동작 → 다운타임 중 도착한 webhook 영구 손실 + 첫 onboard 시 이미 열린 PR 미노출. 해결: 수동 reconcile 트리거 (`/settings` → "GitHub 와 동기화") 우선 도입, 서버 시작 시 자동 reconcile 은 Phase 7 운영 견고성 단계. AI 분석은 reconcile 흐름에서 명시적 bypass → 크레딧 0. PR #63 (미분석 PR 의 GitHub diff 직접 fetch + 분석 요청 버튼) 흐름과 자연 결합 |
| 2026-05-21 | **자동 머지 end-to-end 활성** | PR #70 (Check Runs) + #71 (onboard 디폴트 + Claude marker) + #72 (머지 차단 UI / 자동·수동 구분 카운트) 머지 후 5조건이 실 시나리오에서 충족 가능. 이 PR 자체가 첫 end-to-end 테스트 — 사용자 본인 계정으로 push 했지만 body 에 `https://claude.ai/code/` 자동 포함 → `agent` 분류, `autoMergeEnabled=1` SQL UPDATE 후 CI 통과 시 자동 머지 발화 기대 |
| 2026-05-21 | **자동 머지 race-safe + 자동 브랜치 삭제 + CI 대기 disable** | #73 첫 테스트에서 발견: check_run + check_suite completed 두 webhook 이 거의 동시에 도착 → handleCheckWebhook 병렬 두 번 실행 → 둘 다 attemptAutoMerge → 첫 호출 성공, 두 번째 'Merge already in progress' 실패 → revertToReviewNeeded 가 decision='human-review' 로 박아 "직접 머지" 오분류. PR #78 에서 race error 패턴 매칭 시 첫 호출 성공으로 정정 + 자동 머지 후 head 브랜치 자동 삭제 + CI 결과 대기 중엔 머지 버튼 disable 추가 |
| 2026-05-21 | **자동 머지 검증 #2** | PR #79 가 사용자가 확인하기 전에 너무 빨리 자동 머지됨 — 다시 검증용 PR. 이번 PR 의 흐름 추적: (1) CI 대기 중 머지 버튼 disable + "머지 대기" 배지 (2) check 두 webhook race-safe (3) 자동 머지 + 브랜치 자동 삭제 (4) 대시보드 "자동" 배지 + 카운트 +1 |
| 2026-05-21 | **Phase 7 1단계 — /reports + 알림 시스템** | Phase 7 의 두 사용자 가치 축 (메트릭 시각화 · 운영 이벤트 통지) 을 한 PR 로 활성화. **차트 라이브러리 채택 안 함** — `MiniBarChart`/`Sparkline` SVG 직접 (recharts/visx 등 새 dep 회피). 알림은 polling/SSE 별도 없이 기존 `WebhookListener` 의 `router.refresh()` 로 자연 갱신 (대시보드 RSC 가 `listRecentNotifications` 호출). 알림 kind 5 종: auto-merged · auto-merge-failed · ci-failed · cluster-created · revert-detected. CI 실패는 `prs.testsPassed` 전이 시점에만 발화 — 같은 PR 의 여러 check_run 완료에 알림 폭탄 방지. revert 감지는 title prefix `Revert ` 휴리스틱 (정밀 매칭 후속). 구조화 로깅 · Sentry · 배포 자동화는 Phase 7 의 다음 묶음 |
| 2026-05-21 | **머지 차단 사유 우선순위 수정 + 인박스 행 CI 가드** | PR 상세 `mergeBlockNote` 의 우선순위가 주석과 코드가 어긋남 — 충돌(dirty) PR 에도 "CI 결과 도착 후 자동 머지" 로 잘못 표기되는 혼동. 코드 우선순위를 주석대로 `dirty > blocked > ciPending` 로 정정. 같이 발견된 별도 버그: 대시보드/인박스 행 인라인 머지 버튼이 `testsPassed` 를 안 봐서 CI 통과 전 클릭 가능했음. `deriveRowActions` 에 `testsPassed` 인자 + `mergeBlockedByCI` 노출 추가. 인라인 머지 버튼은 disabled 로 그리고 title tooltip 으로 사유 안내. `mergeable_state` 까지 행에 캐시하면 충돌까지 막을 수 있지만 GitHub API 호출이 N배라 보류 — 충돌은 클릭 시 GitHub 에러로 안내 |
| 2026-05-21 | **Phase 13 기술 결정 + /agents · 에이전트 시작 · 새 이슈 재분류** | Phase 13 (Claude CLI 통합) 의 기술 스택 박제: 터미널 UI = xterm.js + node-pty + WebSocket (새 dependency 3 개), 보안 모델 = (a) Cortex 가 `claude`/`claude-code` CLI 만 화이트리스트 spawn (근거: localhost only 단일 사용자 → 외부 노출 0). 대안 (b) 외부 터미널 attach · (c) 클립보드 복사 는 사용자 흐름 비용 큼. 이 결정으로 사이드바 `/agents` · 헤더 '에이전트 시작' · '새 이슈' 모두 Phase 8 후속 → Phase 13 으로 이관 — Cortex 가 Claude API 를 직접 호출하지 않고 사용자 Claude plan 으로 CLI spawn 만 함 (Phase 4.5 API key 결제 흐름과 별개, 크레딧 0). 우선순위는 Phase 12 (로컬 워크스페이스) 후 — 워크스페이스 경로가 spawn cwd 화이트리스트 입력 |
| 2026-05-21 | **차트 라이브러리 Recharts 채택 — 직접 SVG 결정 번복** | Phase 7 1단계 (#94) 에서 `MiniBarChart`/`Sparkline` 을 SVG 로 직접 그렸으나 실데이터 (1·7건 등 적은 카운트) 에 axis/grid/tooltip 없이 보여지자 화면이 빈약해 보이고 절대값 감 안 옴 (사용자 시그널: "차트가 제대로 안 나오는데"). **Recharts** (React 차트 라이브러리 중 npm 다운로드·GitHub stars 1위) 채택 — `BarChart` (인입/머지 stacked) · `LineChart` (평균 신뢰 점수 추이) 모두 axis · grid · tooltip · legend 표준 제공. /reports 페이지 First Load JS 117KB 증가했지만 운영 메트릭 화면 한정 — 다른 페이지 영향 0. 직접 SVG 컴포넌트 (`MiniBarChart`, `Sparkline`) 제거. 박제 정정 사유: 데이터 양에 따라 적응적으로 시각화하는 비용보다 표준 라이브러리 도입 비용이 낮음 |
| 2026-05-21 | **Phase 10 — 프로젝트별 로드맵 활성화** | docs/ROADMAP.md 같은 구조화된 진척 추적을 Cortex 안에서. `roadmap_phases` (project FK + 사람이 정한 `key`) · `roadmap_items` (phase FK + `doneByPrId`) 두 테이블. PR 본문의 `Closes #PHASE-<key>` / `Closes #ITEM-<id>` (Fixes, Resolves 도 인식) 정규식 매칭으로 머지 시 자동 done. **같은 project 의 phase 만 매칭** — cross-project orphan 방지. 매뉴얼 체크박스 + 상태 select (planned / in-progress / done) 도 같이. `RoadmapBadge` 를 PR 상세에 노출해 어느 phase / item 을 닫는 PR 인지 즉시 보임. 진척 계산: items 가 있으면 done 비율, 없으면 phases.done / phases.total. 시드 / installation 없는 프로젝트도 로드맵 자체는 사용 가능 (자동 done 만 안 작동) |
| 2026-05-22 | **차트 색상 hex 직접 사용 + dark.css 토큰 동기화 (디자인 정책 정정)** | Recharts 가 SVG `fill` attribute 에 CSS `var()` 를 전달하면 일부 브라우저에서 invalid 로 처리해 검정 fallback 으로 그림 (사용자 시그널: "차트가 검은색이라 보기 별로"). 이전 PR #95 의 토큰 교체 시도가 같은 메커니즘으로 또 검정. **정정 결론**: `ReportsCharts.tsx` 에 한정해 hex 직접 사용 (`#93b0f8` 등) + 주석에 대응 `var(--ds-color-*)` 명시. 박제 위반 (인라인 hex 금지) 의 예외 사유: 외부 라이브러리 (recharts) 제약. 다른 컴포넌트는 그대로 `var()` 사용. dark.css 색상이 바뀌면 이 파일 주석을 따라 수동 동기화 |
| 2026-05-22 | **PR #95 squash 머지 일부 commit 누락 — CI 가드 재적용** | GitHub squash 가 PR #95 의 첫 commit 만 머스터 반영하고 후속 2 commit (`fix: PR 상세 CI 가드 + 차트 색상 토큰 정정`, prettier 포맷) 누락. 결과: PR 상세에서 `testsPassed=false` 인 CI 실패 PR 머지 가능 버그가 master 에 남음. PR #97 에 `lib/pr.ts`/`PRActions.tsx`/`ko.ts` 의 CI 가드 ( `testsPassed !== true` + `ciFailed` 메시지) 재적용. 박제: squash 머지가 multi-commit PR 의 일부만 합치는 케이스 점검 필요 |
| 2026-05-22 | **Phase 13.1 — 변경 요청 webhook 자동 Claude CLI spawn** | 사용자 시그널: "변경 요청 이벤트 수신해서 claude cli 로 자동 변경 작업 요청 후 커밋, 푸쉬". 사용자가 변경 요청 시작점이므로 **무한 루프 위험 없음** (Cortex 가 자동으로 변경 요청 안 함). 가드: 요청 작성자 필터 (사용자 본인 + 화이트리스트만 자동), 같은 `head_sha` 당 반복 한계 N회, 프로젝트별 `autoResolveChangesEnabled` 토글 (디폴트 OFF), 실패 시 PR 코멘트 자동 회신. 옵션 (b) "Cortex 자동 검토로 변경 요청 사유 자동 생성" 도 박제. Phase 13 본문에 13.1 절로 상세 |
| 2026-05-22 | **Phase 10 재설계 — `.cortex/` 메타 디렉토리 + 단방향 git sync 우선** | 사용자 시그널 ("깃 리포의 로드맵과 동기화되는 걸 생각했음" + "현재 cortex 진행하는 데 로드맵/진척도를 한눈에 파악하지 못해 불편") 으로 Phase 10 한계가 사용자 immediate pain 으로 부상. **표준 디렉토리 `.cortex/` 채택** (`.github/` 패턴, README/docs 와 충돌 X). `project.yml` (메타 schema v1) + `roadmap.md` (`## Phase <key> — <title>` + `- [x]` 컨벤션) 두 파일로 시작. **용어 확정**: Project Meta / Roadmap / Phase / Item / Progress (Milestone 별도 용어 안 씀). **단계 분할**: 10.1 (단방향 git → Cortex sync, source 컬럼) · 10.2 (push webhook 자동 sync) · 10.3 (대시보드 통합 진척) · 10.4 (양방향, 후순위). 메타 schema 필수 (`schema: 1`) — 누락 시 reject (사용자 실수 덮어쓰기 방지). **Phase 11/12/13 보다 우선 격상**. 양방향은 PR 폭탄·race 위험 커 1차 사용 데이터 본 후 결정 |
| 2026-05-22 | **로드맵 DoD 강화 — 진행 상황 + 남은 작업 + 사용자 검토·수정 필수** | 사용자 시그널 (반복): "로드맵에선 반드시 진행 상황과 남은 작업 목록을 확인할 수 있어야 하고 사용자가 검토 및 수정이 가능해야 함". 1차 출시 (PR #96) UI 는 Phase 카드 + 진척 바 + 체크박스 까지 있지만 "남은 작업 목록 (open items)" 한눈 뷰는 부족. Phase 10.1 의 DoD 에 (a) 프로젝트 + 전체 진척 % (b) **open items 만 모은 명시 리스트** (c) 모든 항목 사용자 toggle/edit/delete 가능 — git source 항목도 source override 모드로 편집 허용 (다음 sync 시 마크다운 갱신 또는 충돌 표기). 단순 시각화 X, 실제 작업 도구로 자리잡아야 함 |
| 2026-05-22 | **Phase 13.2 — 병합 충돌 자동 해결 (Claude CLI)** | 사용자 시그널: "터미널 통합 쪽에 병합 충돌 자동 해결 관련 기능도 검토". 자동 머지 흐름에서 `mergeable_state === 'dirty'` 감지 시 옵션 토글이 ON 이면 `claude` CLI spawn 으로 자동 rebase + conflict resolve + push. 가드: 충돌 hunk 가 N hunk 미만 + diff lines 미만 (큰 충돌은 사람 검토), Cortex 자체 변경 (auto-merge 흐름)에서 발생한 충돌만 자동 (사람 PR 충돌은 사람 결정), 실패 시 PR 코멘트로 사람에게 위임. 의미 충돌 (semantic conflict — 코드는 머지되지만 동작 깨짐) 은 비-목표 (LLM 신뢰도 한계, CI 가 잡아주길 기대) |
| 2026-05-22 | **`/help` 재정의 — 인터랙티브 컨텍스트 도움말 (마무리 단계)** | 사용자 시그널: "도움말 버튼은 눌렀을 때 문서를 보여주는 게 아니라 실제 화면하고 인터랙티브하게 도움을 줄 수 있는 기능". `/help` 라우트 별도 페이지가 아니라 **현재 화면 위에 overlay** — 사이드바·헤더·카드 등 UI 요소에 ?-마커 spotlight + 1줄 설명 + 다음 단계 안내. 가이드 투어 (인박스 첫 진입 시 흐름) + 컨텍스트 도움말 (?-버튼). **실행 시점**: 전체 기능 구현 거의 끝난 마무리 단계 (현재 박제만, 구현은 보류). 사이드바 `/help` 항목은 그 전엔 comingSoon 유지. 사이드바·헤더 미구현 항목 표에서 "최하 우선순위" → "마무리 단계 — 인터랙티브 가이드" 로 재분류 |
| 2026-05-22 | **Phase 10.1 구현 — `.cortex/` 단방향 sync + 자체 yaml/md 파서** | 박제된 설계대로 마이그레이션 0011 (메타 컬럼 + source/sourceOverrideAt) + `lib/project-meta.ts` (자체 mini yaml + markdown 파서) + sync action + UI (동기화 버튼 + Open Items 패널 + git/사용자수정 배지). **새 dependency 0** — yml 파서 자체 구현 (~120줄, schema v1 한정). 사용자가 git source 항목을 UI 에서 toggle/edit 하면 `sourceOverrideAt` 자동 마킹 → 다음 sync 가 덮어쓰지 않음. **남은 작업 (Open Items) 패널** 추가 — 사용자 시그널 "진행 상황 + 남은 작업 목록 + 검토·수정" 직접 반영. Cortex 자기 레포에 `.cortex/project.yml` + `.cortex/roadmap.md` 작성 (dogfood) |
| 2026-05-22 | **Open Items 패널 Phase 그룹 + 토글 + 자동화/다중 디렉토리 박제** | Phase 10.1 출시 후 사용자 시그널: "Phase 별로 클릭했을 때 토글로 펼쳐지면서 상세 내용도 보였으면". 평탄 32 건 리스트 → Phase 별 그룹 (collapsible, open 없는 phase 는 접힘 디폴트). 각 그룹 헤더에 `남은 N / 전체 M` 또는 "모두 완료" + 펼치면 phase goal + items. `OpenItemGroupView` 신규. 추가 사용자 시그널 박제만: (a) **자동화 전략** Phase 10.2 를 page-visit stale-while-revalidate (TTL 5분) + push webhook + 수동 버튼 3층으로 확장. (b) **다중 프로젝트 디렉토리** Phase 10.5 신규 — A (현재 유지) / B (`.cortex/projects/*` 모노 레포 sub) / C (다중 레포) 3 옵션 비교, 1차 권장 A+C, B 는 모노 레포 sub-project 시나리오 명확해진 후 |
| 2026-05-22 | **/projects UX 개편 + 로드맵 drawer + 대시보드 위젯 + 최근 머지 PR 링크** | 사용자 시그널: "프로젝트 페이지 점수 부분 맘에 안 들고 한눈에 안 들어옴 / 로드맵은 페이지 이동이 아니라 노션 스타일 사이드 drawer / 대시보드 프로젝트 위젯 / 최근 머지 clickable". `/projects` 카드 — **Gauge 제거**, 한 줄 통계 (`활성 N · 머지 M · 신뢰 K`) + 진척 바 inline. **RoadmapDrawer** — 카드의 "로드맵 열기" → 오른쪽 사이드 drawer (overlay + ESC 닫기 + 전체 화면 아이콘 → /projects/[id]/roadmap). drawer 내용: 전체 진척 % + Open Items 그룹 토글 (편집은 풀 페이지). **DashboardProjectsWidget** — 대시보드 사이드에 모든 active 프로젝트 진척 바 + open count + slug 클릭 시 로드맵 페이지로. **최근 머지 항목 PR 링크** — `ActivityFeedItem.href` 추가, dashboard feed 가 Link 로 PR 상세 이동 |
| 2026-05-22 | **인박스 '나에게 멘션' 카테고리 활성화 + 사이드바 카운트 정렬** | 사용자 시그널: "인박스 사이드바 비활성화 이제 풀어야 / 사이드바 카운트 정렬 같이". 인박스 rail 의 `mentioned` 카테고리가 데이터 인프라 미구현으로 disabled 였음 — `currentUser.githubLogin` 추가 + PR body `LIKE '%@<login>%'` 단순 매칭 (review comments 매칭은 후속). `categoryHref` mentioned 분기 활성. 사이드바 카운트는 항목별 폭 (배지 vs 텍스트 vs '준비 중') 이 달라 우측 끝선 어긋남 → 모두 chip 형태 통일 (min-width 28px + 같은 padding) + 배지 색만 다름 |
| 2026-05-22 | **PR #100 squash 머지 일부 commit 누락 — 재적용** | PR #100 의 두 번째 commit (`fix: PR 동기화 라벨 + Open Items 전체 표시 + 항목↔PR 링크 + ON/OFF 라벨`) 이 squash 머지 시 master 누락. 결과: `state='open'` (closed/merged PR 갱신 안 함) · `OpenItemGroupItem`/`doneByPrNumber` 없음 · 자동 머지 ON/OFF 라벨 없음 · Open Items 펼침 시 done 안 보임 — 모두 master 에 stale. PR #95 와 동일 패턴 반복. 이번 PR (10.2) 에 다시 적용. 박제: GitHub squash 가 multi-commit PR 의 후속 commit 누락하는 케이스 — branch 의 모든 commit 들이 squash 응답에 들어가는지 머지 후 master diff 확인 필요 |
| 2026-05-22 | **Phase 10.2 — 자동 sync 3층 + 브라우저 Notification** | 사용자 시그널 묶음: (a) "매번 수동 동기화 불편" → 자동화 3층 (page-visit stale-while-revalidate TTL 5분 / push webhook 의 `.cortex/` 변경 감지 / 수동 버튼 유지). (b) "PR 발생하면 브라우저에서 알림" → `events.notification` SSE 채널 추가, `WebhookListener` 가 `Notification.requestPermission` + show. `NotificationDropdown` 헤더에 권한 요청 버튼 (default/granted/denied 3 상태). webhook 만으로는 첫 접근 시 stale 가능 → page-visit 으로 보완. 브라우저 권한은 user gesture (드롭다운 클릭) 후 요청 — 자동 prompt X (UX 부담) |
| 2026-05-22 | **Phase 11 + Phase 12 병렬 묶음 PR + UI 폴리시** | 사용자 시그널: "다음 최대한 병렬로 많이 진행할 수 있는 PR 들 식별 후 한번에 처리". 의존성 그래프 분석 결과 Phase 11 (TODO) · Phase 12 (로컬 워크스페이스) 가 schema 만 공유 (단일 마이그레이션 0012) + UI 영역 독립 (`/todos` vs 프로젝트 카드) → 같은 PR 로 묶기. **Phase 11**: `todos` 테이블 + CRUD lib + `/todos` 페이지 + 사이드바 NavItem + 대시보드 위젯 (top 5 open). **Phase 12**: `workspaces` 테이블 + path validation (절대 경로, 디렉토리, .git 마커, `..` 거부) + `child_process.spawn('git', [...])` 실행 (보안 박제: shell 안 씀, 고정 인자, 30s timeout, `GIT_TERMINAL_PROMPT=0`, 출력 500자 cap). 동시 폴리시: (1) **브라우저 알림 권한 버튼 → ON/OFF chip 토글** (사용자 시그널 "글자 너무 큼") (2) **대시보드 위젯 meta 텍스트 11px→10px** (사용자 시그널 "남은 건 수 글자 너무 큼"). `confirm()` 박제 위반 회피 — 워크스페이스 등록 해제는 inline confirm panel |

---

## 빠른 시작 명령 (Phase 0 후)

```bash
# 1회
npm install
npm run db:migrate
npm run db:seed

# 매번
npm run dev          # http://localhost:3000
npm run test         # vitest
npm run lint
npm run typecheck
```

(이 명령들은 Phase 0에서 `package.json`에 정의)

---

## 사이드바·헤더 미구현 항목 (작업 매핑)

### 사이드바 미구현 라우트

| 항목 | Phase | 작업 내용 |
|---|---|---|
| `/reports` (보고서) | Phase 7 | 자동 머지율 · revert율 · 신뢰 점수 시계열 메트릭. 대시보드 stat delta(#50) 의 깊은 버전 |
| `/projects` (프로젝트) | Phase 8 | 인테이크 마법사. 레포 등록 · 자동 머지 토글 · 레포별 메트릭 |
| `/agents` (에이전트) | **Phase 13 으로 이관** | `agent_runs` schema 는 있지만 Claude Code CLI 세션 매니저로 재정의. Phase 13 (터미널 임베드) 의 일부 — 별도 Phase 로 두지 않음 |
| `/help` (도움말) | **마무리 단계 — 인터랙티브 가이드** | 별도 문서 페이지 X. 화면 overlay 로 실 UI 요소에 spotlight + 컨텍스트 설명. Phase 14 (가칭) 또는 모든 기능 구현 끝난 마무리 단계 진입 — 그 전엔 comingSoon 유지. 상세는 `## /help — 인터랙티브 도움말 (Phase 14)` 섹션 |

### 헤더 액션 미구현

| 항목 | Phase | 작업 내용 |
|---|---|---|
| **알림** (대시보드·인박스) | Phase 7 | `notifications` 테이블 + SSE/poll. 머지·CI 실패·새 클러스터 이벤트 → 토스트 + 배지 |
| **새 이슈** (대시보드) | **Phase 13 으로 이관** | `issues` 테이블 schema 만 있고 사용 없음. 이슈 작성 시 'Claude Code 에게 위임' 토글 ON 이면 즉시 CLI 세션 spawn. "에이전트 시작" 과 한 묶음 |
| **에이전트 시작** (대시보드) | **Phase 13 으로 이관** | PR/이슈 컨텍스트로 `claude` CLI spawn — Cortex 가 직접 API 호출 안 함 (사용자 Claude plan 사용, 크레딧 0). `agent_runs` 에 세션 기록 |

ROADMAP §0 의 "Cortex = oversight layer" 원칙상 **에이전트 · 새 이슈 · 에이전트 시작** 은 외부 에이전트 통합이 명확해진 후 마지막에 진입. 이전엔 'Phase 8 후속' 으로 두었으나 **Cortex 가 Claude API 를 직접 호출하지 않고 `claude` CLI 를 spawn 하는 방향** 이 정해지면서 (Phase 13) 모두 Phase 13 에 흡수. 현재는 GitHub PR 만 받는 흐름이 메인.

---

## Phase 10 — 프로젝트 메타데이터 + 로드맵 (git 동기화)

> Cortex 가 다루는 각 레포의 메타데이터·로드맵·진척도를 git repo 의 `.cortex/` 디렉토리와 동기화. PR 흐름과 별개로 "이 프로젝트가 어디까지 왔는지" + "어떤 프로젝트인지" 를 한눈에 파악.

### 1차 출시 진척 (PR #96 — 머지됨)

- `roadmap_phases` · `roadmap_items` 테이블 + 마이그레이션 0010
- `/projects/[id]/roadmap` 페이지 — Phase 카드 + 산출물 체크박스 + 진척 바
- `lib/roadmap.ts` — CRUD + PR 본문 `Closes #PHASE-<key>` / `Closes #ITEM-<id>` 매칭 (`Fixes`, `Resolves` 인식)
- 머지 hook — `attemptAutoMerge` / `attemptHumanMerge` 성공 시 자동 done 전환 (`doneByPrId` 기록)
- 프로젝트 카드에 진척 바 + "로드맵" 액션 행
- PR 상세에 `RoadmapBadge` — 연결된 phase / item + auto-done 배지

### 1차 출시 한계 (사용자 시그널 2026-05-22)

- 사용자가 Cortex UI 에 별도 등록해야 함 → "비어있다" 인지 부조화
- git repo 의 docs/ROADMAP.md 같은 단일 source of truth 와 분리
- "로드맵 한눈 파악" 이 목적인데 UI 에 빈 화면만 보임

→ 사용자 immediate pain (2026-05-22): *"현재 cortex 진행하는 데 로드맵 및 진척도를 한눈에 파악하지 못하고 있어서 불편"*. **Phase 11/12/13 보다 우선 격상**.

---

### 용어 (확정)

| 용어 | 정의 |
|---|---|
| **Project Meta** | 프로젝트 정체성 + 정책 (`.cortex/project.yml`). name · kind · domain · tech stack · automation 정책 · links |
| **Roadmap** | 프로젝트의 Phase 들 + 각 Phase 의 Item 들 (`.cortex/roadmap.md`) |
| **Phase** | 의미 있는 마일스톤. `key` (PR 매칭 식별자) + title + goal + status (planned/in-progress/done) + items |
| **Item (산출물)** | Phase 안의 체크박스 한 줄. title + status + (자동) doneByPrId |
| **Progress (진척도)** | Item 들의 done 비율 (items 0 이면 Phase 의 done 비율). 0~100 정수 % |
| **Milestone** | **별도 용어 사용 안 함** — Phase 와 같은 의미. 혼란 회피 |

---

### `.cortex/` 디렉토리 컨벤션

표준 위치: 각 레포의 **루트 `.cortex/` 디렉토리** (`.github/` 처럼 도구 전용 공간).

```
.cortex/
  project.yml      # 프로젝트 메타데이터 — Cortex 가 정체성·정책 읽음
  roadmap.md       # 로드맵 — Phase + Items
```

**왜 `.cortex/`**:
- 사용자가 작성한 `README.md` · `docs/` 와 충돌 X
- 향후 추가 파일 자연 (alerts.yml, agents.yml, owners.yml 등)
- 사용자가 `.gitignore` 안 하면 자연 동기화

---

### `.cortex/project.yml` schema (v1)

```yaml
schema: 1                       # 메타 schema 버전 — 깨지는 변경 시 증가
name: project-cortex            # 표시명 (UI 헤더)
slug: sksskdf/project-cortex    # GitHub owner/repo — projects.slug 와 동일
description: AI 코드 게이트키퍼   # 한 줄 소개 (대시보드 카드)
kind: web-app                   # web-app | cli | library | mobile | docs | infra
status: active                  # active | maintenance | archived
domain: code-review             # 도메인 자유 텍스트 (포렌식, 결제 등)
owners:
  - sksskdfg123                 # GitHub 계정 (단일 사용자 가정이라 보통 1명)
tech:
  language: TypeScript
  framework: Next.js 15
  database: SQLite
links:
  homepage: https://...         # 옵션
  docs: https://...             # 옵션
  issue_tracker: github         # github | linear | jira | none
# Cortex 동작 정책 — 기존 projects.autoMergeEnabled 등이 이쪽으로 이전 (옵션).
# 파일이 없거나 필드 누락 시 DB 값 사용 (양립 가능).
automation:
  auto_merge: true              # autoMergeEnabled
  ai_review: true               # 글로벌 settings.aiEnabled 와 별개로 프로젝트 단위 override
  auto_resolve_changes: false   # Phase 13.1 — 변경 요청 자동 처리
```

**파싱 규칙**:
- `schema` 필드 필수 — 누락 시 reject (기본값 가정으로 사용자 실수 덮어쓰기 방지)
- 알려지지 않은 필드는 무시 (forward compat)
- 모든 필드 optional 제외 `schema` · `name` · `slug`

---

### `.cortex/roadmap.md` 컨벤션

```markdown
# Roadmap

## Phase auth — 인증 시스템

목표: OAuth 2.0 + JWT 기반 단일 로그인 흐름.

- [x] OAuth 2.0 provider 연동
- [x] JWT 토큰 발급
- [ ] 2FA 추가
- [ ] Session 만료 정책

## Phase launch — 출시 준비

- [ ] 결제 통합
- [ ] 운영 메트릭 대시보드
```

**파싱 규칙**:
- `## Phase <key> — <title>` → `roadmap_phases` row (key + title 추출)
- `## Phase <key>` (separator 없음) 도 허용 → title = key
- 첫 단락 (heading 다음 ~ 첫 list 전) → `goal` 필드
- `- [x] <text>` → `roadmap_items` (status=done)
- `- [ ] <text>` → `roadmap_items` (status=planned)
- 빈 줄 등 자유 형식 허용 — 매칭 안 되는 라인은 무시
- 같은 `key` 가 여러 번 나오면 첫 번째만 채택

**`Closes #PHASE-<key>` / `Closes #ITEM-<id>` 매칭은 PR #96 흐름 그대로** — `key` 는 git 파일에서 추출된 것 또는 사용자가 수동 추가한 것 무관.

---

### 단계적 도입

#### Phase 10.1 — 메타 + 로드맵 단방향 git → Cortex 동기화 (구현 1순위) — **머지 진척 중**

**진척**
- 마이그레이션 0011 — `projects` 메타 컬럼 (description/kind/domain/homepage/meta_synced_at) + `roadmap_phases.source` · `roadmap_items.source` · `sourceOverrideAt`
- `src/lib/project-meta.ts` — 자체 mini yaml 파서 (schema v1) + 마크다운 파서 (`## Phase <key> — <title>` + `- [x]`) + `syncProjectFromGit`
- `src/lib/github.ts` — `getRepoFileContent` 헬퍼 (GitHub Contents API, 404 처리)
- `src/actions/project-meta.ts` — `syncProjectMetaAction` Server Action
- `src/components/RoadmapSyncButton.tsx` — "동기화" 버튼 + 결과 메시지
- `src/components/RoadmapOpenItems.tsx` — **남은 작업 패널** (사용자 시그널 직접 반영)
- `RoadmapBoard` Phase 카드 + Item 행에 `SourceBadge` (git / 사용자 수정)
- 사용자가 git 행 toggle/status 변경 시 `sourceOverrideAt` 자동 마킹
- Cortex 자기 레포 `.cortex/project.yml` + `.cortex/roadmap.md` 작성 (dogfood)
- 14 단위 테스트 추가 (yml/md parser)



**산출물**
- 마이그레이션:
  - `projects` 테이블에 메타 컬럼 추가 (`description`, `kind`, `domain`, `homepage` 등)
  - `roadmap_phases` · `roadmap_items` 에 `source` 컬럼 (`'git' | 'manual'`)
  - `projects.meta_synced_at` (마지막 sync 시각)
- `lib/project-meta.ts`:
  - `parseProjectYml(content)` — yml 파싱 + schema 검증
  - `parseRoadmapMd(content)` — 마크다운 파서 (자체 구현, 새 dep 없음)
  - `syncProjectFromGit(projectId)` — GitHub Contents API 로 `.cortex/project.yml` + `.cortex/roadmap.md` fetch → upsert
- `/projects/[id]/roadmap` 페이지 (사용자 시그널 필수 — *"진행 상황과 남은 작업 목록을 확인할 수 있어야 하고 사용자가 검토 및 수정이 가능해야 함"*):
  - **전체 진척 % + Phase 별 진척 바** — 한눈에 어디까지 왔는지
  - **남은 작업 (Open Items) 명시 패널** — `status !== 'done'` items 만 모은 평탄 리스트. Phase별 그룹핑 옵션
  - **모든 항목 사용자 검토 + 수정** — git source 항목도 편집 가능. 편집 시 `source_override='manual'` 마크 → 다음 sync 시 마크다운 갱신 (Phase 10.4 양방향) 또는 충돌 표기
  - git 항목엔 "git" 배지 (origin 추적), 편집 시 "사용자 수정" 배지 추가
- "프로젝트 메타 동기화" 액션 (`/projects` 카드 또는 `/projects/[id]/roadmap` 헤더)
- 자동 trigger:
  - **첫 onboard 시 자동 1회 sync** (이미 있는 `/projects` 카드 진입 시 백그라운드)
  - 사용자가 수동 `.cortex/` push 후엔 명시 sync 또는 webhook (Phase 10.2)

**DoD** (사용자 요구사항 직접 반영)
- Cortex 자신의 레포에 `.cortex/project.yml` + `.cortex/roadmap.md` 작성 후 동기화 → `/projects/[id]/roadmap` 이 즉시 채워짐
- **진행 상황**: 화면 상단에 전체 진척 % + 각 Phase 진척 바 + done/total item 카운트 즉시 가시
- **남은 작업**: open items 만 모은 명시 리스트가 화면에 항상 노출 (Phase 카드와 별개 패널)
- **사용자 검토·수정**: 모든 item 의 status toggle + title 수정 + 삭제 + 추가가 git/manual 무관 가능 (git 항목 수정 시 source_override 마크)
- git 의 `- [x]` 가 Cortex UI 에 done 상태로 보임
- 사용자가 git 파일을 직접 수정해서 PR 머지 → 다음 sync 시 반영 (단, 사용자가 Cortex UI 에서 source_override 한 항목은 sync 가 덮어쓰지 않고 충돌 배지로 표시)

**의존성**: GitHub App `Contents: read` 권한.

**핵심 파일**
```
src/db/schema.ts                  ← projects 메타 컬럼 + roadmap.source
src/db/migrations/0011_*.sql
src/lib/project-meta.ts           ← yml/md 파서 + sync
src/lib/roadmap.ts                ← source='git' 인 항목 readonly 처리
src/actions/project-meta.ts       ← syncProjectMetaAction
src/app/projects/[id]/roadmap/page.tsx  ← "동기화" 버튼 + readonly 배지
```

#### Phase 10.2 — `.cortex/` 자동 동기화 + 브라우저 알림 (구현 2순위) — **머지 진척 중**

**진척**
- `push` webhook 자동 sync — `.cortex/` 시작 path 변경 + default branch + `handlePushEvent` → `syncProjectFromGit`
- page-visit stale-while-revalidate — `backgroundSyncIfStale(projectId)` (TTL 5분)
- 수동 "PR 동기화" 버튼 유지 + state='all' 로 closed/merged 도 갱신
- **브라우저 Notification** (사용자 시그널 "PR 발생하면 브라우저에서 알림"): `events.notification` SSE 채널 + `WebhookListener` 가 Notification API 호출. NotificationDropdown 에 권한 요청 버튼

사용자 시그널 (2026-05-22): *"매번 수동으로 동기화 하는 것보단 .cortex 폴더를 감시하는 등 자동화 전략이 필요"*. 세 층으로 박제:

1. **page-visit stale-while-revalidate** — `/projects/[id]/roadmap` 진입 시 `metaSyncedAt` 가 TTL (예: 5 분) 보다 오래됐으면 백그라운드로 `syncProjectFromGit` 호출. 사용자가 "동기화" 버튼 누를 필요 없음. 첫 진입 시에도 자동.
2. **push webhook 자동 sync** — `push` event 의 `commits[].modified` 에 `.cortex/` 시작 경로 있으면 default branch 한정으로 sync. AI 분석 트리거 X (메타 변경은 PR 분석과 별개).
3. **수동 "동기화" 버튼 유지** — 사용자가 강제로 트리거하고 싶을 때 (push webhook 누락 또는 즉시 갱신 필요).

GitHub API rate limit 영향: page-visit sync 는 TTL 로 보호, webhook sync 는 자연 발생량.

#### Phase 10.5 — 다중 프로젝트 디렉토리 전략 (가설, 사용용)

사용자 시그널 (2026-05-22): *"프로젝트가 여러개로 늘어났을 경우 관리할 전략 — 현재는 `.cortex` 밑에 바로 프로젝트랑 로드맵이 들어가 있잖아"*.

| 옵션 | 구조 | 적합 시나리오 | 비고 |
|---|---|---|---|
| **A. 현재 유지 (1 레포 = 1 프로젝트)** | `.cortex/{project.yml, roadmap.md}` | 단일 레포가 단일 프로젝트 | 가장 단순. 모노 레포면 roadmap.md 안에 sub-package 별 `## Phase agent` 식으로 표현 |
| **B. `.cortex/projects/` 다중** | `.cortex/projects/{name}/{project.yml, roadmap.md}` + root `.cortex/project.yml` (메타 모노 레포 자체) | 모노 레포 (`dfasee2` 서브모듈 3개 등) — 각 sub 별 독립 진척 | Cortex DB 에 `projects` row 가 sub 마다 추가됨. slug = `repo/sub` |
| **C. 다중 레포 (현 패턴 유지)** | 각 레포가 자기 `.cortex/` | 6 개 레포 시나리오 | 다중 GitHub App installation 으로 이미 지원. Cortex `projects` row 가 레포마다 |

**1차 권장 — 옵션 A 유지 + 옵션 C** (현 동작). 모노 레포 sub-project 가 명확해진 후 옵션 B 진입 (Phase 10.5).

**옵션 B 의 변경 사항** (진입 시):
- `lib/project-meta.ts` 의 `syncProjectFromGit` 가 `.cortex/projects/*` 디렉토리 listing → 각 sub 마다 별도 project row upsert
- `projects.parentSlug` 컬럼 추가 (sub project 관계 추적)
- UI: `/projects` 에서 parent 프로젝트 아래 sub 카드 grouping
- PR 매칭: `Closes #PHASE-agent/auth` (sub 식별자) 형식 검토

**비-목표 (옵션 B)**:
- 임의 깊이 nested (`.cortex/projects/a/sub/x`) — 1 레벨만
- sub project 의 별도 GitHub installation — 같은 installation 공유

#### Phase 10.3 — 대시보드 통합 진척 (구현 3순위, 사용자 immediate pain)

- 대시보드에 모든 프로젝트의 진척 한눈 보기 (현재는 `/projects` 가야 보임)
- 사용자 시그널: "현재 cortex 진행하는 데 로드맵 및 진척도를 한눈에 파악하지 못하고 있어서 불편"
- 옵션:
  - (a) 대시보드 한 섹션에 프로젝트 진척 카드 row (project name + 진척 바 + 다음 Phase)
  - (b) 사이드바 `/projects` hover preview (덜 침해적)
- 1차 권장 (a) — 명시적 노출

#### Phase 10.4 — 양방향 sync (옵션, 후순위)

- Cortex UI 의 토글이 git 파일 mutation PR 자동 생성
- 사용자가 직접 머지 → Cortex 가 재 sync
- 무한 sync 방지: PR 본문 marker (`cortex: roadmap update`) 인식
- **위험**: PR 폭탄, race condition (사용자 동시 편집), 충돌 해결 복잡
- 1차 사용 데이터 본 후 진입 결정. 단방향만으로 충분할 가능성 있음

---

**비-목표 (Phase 10 전체)**
- 별도 PM 도구 (Jira · Linear · Asana) 대체 — Cortex 는 git 워크플로우 중심
- 다른 사용자에게 공유 (단일 사용자 가정 유지)
- 임의 마크다운 형식 지원 (위 컨벤션 강제)
- 양방향 conflict 자동 해결 (사용자가 git 직접 수정 시 Cortex DB 덮어쓰지 않음)
- 메타 schema v1 외 다중 버전 동시 지원 (v2 들어오면 v1 row 마이그레이션 + drop)

**우선순위** — Phase 10.1 → 10.3 → 10.2 → 10.4 순. **Phase 11/12/13 보다 우선** (사용자 immediate pain).

---

## Phase 11 — 개인 생산성 통합 (TODO · 캘린더 · 노트)

> 사용자가 노션에 기록하던 일상 작업·일정·메모를 Cortex 안으로.

**배경** — Cortex 가 단일 사용자의 데일리 도구가 되려면 코드 워크플로우만으론 부족. 기존 노션 기록 패턴을 참고해 가벼운 PIM (Personal Information Management) 통합. 외부 PM 도구를 띄우지 않고 Cortex 한 화면에서 PR 결정 + 다음 할 일 메모가 가능해야 함.

**산출물**
- `todos` 테이블 — 한 줄 작업, 우선순위, due date, 연결된 PR/프로젝트 (optional FK).
- `notes` 테이블 — 자유 마크다운 메모, 태그, 연결된 PR/프로젝트.
- `events` 테이블 또는 todos.dueAt 만으로 간단 캘린더 (별도 객체로 늘리지 않음).
- **`/inbox/todos` 또는 사이드바 todo 위젯** — 인박스 옆에 보이는 가벼운 위젯.
- **`/notes` 화면** — 노션 디비 스타일 (목록 + 상세). 단순한 markdown 편집.

**핵심 파일**
```
src/db/schema.ts                       ← todos · notes 추가
src/lib/todos.ts · src/lib/notes.ts
src/app/notes/page.tsx · src/app/notes/[id]/page.tsx
src/components/TodoWidget.tsx          ← 사이드바 또는 인박스 보조 위젯
```

**비-목표**
- 노션·Linear 와 동기화 (양방향 sync 운영 복잡).
- 풀-페이지 협업 편집 (yjs · CRDT 등) — 단일 사용자 가정.
- 풍부한 캘린더 뷰 (월/주 등) — 처음엔 due 가 있는 todo 의 목록 정렬만.

**우선순위** — Phase 10 후. PR 흐름이 안정되면 도구 사용 빈도가 높은 사용자가 자연스럽게 노션 → Cortex 로 옮길 수 있도록.

**진척 (2026-05-22)** — 1차 통합 완료. `todos` 테이블 + `/todos` 페이지 + 대시보드 위젯 + 사이드바 카운트 + Server Actions (create/toggle/update/delete) + 9개 단위 테스트. priority (low/normal/high) · due date · status (open/in-progress/done) 지원. 연결된 PR / Project 메타 표시. `notes` · `events` 는 후속 (사용 데이터 본 뒤).

---

## Phase 12 — 로컬 워크스페이스 지원

> 사용자의 로컬 머신 컨텍스트 (`C:\dev\projects` 등) 를 Cortex 가 1급으로 다룸.

**배경** — Phase 8 의 인테이크가 GitHub 레포 메타만 다룸. 사용자가 로컬 클론·작업하는 파일·실행 중인 dev 서버 같은 컨텍스트도 한 화면에서 참조하고 싶음.

**산출물 (가설)**
- 로컬 워크스페이스 경로 등록 (`workspaces` 테이블 — projects FK + local path)
- 파일 시스템 watcher 또는 on-demand read — 현재 작업 중인 브랜치/파일 노출
- PR 상세에서 "로컬 클론으로 열기" 액션 (IDE 핸들러 또는 cli 명령)
- 보안 — 로컬 경로 접근은 사용자 명시 등록한 워크스페이스만 (sandbox)

**비-목표 (이 Phase 에서도)**
- 다른 머신과 동기화 — 단일 머신·단일 사용자 가정.
- 임의 파일 시스템 탐색 — 등록된 워크스페이스 안으로 제한.

**우선순위** — Phase 11 후. 데이터 플로우가 안정되면 도구의 입력 표면을 확장.

**진척 (2026-05-22)** — 1차 통합 완료. `workspaces` 테이블 + 프로젝트 카드 안 `WorkspaceCard` (등록 form + git pull 버튼 + 마지막 결과 표시). `lib/workspace.ts` 에서 path validation (절대 경로, 존재, 디렉토리, .git 마커, `..` 거부) + `child_process.spawn('git', [...])` 실행. **보안 박제**: (1) shell 안 씀 (spawn 직접 호출, 임의 명령 X) (2) git CLI 만 + 고정 인자 (`fetch --all --prune`, `pull --ff-only`) (3) cwd 는 등록된 워크스페이스의 localPath 만 (4) 30 초 timeout + `GIT_TERMINAL_PROMPT=0` (credential prompt 차단) (5) 출력 마지막 500자만 저장 (DB 비대화 방지). Phase 13 (Claude CLI spawn) 에서 동일 화이트리스트 패턴 재활용.

---

## Phase 13 — Claude CLI 통합 (터미널 임베드 + /agents 통합)

> Cortex 안에서 Claude Code CLI 를 실행해 PR/이슈 → 코드 작업까지 한 흐름.
> /agents · '에이전트 시작' · '새 이슈' 가 Phase 8 후속에서 **Phase 13 의 일부** 로 재분류 (검토 후 결정).

**배경** — 현재는 Cortex 가 GitHub PR 만 받음. 사용자가 변경 요청·디버그 같이 추가 작업이 필요하면 별도 터미널/IDE 로 가서 Claude Code 실행 → 다시 Cortex 로 돌아옴. 컨텍스트 스위치 비용. Cortex 가 터미널 패널을 임베드하면 한 화면에서 끝남.

**기술적 검토 결과**

| 항목 | 결정 |
|---|---|
| **터미널 UI** | **xterm.js** + **node-pty** (서버 PTY) + WebSocket. 새 dependency 3개 — 진입 시 사용자 승인 |
| **보안 모델** | **(a) Cortex 가 `claude` CLI 직접 spawn — 명령 화이트리스트** 선택. 근거: Cortex 가 localhost only 단일 사용자 가정 (Decision Log 박제) → 외부 노출 0. spawn 대상 `claude`/`claude-code` 만 허용. 작업 디렉토리는 Phase 12 의 등록된 워크스페이스 안으로 제한 |
| **비-목표 옵션** | (b) 사용자 별도 터미널 attach — 통제 강함이지만 사용자 흐름 무거움. (c) 클립보드 복사 — 가장 안전하지만 마찰 큼 |
| **Pro/Max plan** | Cortex 가 직접 호출 안 함 — `claude` CLI 가 사용자 plan 사용. API key 크레딧 0 |

**산출물** (Phase 8 후속이었던 /agents · 에이전트 시작 · 새 이슈 흡수)

- **`/agents` 페이지** — Claude Code 세션 관리. 실행 중 · 과거 · 로그. `agent_runs` 테이블 schema 는 이미 있음 — Claude CLI spawn 결과로 채움
- **터미널 임베드** — 사이드 패널 또는 모달. xterm.js. PR 상세 / `/agents` / 이슈 화면에서 접근
- **'에이전트 시작' (대시보드 헤더)** — PR/이슈 컨텍스트와 함께 `claude` CLI spawn. PR 의 경우 URL + diff + 변경 요청 사유 prompt 자동 구성
- **'새 이슈' (대시보드 헤더)** — Cortex 내부 `issues` 테이블 작성 + **'Claude Code 에게 위임' 토글** 옵션. 토글 ON 이면 즉시 Claude CLI 세션 spawn
- **PR 상세 '변경 요청' 후속 액션** — 사유 입력 후 [Claude Code 로 수정 위임] 버튼 추가. PR 컨텍스트 자동 prompt
- **출력 감지** — Claude 가 새 PR push 하면 Cortex webhook 으로 자연 진입. 세션 ↔ PR 매칭은 head_sha 또는 작업 디렉토리로

**통합 흐름 예시**

```
PR 상세 → 변경 요청 → 사유 입력
  → [Claude Code 로 수정 위임]
  → claude CLI spawn (PR URL + 사유 + diff context)
  → /agents 에서 세션 진행 모니터링
  → Claude 가 코드 수정 후 push
  → Cortex webhook → 재분석 → 자동 머지 후보

새 이슈 작성
  → 'Claude Code 에게 위임' 토글 ON
  → claude CLI spawn (이슈 spec)
  → 결과 PR 생성 시 Cortex webhook 으로 인박스 진입
```

### 13.1 — 변경 요청 webhook 자동 처리 (옵션)

> 사용자 시그널 (2026-05-22): "변경 요청 이벤트 수신해서 claude cli 로 자동으로 변경 작업 요청 후 커밋, 푸쉬해서 해결".

**전제** — 변경 요청은 **사용자가 직접** 보냄 (Cortex 자동 변경 요청 X). 그러므로 무한 루프 위험 없음 (Cortex 가 자기 출력을 다시 거절하는 흐름 비존재).

**산출물**
- `pull_request_review` webhook 의 `state=CHANGES_REQUESTED` 수신 → 프로젝트 토글이 ON 이면 자동 처리
- 변경 요청 본문 (review body) + diff + PR 컨텍스트로 `claude` CLI spawn
- Claude 가 작업 후 자동 `git commit` + `git push` → Cortex webhook 으로 자연 재진입
- `agent_runs` 에 세션 기록 (시작 review id + 결과 commit sha)

**사유 작성 옵션** (변경 요청 버튼 누른 후):
- (a) **사용자 직접 작성** — 기본. 현재 흐름과 동일
- (b) **Cortex 자동 검토 → 사유 자동 생성** — PR 분석 결과 (preReview + 위험 플래그) 를 LLM 으로 요약해 변경 요청 사유 초안 자동 작성. 사용자가 확인/편집 후 전송

**가드 (박제할 것)**:

| 항목 | 결정 |
|---|---|
| **요청 작성자 필터** | 사용자 본인 + 화이트리스트만 자동 처리. 외부 사람 변경 요청은 자동 spawn 안 함 (사람 검토 필요) |
| **반복 한계** | 같은 PR 의 `head_sha` 당 자동 처리 N회 (예: 3회). 한계 초과 시 사람 개입 알림. 자원 폭주 방지 |
| **자동/수동 토글** | 프로젝트별 `autoResolveChangesEnabled` 컬럼 — `autoMergeEnabled` 와 같은 패턴. 디폴트 OFF (사용자 명시 ON) |
| **timeout / 실패 처리** | claude CLI 실패 / 시간 초과 시 알림 + PR 코멘트로 실패 사유 자동 회신 |
| **무한 루프** | **위험 없음** — Cortex 가 자동 변경 요청을 보내지 않음. 다만 옵션 (b) 의 Cortex 자동 검토가 머지된 코드를 다시 거절하는 흐름이 안 생기도록 한 PR 당 1회만 발화 |

**통합 흐름**:
```
사용자 → GitHub 또는 Cortex 에서 변경 요청 + 사유
  → pull_request_review webhook (state=CHANGES_REQUESTED)
  → 토글 ON + 작성자 화이트리스트 + 반복 한계 미만 확인
  → claude CLI spawn (사유 + PR URL + diff)
  → Claude 가 수정 + git commit + git push
  → Cortex 가 PR 갱신 webhook 으로 재진입 → 재트라이아지
  → 자동 머지 후보 또는 다음 라운드 변경 요청 대기
```

**비-목표 (13.1)**
- Cortex 가 자동으로 변경 요청을 발화 — 사람 시작점 유지
- 머지된 PR 의 코드를 사후 자동 수정 (closed/merged PR 은 자동 처리 안 함)

### 13.2 — 병합 충돌 자동 해결 (Claude CLI)

> 사용자 시그널 (2026-05-22): "터미널 통합 쪽에 병합 충돌 자동 해결 관련 기능도 검토".

**배경** — 자동 머지 흐름 (Phase 5.4) 에서 `mergeable_state === 'dirty'` (base 와 충돌) 가 발생하면 현재는 사람이 직접 rebase + conflict resolve 해야 함. Cortex 가 게이트키퍼인데 충돌 처리는 게이트 밖. Claude CLI 가 통합되면 자동 처리 가능 — 사람 검토 없이도.

**산출물**
- `attemptAutoMerge` 가 GitHub 에서 `dirty` 응답 받으면 옵션 토글 (`autoResolveConflictsEnabled`) ON 인 프로젝트에 한해 `claude` CLI spawn
- 작업 디렉토리: Phase 12 로 등록된 워크스페이스에서 `git fetch + git checkout <head> + git rebase <base>`
- 충돌 hunk 를 Claude 에게 prompt — base/head 양쪽 변경 의도 + 우선순위 설명
- Claude 가 resolve 후 `git rebase --continue` + `git push --force-with-lease`
- Cortex 가 PR 갱신 webhook 으로 자연 재진입 → 자동 머지 재시도
- `agent_runs` 에 충돌 해결 세션 기록 (시작 SHA + 결과 SHA + LLM 판단 사유)

**가드 (박제할 것)**

| 항목 | 결정 |
|---|---|
| **충돌 크기 한계** | 충돌 hunk N 미만 + diff lines M 미만에서만 자동. 큰 충돌은 사람 검토 (의도 충돌 가능성 큼) |
| **자동 적용 대상** | Cortex 의 auto-merge 흐름에서 생긴 PR 만. 사람이 만든 PR 의 충돌은 자동 X (사람 결정 우선) |
| **실패 처리** | rebase 실패 또는 LLM resolve 신뢰도 낮음 → PR 코멘트로 사람에게 위임 + alert 알림 |
| **force-push 안전** | `--force-with-lease` 만 사용 — 사람이 그 사이 push 한 commit 유실 방지 |
| **프로젝트 토글** | `autoResolveConflictsEnabled` (디폴트 OFF). `.cortex/project.yml` 의 `automation.auto_resolve_conflicts` 와 연동 |

**통합 흐름**
```
auto-merge 시도 → GitHub: mergeable_state=dirty
  → 토글 ON + 충돌 크기 한계 미만 확인
  → claude CLI spawn (rebase + conflict resolve prompt)
  → Claude 가 resolve + git push --force-with-lease
  → Cortex 가 PR 갱신 webhook 으로 재진입 → 자동 머지 재시도
```

**비-목표 (13.2)**
- 의미 충돌 (semantic conflict — 코드는 합쳐지지만 동작 깨짐) 자동 해결 — LLM 신뢰도 한계. CI 가 잡아주길 기대 (CI 실패 시 어차피 자동 머지 차단)
- 양쪽이 같은 줄을 의도적으로 다르게 수정한 케이스 — 사람 판단 필수
- 사람 PR 의 충돌 — 사용자 결정 우선이라 자동 X

**비-목표**
- Cortex 자체가 Claude Code 를 대체 — 코드 작성은 Claude CLI 가 함, Cortex 는 게이트키퍼 + 세션 매니저
- 임의 shell 명령 노출 — 화이트리스트 (`claude`/`claude-code`) 외 spawn 금지
- 다중 에이전트 (Devin/Codex) 통합 — Decision Log 박제대로 Claude 단일

**의존성**
- Phase 12 (로컬 워크스페이스) 의 워크스페이스 등록이 spawn 작업 디렉토리 화이트리스트 입력으로 활용
- Phase 4.5 의 Anthropic API key 결제 흐름과 별개 — 사용자 Claude plan 으로 spawn

**우선순위** — Phase 12 후. 로컬 워크스페이스가 등록되어 있어야 의미 있음. Phase 8 의 /agents 구현은 Phase 13 에 흡수됨.

---

## Phase 14 — `/help` 인터랙티브 도움말 (마무리 단계)

> 사용자 시그널 (2026-05-22): "도움말 버튼은 눌렀을 때 문서를 보여주는 게 아니라 실제 화면하고 인터랙티브하게 도움을 줄 수 있는 기능이었으면 좋겠어. 도움말 기능은 전체적인 기능 구현이 끝나고 마무리 단계에 수행".

**배경** — `/help` 라우트 = 별도 문서 페이지 = 죽은 매뉴얼. Cortex 는 단일 사용자 도구라 외부 문서 가치 낮음. 대신 **현재 화면 위에 overlay** 로 실 UI 요소를 spotlight 하고 컨텍스트 설명. 사용자가 "지금 보고 있는 것" 의 의미를 즉시 학습.

**산출물 (가설)**
- **컨텍스트 도움말 모드** — 헤더 도움말 버튼 클릭 → 모든 페이지 위에 overlay 활성. 사용자가 마우스 hover 한 UI 요소가 spotlight + 옆에 1줄 설명 + "더 보기" 링크. ESC 또는 다시 클릭으로 종료
- **가이드 투어** — 첫 진입 시 (또는 사용자 명시 요청 시) 흐름 시연:
  - 인박스 첫 PR → 머지 흐름 / 위험 PR → 변경 요청 흐름 / 클러스터 → 일괄 머지 흐름
  - 단계별 highlight + "다음" 버튼 + skip 가능
- **`?` 단축키** — 어디서든 도움말 모드 토글 (키보드 우선 사용자 친화)
- **컨텍스트 메타** — 각 UI 컴포넌트가 `data-help-key` 속성 노출 → `helpRegistry.ts` 에서 key → 설명 매핑

**핵심 파일 (가설)**
```
src/components/HelpOverlay.tsx     ← overlay + spotlight 렌더
src/lib/help-registry.ts           ← help-key → 설명 + 다음 단계 매핑
src/components/HelpTour.tsx        ← 가이드 투어 진행
src/app/layout.tsx                 ← HelpProvider 컨텍스트
```

**비-목표**
- 별도 문서 사이트 (`/help` 페이지 안에 긴 글) — 매뉴얼 형식 X
- 다국어 지원 — 한국어만 (단일 사용자 가정 유지)
- 외부 사용자 onboarding 흐름 (튜토리얼 영상, FAQ 등) — 단일 사용자라 비-목표

**우선순위** — **모든 기능 구현 끝난 마무리 단계**. Phase 10~13 + Phase 7 운영 후속 (구조화 로깅·Sentry·배포 자동화) 모두 완료 후. 그 전엔 사이드바 `/help` 항목은 `comingSoon` 유지.

---

## 비-목표 (이번 로드맵 외)

- 모바일 앱
- 다국어 지원 (한국어만)
- 다중 워크스페이스 / 권한 모델
- 자체 코드 에디터·IDE
- 비-GitHub 호스팅 (GitLab/Bitbucket) — 추후 어댑터로 추가 가능
- 결제·빌링
