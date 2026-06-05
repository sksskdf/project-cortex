# Roadmap

## Phase 0 — 스캐폴딩

- [x] Next.js + TypeScript strict
- [x] 디자인 시스템 통합 (다크 디폴트)

## Phase 1 — UI 셸 + 정적 화면

- [x] AppShell + Sidebar
- [x] 4 개 라우트 동작
- [x] 공유 컴포넌트 (Gauge, PRRow, DiffHunk)

## Phase 2 — 도메인 모델 + DB

- [x] Drizzle 스키마
- [x] SQLite + seed
- [x] mock → DB 마이그레이션

## Phase 3 — GitHub 통합

- [x] GitHub App + webhook 라우트
- [x] Octokit 어댑터
- [x] PR 동기화

## Phase 4 — AI 사전 리뷰

- [x] AI 사전 리뷰 (현재 claude CLI 백엔드 — Phase 4.6)
- [x] 신뢰 점수 + 위험 플래그
- [x] testsPassed CI 통합
- [x] CI 실행중 '측정중' 표시 (PR 상세)
- [x] 전역 AI 토글(settings.aiEnabled) + **프로젝트별 AI 사전 리뷰 토글**(aiReviewEnabled, 둘이 AND) — #179

## Phase 4.5 — LLM 비용 최적화

- [x] diff 토큰 절감 (hunk 우선순위 + 자르기)
- [x] Haiku 1차 필터

## Phase 4.6 — 터미널 에이전트 기반 리뷰 (크레딧 0)

- [x] analyzePR claude CLI 백엔드 (headless, 사용자 plan) — #132
- [x] 리뷰 출력 파싱 → preReview 저장
- [x] Anthropic API 경로 전면 제거 ㅇㅇ (폴백 없음, 크레딧 0) — #136
- [x] Anthropic API 경로 전면 제거 (폴백 없음, 크레딧 0) — #136

## Phase 4.7 — AI 사전 리뷰 고도화 (검토·반복)

현재 리뷰 품질·신뢰도를 높이기 위한 검토·반복 항목. 일회성이 아니라 실제 리뷰 결과 보며 진행.

