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
| 2026-05-22 | **PR #95 squash 머지 일부 commit 누락 — CI 가드 재적용** | GitHub squash 가 PR #95 의 첫 commit 만 머스터 반영하고 후속 2 commit (`fix: PR 상세 CI 가드 + 차트 색상 토큰 정정`, prettier 포맷) 누락. 결과: PR 상세에서 `testsPassed=false` 인 CI 실패 PR 머지 가능 버그가 master 에 남음. 이번 PR 에 `lib/pr.ts`/`PRActions.tsx`/`ko.ts` 의 CI 가드 ( `testsPassed !== true` + `ciFailed` 메시지) 재적용. 박제: squash 머지가 multi-commit PR 의 일부만 합치는 케이스 점검 필요 |
| 2026-05-22 | **Phase 10 후속 — git docs/ROADMAP.md sync 검토** | 사용자 시그널: "로드맵이 비어있는데 깃 리포의 로드맵과 동기화되는 걸 생각했었음". Phase 10 은 사용자가 Cortex UI 에 별도 등록하는 시스템 — git 의 단일 source of truth 와 분리되어 인지 부조화. 1단계 권장은 **(a) 단방향 (git → Cortex), readonly UI** — GitHub API 로 default branch 의 `docs/ROADMAP.md` fetch + 마크다운 파서 + `source='git' \| 'manual'` 컬럼. 2단계 옵션은 양방향 (Cortex 토글 → git PR 자동 생성). Phase 10 섹션에 상세 박제 |
| 2026-05-22 | **Phase 13.1 — 변경 요청 webhook 자동 Claude CLI spawn** | 사용자 시그널: "변경 요청 이벤트 수신해서 claude cli 로 자동 변경 작업 요청 후 커밋, 푸쉬". 사용자가 변경 요청 시작점이므로 **무한 루프 위험 없음** (Cortex 가 자동으로 변경 요청 안 함). 가드: 요청 작성자 필터 (사용자 본인 + 화이트리스트만 자동), 같은 `head_sha` 당 반복 한계 N회, 프로젝트별 `autoResolveChangesEnabled` 토글 (디폴트 OFF), 실패 시 PR 코멘트 자동 회신. 옵션 (b) "Cortex 자동 검토로 변경 요청 사유 자동 생성" 도 박제. Phase 13 본문에 13.1 절로 상세 |

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
| `/help` (도움말) | 최하 우선순위 | 단일 사용자(본인) 가정상 시급도 낮음. 통합 후 별도 사용자 입수 시 작성 |

### 헤더 액션 미구현

| 항목 | Phase | 작업 내용 |
|---|---|---|
| **알림** (대시보드·인박스) | Phase 7 | `notifications` 테이블 + SSE/poll. 머지·CI 실패·새 클러스터 이벤트 → 토스트 + 배지 |
| **새 이슈** (대시보드) | **Phase 13 으로 이관** | `issues` 테이블 schema 만 있고 사용 없음. 이슈 작성 시 'Claude Code 에게 위임' 토글 ON 이면 즉시 CLI 세션 spawn. "에이전트 시작" 과 한 묶음 |
| **에이전트 시작** (대시보드) | **Phase 13 으로 이관** | PR/이슈 컨텍스트로 `claude` CLI spawn — Cortex 가 직접 API 호출 안 함 (사용자 Claude plan 사용, 크레딧 0). `agent_runs` 에 세션 기록 |

ROADMAP §0 의 "Cortex = oversight layer" 원칙상 **에이전트 · 새 이슈 · 에이전트 시작** 은 외부 에이전트 통합이 명확해진 후 마지막에 진입. 이전엔 'Phase 8 후속' 으로 두었으나 **Cortex 가 Claude API 를 직접 호출하지 않고 `claude` CLI 를 spawn 하는 방향** 이 정해지면서 (Phase 13) 모두 Phase 13 에 흡수. 현재는 GitHub PR 만 받는 흐름이 메인.

---

## Phase 10 — 프로젝트별 로드맵 / 진척도

> Cortex 가 다루는 각 레포의 개발 로드맵·진척도를 안에서 기록·시각화.

**진척**
- `roadmap_phases` · `roadmap_items` 테이블 + 마이그레이션 0010
- `/projects/[id]/roadmap` 페이지 — Phase 카드 + 산출물 체크박스 + 상태 select + 진척 바
- `lib/roadmap.ts` — CRUD + PR 본문 `Closes #PHASE-<key>` / `Closes #ITEM-<id>` 매칭 (`Fixes`, `Resolves` 인식)
- 머지 hook — `attemptAutoMerge` / `attemptHumanMerge` 성공 시 자동 done 전환 (`doneByPrId` 기록)
- 프로젝트 카드에 진척 바 + "로드맵" 액션 행
- PR 상세에 `RoadmapBadge` — 연결된 phase / item + auto-done 배지
- 16 단위 테스트 추가

**배경** — Claude app 은 스크롤·대화식이라 길어졌을 때 전체 맥락·진행도·남은 작업을 한눈에 파악하기 힘듦. PR 흐름과 별개로 "이 프로젝트가 어디까지 왔는지" 를 Cortex 안에서 추적. 본 문서 (`docs/ROADMAP.md`) 같은 형태를 각 프로젝트마다 관리.

