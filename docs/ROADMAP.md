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
- GitHub App 등록 (또는 Personal Token 우선)
- Webhook 수신 엔드포인트
- Octokit 어댑터 (`lib/github.ts`)
- PR 생성·업데이트 동기화
- 머지 API 호출

**핵심 파일**
```
src/app/api/webhooks/github/route.ts
src/lib/github.ts                     ← getPRDetails, mergePR
src/lib/sync.ts                       ← webhook payload → DB upsert
.env.local                            ← GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET
```

**DoD**
- 테스트 레포에 PR을 만들면 5초 이내 Cortex DB에 표시됨
- 인박스에서 머지 버튼이 GitHub PR을 실제로 머지
- webhook 서명 검증
- 동기화 실패 시 에러 로깅 (사용자 노출 X)

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

---

## Phase 7 — 운영 (지속)

> 출시 후 유지하는 데 필요한 것.

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

**비-목표 (이 Phase에서도)**
- 코드를 한 모노레포로 통합하는 작업 (의도적으로 안 함)
- 비-Cortex 외부 사용자에게 공개 (단일 사용자 전용)

---

## 의존성 그래프

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6 ──→ Phase 7 ──→ Phase 8
                          │           (병렬 가능: Phase 3, 4)
                          └──── Phase 1 끝나면 사람에게 데모 가능 (mock 기반)
```

Phase 3·4는 도메인이 다르니 병렬로 진행 가능. Phase 5는 Phase 3·4가 모두 끝나야 함. Phase 8은 **Phase 7까지의 모든 것이 안정**된 후 진입.

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

## 비-목표 (이번 로드맵 외)

- 모바일 앱
- 다국어 지원 (한국어만)
- 다중 워크스페이스 / 권한 모델
- 자체 코드 에디터·IDE
- 비-GitHub 호스팅 (GitLab/Bitbucket) — 추후 어댑터로 추가 가능
- 결제·빌링