- [x] PR 설명(본문)을 프롬프트에 포함 (작성자 의도 컨텍스트) — #166
- [x] 위험 플래그·신뢰 점수 정확도 개선 (오탐/미탐 감소, 머지 결과 피드백 학습) — **결정적 부분
- [x] 인라인 코멘트 품질 — 라인별 지적의 정확도·실행가능성 향상. system 프롬프트에 "변경 라인을
- [x] 컨텍스트 추가 보강 — **위임 이슈 spec 주입** (`getIssueContextForPR` — agent_runs.outputPrId
- [x] 대형 diff 재검토 — 청크 분할·핵심 hunk 우선. `diff-budget` 가 위험 도메인 우선 정렬 +
- [x] 리뷰 프롬프트/모델 튜닝 + 회귀 평가 세트 (지속적 품질 관리) — **회귀 평가 세트 결정적 부분

## Phase 5 — 트라이아지 엔진

- [x] runTriage (위험 아니면 자동 머지 — 신뢰점수 게이트 제거)
- [x] auto-merge 흐름 (동시 webhook race 가드)
- [x] **CI 없는 레포 자동 머지** — check run 0개면 testsPassed 가 영구 null → 무한 대기하던 문제.
- [x] **목록(인박스/대시보드) 머지버튼 disable + 불가 사유 인라인 표시** — PR 상세와 동일 게이트

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster
- [x] 클러스터링 사용성 검토 — 실사용 저조. **결정(2026-05-29, 사용자 "추천으로 진행"): cut(소프트).**

## Phase 7 — 운영

- [x] /reports 페이지 (Recharts)
- [x] 알림 시스템
- [x] 구조화 로깅 (Pino) — #123
- [x] 배포 자동화 (GitHub Actions CI — typecheck/lint/format/test/build 게이트)
- [x] 백업·복구 절차 (SQLite 백업·복구 CLI) — #122

## Phase 8 — 기존 프로젝트 인테이크

- [x] /projects 페이지
- [x] 자동 onboard (첫 webhook)
- [x] 인테이크 마법사 (수동 등록 UI — slug 입력)
- [x] 설치된 GitHub 리포 선택 등록 (app-level JWT) — 백엔드 #168 + import 모달 UI #169
- [x] GitHub App 다중 설정 + 설정 UI — github_apps 테이블(DB 저장) + projects.appConfigId +
- [x] 안전 기본값 — 회사/조직 레포 보호. 웹훅 자동 onboard 시 autoMergeEnabled=false 디폴트(기존
- [x] 프로젝트 뮤트 — 조직의 남의 레포/관심 없는 프로젝트가 인박스를 어지럽히는 문제. projects.muted

## Phase 9 — Desktop 서비스 패키징

- [x] NSSM (Windows) / launchd (Mac) 등록 스크립트 — #125
- [x] OS 부팅 시 자동 실행

## Phase 10 — 프로젝트 메타데이터 + 로드맵

- [x] roadmap_phases · roadmap_items 테이블
- [x] /projects/[id]/roadmap 페이지
- [x] PR 본문 Closes #PHASE-N / Closes #ITEM-N 자동 done

## Phase 10.1 — .cortex/ 메타 디렉토리 + 단방향 git sync

- [x] projects 메타 컬럼 + roadmap.source 컬럼 마이그레이션
- [x] lib/project-meta.ts (yml + md 파서 + sync)
- [x] 동기화 버튼 + 첫 onboard 자동 sync
- [x] 남은 작업 (Open Items) 패널
- [x] git/manual 배지 + source_override 추적

## Phase 10.2 — push webhook 자동 sync + 브라우저 알림

- [x] push webhook 의 .cortex/ 변경 감지
- [x] default branch 만 + AI 분석 트리거 안 함
- [x] page-visit stale-while-revalidate (TTL 5분)
- [x] 브라우저 Notification API (PR 발생 시)

## Phase 10.3 — 대시보드 통합 진척

- [x] 모든 프로젝트의 진척 한눈 보기 (대시보드 카드)

## Phase 10.4 — 양방향 sync + 뷰 통합

- [x] 로드맵 상·하단 중복 뷰 통합 — **보드 단일화(#262 item 1)**: RoadmapOpenItems 남은작업 패널을
- [x] UI 에서 산출물(item) 추가·편집 — `RoadmapBoard` 에 phase/item 생성·삭제·상태토글·제목
- [x] Cortex UI 토글 → git roadmap.md — **수동 PR 흐름 완료(#261)**. `serializeRoadmapToMd` +
- [x] cortex marker 인식으로 무한 sync 방지 — `CORTEX_SYNC_MARKER`(`Cortex-Sync: roadmap` trailer)
- [x] 자동 양방향 동기화 — **#262 item 3 완료**: roadmapAutoSyncEnabled 프로젝트 토글(migration

## Phase 11 — 개인 생산성 통합

- [x] todos 테이블
- [x] /todos 화면 + 추가 form
- [x] 사이드바 todo 카운트 + 대시보드 위젯
- [x] notes 테이블 + /notes 화면 (검색 · 핀 · inline 편집)
- [x] todos · 메모 프로젝트별 필터 + 개인 항목

## Phase 12 — 로컬 워크스페이스

- [x] workspaces 테이블
- [x] 로컬 경로 등록 (path validation)
- [x] git pull 버튼 (child_process.spawn, 보안 박제)
- [x] 빈 디렉토리/없는 경로 등록 허용 → 첫 "리포 받아오기" 가 git clone (사용자가 직접 클론 불필요).

## Phase 13 — Claude CLI 통합

- [x] xterm.js 터미널 임베드 (커스텀 서버 + node-pty + ws)
- [x] 에이전트 터미널 전역 드로어 (sticky 런처 + 화면 이동 유지)
- [x] 에이전트 진입 = 전역 드로어 (별도 탭·시작 버튼·hint 정리 — #131)
- [x] 새로고침에도 세션 유지 (서버 detached 세션 + scrollback replay)
- [x] 드로어 반응형 도킹 + 드래그 재도킹 + 위치 기억 (#129)
- [x] 새 이슈 + Claude Code 위임 (#126, 이후 토글 제거·항상 위임 #156)
- [x] 드래그로 크기 조절 (폭/높이) — #141
- [x] 이슈 목록 뷰 (이슈별 claude 세션 진행상태 + 이슈↔결과 PR 연결) — #142 목록 + #143 상세
- [x] 다중 세션 관리 (목록·종료·이름·전환) — #144 + 목록 라이브 새로고침 #145 + rename 시 재연결 방지 #158
- [x] 이슈→Claude 위임 워크플로 — 위임 시 agent_run 생성 + 이슈명 세션 자동 spawn + 작업 지시(prompt)

## Phase 13.1 — 변경 요청 자동 처리

- [x] pull_request_review webhook 자동 spawn (changes_requested → 백그라운드 claude 반영) — #148
- [x] 반복 한계 가드(PR당 3회) + fork 제외. **작성자 무관** — 단일 사용자 가정상 사람/agent
- [x] autoResolveChangesEnabled 토글 (디폴트 OFF, .cortex/project.yml) + /projects 카드 UI 토글 — #148·#186

## Phase 13.2 — 병합 충돌 자동 해결

- [x] mergeable_state=dirty 자동 해결 (merge base→head + claude 마커 해소) — #135
- [x] 충돌 크기 한계(10파일) + fork 제외. **작성자 무관** — 자동 머지 PR 은 머지 직전(auto-merge.ts),
- [x] autoResolveConflictsEnabled 토글 (디폴트 OFF) + /projects 카드 UI 토글 — #181

## Phase 13.3 — CI/테스트 실패 자동 수정

- [x] check webhook conclusion=failure 감지 → claude CLI spawn 으로 테스트 자동 수정 + push — #135
- [x] 같은 head_sha 당 반복 한계(2회) + fork 제외. **작성자 무관** — 단일 사용자 가정상 내 PR (#187)
- [x] autoFixTestsEnabled 토글 (디폴트 OFF) + /projects 카드 UI 토글 — #186

## Phase 13.4 — 위임 워크플로 · 운영 후속 (큐)

- [x] 세션 관리 테스트 보강 — `sanitizeName`·`clampInt/clampDim`·세션 메타 정렬 단위 테스트(+16) — #197
- [x] push(synchronize) 시 AI 사전 리뷰 재분석 — 코드상 재분석 확인(sync.ts) + 분석 실패 알림 표면화(silent skip 해소) — #154
- [x] PR 커밋 로그 컨벤션 — 의미 있는 커밋 단위 + PR 본문 커밋/검증 요약 (AGENTS §8.1) — #160
- [x] **위임 완료 처리** — agent_run 이 영영 `running` 으로 남는 문제.
- [x] 명시적 '완료 처리' 액션 — 이슈 상세 버튼이 running/queued run 을 completed 로 마감 +
- [x] **서버 재시작 시 orphan 정리** — 라이브 pty 세션은 프로세스와 함께 죽으므로 재시작 직후
- [x] **idle 타임아웃** — 서버가 안 죽은 채 오래 방치된 케이스 보완. `reconcileStaleRuns(24h)`

## Phase 13.5 — claude CLI 활용 고도화·최적화 (검토)

현재 claude CLI 가 지원하는 기능을 효율·효과적으로 쓰기 위한 검토 항목.

- [x] 세션 영속/복원 — `--session-id`(생성 시 id 고정) + `--resume`(재시작 후 대화 연속) — #147
- [x] 위임 작업 지시 — interactive 세션에 bracketed-paste 로 초기 prompt 주입 — #157
- [x] headless 호출 최적화 — `-p --output-format json` 모델 선택·토큰·**튜닝**: 모델(R5
- [x] `--continue` 폴백 / MCP 서버 연결 / 도구 권한 정책 / 세션 비용·토큰 측정 / **CLI 버전 추적**:
- [x] 세션 비용·토큰 측정 — `recordLlmUsage`(R3, llm_usage 테이블 + /reports 집계).
- [x] CLI 버전 추적 — `getClaudeCliVersion`(`claude --version` 첫 토큰, 미설치 시 null,
- [x] **도구 권한 정책 (R4) — 완료(#267)**: `--allowed-tools` + 작업별 좁은 허용목록

## Phase 13.6 — claude CLI 최신 활용 방법론·스킬 적용 (리서치·고도화) ⚠️ 중요

Cortex 의 **모든 터미널 관련 기능**(위임 세션·자동 수정·사전 리뷰·헤드리스 호출·충돌/리뷰
자동 반영 등)에 최신 claude code 방법론·스킬·테크닉을 체계적으로 녹이는 전략 작업. 일회성
기능 추가가 아니라 **철저한 리서치·검토가 선행**되어야 하는 매우 중요한 작업. 추측 금지,
근거 기반 결정.
리서치 범위 (전수 검토):
- 최신 claude code CLI/SDK 기능 — 플래그(`--session-id`·`--resume`·`--continue`·`--print`·
`--output-format stream-json`·`--include-partial-messages`·`--bare`·`--dangerously-skip-permissions`),
permission modes, settings, env, exit codes 등.
- Agent SDK · sub-agents · agent skills — 정형화된 작업(테스트 수정·리뷰·이슈 작업 등)을
skill 로 추출했을 때 일관성·재사용·평가 가능성 향상.
- MCP 서버 — Cortex 도구(이슈/PR/로드맵 조회·갱신)를 claude 에 노출해 자율 활용.
- Hooks (SessionStart, PreToolUse 등) — Cortex 컨텍스트(이슈 spec·관련 PR·로드맵)를 자동 주입.
- 출력 형식·스트리밍 — stream-json + partial messages 로 진행 표시·중간 결과 활용, jq/parse 패턴.
- 모델 선택 전략 — Haiku 1차 → Opus 자동 escalation, 비용·지연 trade-off.
- 도구 권한 정밀화 — `--dangerously-skip-permissions` 의존 축소(allowedTools/허용 정책).
- 비용·관측 — token usage·session cost·latency 표준 수집 + /reports 노출.
- CLI 버전 추적 + 회귀 가드 (지원 플래그/스키마 변동 대응).
현재 Cortex 매핑 (적용 후보 영역):
- `lib/pre-review.ts` (analyzePR Haiku/Opus 사전 리뷰) — 컨텍스트 보강 · 비용 측정 · 회귀 평가.
- `lib/test-fix.ts`·`lib/review-fix.ts`·`lib/conflict-resolve.ts` — 공통 헤드리스 패턴 · skill 추출 ·
스트리밍 진행 표시 · 권한 정밀화.
- `lib/claude-cli.ts` (runClaudeHeadless) — 공통 호출 레이어 고도화(stream-json·retry·usage).
- `server/pty.ts` (위임 세션) — hooks 로 이슈 컨텍스트 자동 주입 · MCP 도구 노출 검토.
진행 순서 (단계적):
1. [x] **리서치 보고서** — `docs/CLI-RESEARCH.md`. 공식 문서(headless·cli-reference·subagents)
기반 기능 매트릭스 + 현재 Cortex 매핑 + ROI 권고(R1~R7). **핵심 발견: 2026-06-15 부터 구독
플랜의 `claude -p` 가 별도 월간 Agent SDK 크레딧 차감 → "크레딧 0" 전제 변경, 비용 관측 중요↑.**
2. [x] **1단계 적용 — R1 `--json-schema` + R2 스킬 헤드리스 전역화**
- R1: 사전 리뷰(triage·main) 호출에 JSON Schema 전달 → 봉투의 `structured_output`(스키마 검증)
우선 사용, 미지원 CLI 폴백 시 `parseJsonFromText`(+zod 재검증)로 degrade. 분석은 도구 미사용
이라 비정상 종료 시 플래그 없이 1회 자동 재시도 → 무회귀. parseJsonFromText 산문-속-객체
취약점 제거.
- R2: 슬래시 스킬이 `-p` 에서 안 먹는 한계를, 코딩 자동화(test-fix·conflict-resolve·review-fix)에
`--append-system-prompt-file` 로 Cortex 가드레일(`CORTEX_HEADLESS_GUIDANCE`) 주입해 해결.
범위·안전(되돌리기 어려운 git·훅 우회 금지) 규칙만 — git/PR 은 하네스 관리라 전체 위임 스킬 제외.
- ⚠️ 런타임 검증 대기: 이 환경엔 claude CLI 가 없어 typecheck·단위테스트(주입 러너)까지만 검증.
`--json-schema`/`--append-system-prompt-file` 실제 동작은 사용자 머신에서 확인 필요.

- [x] **R3 비용·토큰 관측(1단계)** — `--output-format json` 봉투의 `total_cost_usd`·`usage`
- [x] **R5 `--fallback-model`** — 본 분석(Opus) 과부하·은퇴 시 Sonnet 자동 폴백(print 모드 전용).
- [x] **R3 2단계 — 비용 영속 + /reports 집계** — `llm_usage` 테이블(migration 0026). wrapper 가
- [x] 후속: R4 권한 정밀화(allowedTools/dontAsk) — **완료**: `claude-cli.ts buildHeadlessArgs` 가
- [x] **Cortex 컨텍스트 스킬 + 스폰 주입** (#173) — 정적 방법론은 \`cortex\` 스킬(설정에서
- [x] **`.cortex` 스킬·지침 항상 글로벌 적용** (사용자 시그널 2026-05-29) — 3축 모두 적용:
- [x] 후속: hooks(SessionStart) 자동 주입 · MCP 도구 노출 · stream-json 진행 표시 · 모델 escalation 등.

## Phase 14 — /help 인터랙티브 도움말

- [x] HelpOverlay + spotlight — #127
- [x] 가이드 투어
- [x] ? 단축키
- [x] 인터랙티브 contextual 도움말 (재정의) — 요소 hover/focus 시 인라인 설명 툴팁. 순수 CSS

## Phase 15 — UI/UX · 최적화 (지속)

- [x] 텍스트 최소화 원칙 (AGENTS §2 박제 — 상태 중복 텍스트 제거)
- [x] 죽은 코드 / 미사용 UI 정리 (formatAge 중복 · getNote · disabled 클러스터 버튼)
- [x] 터미널 폰트 monospace 교정
- [x] ReportsCharts 색 디자인 토큰화 (Recharts 런타임 CSS var) — #153
- [x] 미정의 DS 타이포 토큰 정의 (font-size 10·11, letter-spacing-wide) — #155
- [x] 프로젝트 카드 spacing·typography DS 정렬 — #150
- [x] /projects 카드 자동화 토글 **스위치화 + 액션 버튼 분리** (ds-btn 알약 6개 난잡 → '자동화'
- [x] 뮤트(Cortex 관리 OFF) 시 하위 자동화 토글 비활성 + OFF 표시 — #185
- [x] 최근 머지 목록에 #PR번호 노출 — #187
- [~] 디자인 시스템 미준수 / 어색한 부분 점진 교정 — **하드코딩 색상 토큰화 패스 완료**: 컴포넌트
- [x] 반응형 디자인 — 좁은 화면·모바일·태블릿·세로 모니터에서 레이아웃 적응 (사이드바 collapse,
- [x] (1) 7개 토글 컴포넌트 복붙 → `useOptimisticToggle` 훅 + `ProjectAutomationToggle` 제네릭 (−187줄) — #189
- [x] (2) `listProjectsWithStats` N+1(1+3N) → 배치 3쿼리 — #190
- [x] (3) 핫 컬럼 인덱스(`prs(repo_id,status)`·`projects(installation_id)`, migration 0023) — #190
- [x] (4) 자동화 알림 종류 분리 — analysis/conflict/test/review 실패가 모두 'auto-merge-failed'
- [x] (5) 토글 동시 클릭 race 가드 — `useOptimisticToggle` 에 inFlight ref 잠금. 이전 토글
- [x] (A0) 자동화 가시성 1단계 — 알림 종류 분리 + 성공/실패 표면화 (위 B4 와 동일 PR)
- [x] (A1) **백그라운드 자동화 in-flight 표시** — 인메모리 레지스트리(automation-state, 프로세스
- [x] (A2) **토스트 시스템** — 인앱 토스트(#194) + SSE 알림 자동 표면화 + PR 상세 액션 결과(#195)
- [x] (A3) **막다른 길 복구 CTA** — disabled 컨트롤 사유/준비중(#193) + 멈춘 agent_run 안내(#196).
- [x] (A4) **error.tsx / loading.tsx / not-found 경계** — #192
- [x] (A5) **disabled 컨트롤 설명** — 인박스 알림·필터·정렬 탭, 대시보드 더보기 준비중 — #193
- [x] (A6) 텍스트 상태 중복 — 검토 결과 PR 상세에 실제 중복 없음(AnalyzeRequestButton 은 미분석 PR
- [x] (A7-1) 모달 포커스 트랩/복원/Escape/ARIA — `useFocusTrap` 훅(Tab 순환 트랩 + 초기 포커스 +

## Phase 16 — 세션 연속성 (.cortex work-state)

- [x] .cortex/ work-state 파일 (진행 중 브랜치·worktree·다음 단계) — `lib/work-state` 파서+직렬화 (#201)
- [x] 새 세션 onboarding 시 먼저 읽기 (README→AGENTS 다음) — AGENTS.md 가 work-state 포인터 안내 (#201)
- [x] 메타 schema v1 (사람·에이전트 공용) — `WorkStateV1` 스키마 + 관대한 파서 (#201)
- [x] 에이전트 작업은 worktree 격리 — `lib/agent-worktree`(create/remove, 결정적 형제 경로 +
- [x] claude --resume 로 서버 재시작에도 대화 세션 연속 (세션 메타 영속 → dormant 복원 → --resume) — #147

## Phase 18 — 이슈·TODO·로드맵 통합

세 시스템을 묶어 사용성 향상 — 로드맵 산출물 ⊃ 이슈 ⊃ TODO 의 고도(altitude) 계층.

- [x] 데이터 연결 레이어 — `issues.roadmapItemId`, `todos.issueId` nullable FK + 마이그레이션 0017 +
- [x] 통합 "작업" 뷰 — `/work` 라우트(사이드바 '작업'). `getWorkView()` 가 활성 이슈를 로드맵
- [x] 대시보드 세 소스 통합 — **G1 라이브 상태 스트립**이 PR(검토 대기·미확인 머지)·이슈
- [x] 링크 설정 UI — 이슈 상세에서 로드맵 산출물 선택 + TODO 행에서 이슈 연결/해제 (select/chip)
- [x] 승격 플로우 — TODO →(이슈로 승격 = Claude 위임). `promoteTodoToIssue`(프로젝트 연결된
- [x] 공통 상태 어휘 정규화 + 상태 칩 컴포넌트 공유 — `StatusChip` (issue/todo/roadmap), `t.status` — #198

## Phase 20 — PR 검토 UX (READ 마킹 · 라이트 모달 · 확인 요약)

자동 머지가 늘면서 "이미 머지됐지만 내가 아직 확인 안 한 PR" 을 가볍게 훑고 뭐가 바뀌었는지
파악하는 흐름이 필요. (사용자 시그널 2026-05-29: "PR 상세를 일일이 다 눌러 봐야 해서 불편 —
목록에서 누르면 모달로 라이트하게, 앞뒤 넘기며 READ 처리가 제일 깔끔")

- [x] **PR READ/미확인 마킹** — `prs.readAt` 컬럼(migration 0025, notifications 패턴) + `markPRRead`/
- [x] **라이트 모달 뷰어** — 대시보드 최근 머지에서 행 클릭 시 페이지 이동 없이 모달(`PRPeekModal`)로
- [x] **모달 5개 제한 해제** — 행은 5개만 보여주되 모달 앞뒤 넘김은 머지 전체(200건 로드)를 순회
- [x] **액션 가능한 모달 + "지금 처리할 것" 적용** (사용자 요청 — by-design 번복) — `ActionablePeekModal`
- [x] **인박스 적용** — `InboxRows` 가 PRRow 를 onOpen 모드(행=모달 트리거, 인라인 액션은 모달이
- [x] **PR 상세 마지막 단락 = "내가 확인하면 될 부분" 요약** — 사전 리뷰가 사용자용 체크포인트
- [x] **머지 후 워크스페이스 자동 git pull** — 자동/사람 머지 성공 시 해당 프로젝트의 등록
- [x] **결과 가시화** (사용자 보고: "자동 pull 안 되는 것 같다") — 이전엔 조용히 돌아 성공/실패

## Phase 21 — 세션/프로젝트 상태 한눈 파악 (glanceability) ⚠️ 두번째 핵심 원칙

CLI claude 세션은 대화형·선형이라 길어지면 한눈에 파악하기 어렵다. Cortex 의 두번째 핵심
가치 = **현재 무슨 일이 돌고 있고 프로젝트가 어떤 상태인지 한눈에**. (사용자 시그널 2026-05-29,
신중한 검토·좋은 아이디어 필요 — 추측 구현 금지.)

- [x] **설계 제안서** — `docs/GLANCEABILITY.md`. 진단(세션 축·프로젝트 축) + 기존 자산 정리 +
- [x] 상태 한눈 대시보드 강화(G1) — `getLiveStatus`(진행 중 위임·자동화 in-flight·검토 대기·미확인
- [x] **비선형 요청 캡처(G3)** (메타 원칙) — 사이드바 전역 `QuickCapture`(어느 화면에서든 한 줄 캡처
- [x] **desktop-service 패키징 스크립트** — Windows(NSSM, `scripts/service/windows-{install,uninstall}.ps1`) · macOS(launchd, `com.cortex.server.plist`) · Linux(systemd user unit, `cortex.service`) 3-OS 템플릿 완비.
- [x] **dev 서버 속도 진단** — `docs/DEV-PERFORMANCE.md`. 원인: 커스텀 서버(PTY ws)라 dev 가
- [x] 스크립트 분리 적용 — `dev:turbo`(`next dev --turbopack`, PTY 없음·빠른 HMR, UI 전용) 추가.