**산출물**
- `roadmap_phases` · `roadmap_items` 테이블 — projects FK. Phase 이름 + 산출물 + DoD + 상태 (planned/in-progress/done).
- **`/projects/[id]/roadmap` 화면** — Phase 카드 + 각 산출물의 체크박스 + PR 링크. Phase 8 인테이크 마법사 직후 진입점.
- **PR 상세에 연결된 로드맵 항목 노출** — PR description 의 `Closes #PHASE-N` 컨벤션 또는 사용자 명시 매핑. 머지 시 자동 done 처리.
- **대시보드 진척 요약 카드** — 프로젝트별 Phase 진행률 (예: "dfasee2: Phase 3 / 60%"). 검토 단계 — UI 가 부담되면 카드 대신 사이드바 hover preview 로 대체.

**핵심 파일**
```
src/db/schema.ts                       ← roadmap_phases · roadmap_items 추가
src/lib/roadmap.ts                     ← Phase·item CRUD, PR 매핑
src/app/projects/[id]/roadmap/page.tsx ← Phase 카드 뷰
src/components/RoadmapBadge.tsx        ← PR 상세에 노출되는 작은 진척 배지
```

**DoD**
- 6 개 레포 각각이 자기 로드맵 (최소 1 Phase) 를 가짐
- PR 머지 시 매핑된 항목 자동 `done` 으로 전환
- 대시보드에서 프로젝트별 진척률 한눈에 보임

**후속 작업 (백로그) — git repo `docs/ROADMAP.md` 동기화**

> Phase 10 의 한계: 사용자가 Cortex UI 에 별도 등록해야 함. git repo 의 `docs/ROADMAP.md` (사용자가 이미 코드와 같이 관리하는 단일 source of truth) 와 분리되어 인지 부조화. 사용자 시그널 (2026-05-22): "깃 리포의 로드맵과 동기화되는 걸 생각했었는데".

**검토 옵션**:

| 방향 | 장점 | 단점 |
|---|---|---|
| (a) **단방향 (git → Cortex), readonly UI** | git 이 single source of truth, 마크다운 편집기 그대로, 충돌 없음 | Cortex UI 에서 toggle 불가 (직접 PR 만들어야 함) |
| (b) **양방향 sync, Cortex 변경 시 자동 PR** | UI 에서 toggle → git PR 자동 생성 → 머지 시 반영 | PR 폭탄, 충돌 해결 복잡, 사용자가 동시에 git 수정 시 race |
| (c) **이중 모드: git + Cortex DB 합쳐 표시** | 점진 도입, git 있으면 우선 / 없으면 DB | 동기화 책임 모호, 사용자가 어느 쪽에 적을지 헷갈림 |

**1단계 권장 — (a) 단방향**:
- GitHub API 로 `docs/ROADMAP.md` (default branch) fetch + 마크다운 파서로 Phase / item 추출
- Heading 규칙: `## Phase <key> — <title>` / `**산출물** - item` 같은 컨벤션 정의
- Cortex DB 의 `source` 컬럼 = `git` / `manual` → UI 가 git 항목엔 "git readonly" 표시 + 수정 disabled
- 머지 hook 자동 done 매핑은 그대로 작동 (DB 상태만 갱신, git 파일은 안 건드림)
- 진척이 git 에 반영되려면 사용자가 ROADMAP.md 직접 수정해서 PR 만듦

**2단계 (옵션) — (b) Cortex 변경 시 자동 PR**:
- Cortex UI 토글이 git 파일 mutation PR 자동 생성 (head 브랜치 별도, 사용자가 직접 머지)
- PR 본문에 `cortex: roadmap toggle ITEM-12 → done` 같은 marker → Cortex 가 다시 받아도 무한 sync 방지

**비-목표**:
- 임의 마크다운 형식 지원 (특정 컨벤션 강제)
- 양방향 conflict 자동 해결 (사용자가 git 직접 수정 시 Cortex DB 덮어쓰기 안 함)

**의존성**: GitHub App `Contents: read` (1단계) / `Contents: write + Pull requests: write` (2단계).

**비-목표**
- 별도 PM 도구 (Jira · Linear · Asana) 대체 — Cortex 는 git 워크플로우 중심. 복잡한 PM 기능 (sprint, burn-down, OKR) 은 외부 도구 사용.
- 다른 사용자에게 공유 (단일 사용자 가정 유지).

**우선순위** — Phase 8 (인테이크 마법사) 직후. 레포가 등록된 후라야 의미 있음.

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

**비-목표**
- Cortex 자체가 Claude Code 를 대체 — 코드 작성은 Claude CLI 가 함, Cortex 는 게이트키퍼 + 세션 매니저
- 임의 shell 명령 노출 — 화이트리스트 (`claude`/`claude-code`) 외 spawn 금지
- 다중 에이전트 (Devin/Codex) 통합 — Decision Log 박제대로 Claude 단일

**의존성**
- Phase 12 (로컬 워크스페이스) 의 워크스페이스 등록이 spawn 작업 디렉토리 화이트리스트 입력으로 활용
- Phase 4.5 의 Anthropic API key 결제 흐름과 별개 — 사용자 Claude plan 으로 spawn

**우선순위** — Phase 12 후. 로컬 워크스페이스가 등록되어 있어야 의미 있음. Phase 8 의 /agents 구현은 Phase 13 에 흡수됨.

---

## 비-목표 (이번 로드맵 외)

- 모바일 앱
- 다국어 지원 (한국어만)
- 다중 워크스페이스 / 권한 모델
- 자체 코드 에디터·IDE
- 비-GitHub 호스팅 (GitLab/Bitbucket) — 추후 어댑터로 추가 가능
- 결제·빌링
