# Roadmap

Cortex 자체의 진척. `docs/ROADMAP.md` 가 정식 설계 문서, 이 파일은 Cortex UI 가
파싱하는 구조화된 진척 추적용. Phase key 는 `docs/ROADMAP.md` 의 번호와 1:1 매칭.

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

## Phase 4.5 — LLM 비용 최적화

- [x] diff 토큰 절감 (hunk 우선순위 + 자르기)
- [x] Haiku 1차 필터

## Phase 4.6 — 터미널 에이전트 기반 리뷰 (크레딧 0)

- [x] analyzePR claude CLI 백엔드 (headless, 사용자 plan) — #132
- [x] 리뷰 출력 파싱 → preReview 저장
- [x] Anthropic API 경로 전면 제거 (폴백 없음, 크레딧 0) — #136

## Phase 5 — 트라이아지 엔진

- [x] runTriage (위험 아니면 자동 머지 — 신뢰점수 게이트 제거)
- [x] auto-merge 흐름 (동시 webhook race 가드)
- [ ] 사람 작성 PR 도 자동 머지 대상에 포함하는 옵트인 (라벨/마커로 Cortex 관리 표시 — 현재는 에이전트 PR 만)

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster

## Phase 7 — 운영

- [x] /reports 페이지 (Recharts)
- [x] 알림 시스템
- [x] 구조화 로깅 (Pino) — #123
- [x] Sentry 에러 트래킹 (opt-in, 기본 OFF) — #124
- [x] 배포 자동화 (GitHub Actions CI — typecheck/lint/format/test/build 게이트)
- [x] 백업·복구 절차 (SQLite 백업·복구 CLI) — #122

## Phase 8 — 기존 프로젝트 인테이크

- [x] /projects 페이지
- [x] 자동 onboard (첫 webhook)
- [x] 인테이크 마법사 (수동 등록 UI — slug 입력)
- [ ] 설치된 GitHub 리포 선택 등록 (app-level JWT)
- [ ] 로컬 경로 먼저 등록 → 리포 연결
- [ ] 새 리포 생성 (PAT)
- [ ] 6 개 레포 첫 메트릭

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

- [ ] 로드맵 상·하단 중복 뷰 통합 (상단 베이스 + 산출물 추가)
- [ ] UI 에서 산출물(item) 추가·편집
- [ ] Cortex UI 토글 → git roadmap.md 자동 PR
- [ ] cortex marker 인식으로 무한 sync 방지

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

## Phase 13 — Claude CLI 통합

- [x] xterm.js 터미널 임베드 (커스텀 서버 + node-pty + ws)
- [x] 에이전트 터미널 전역 드로어 (sticky 런처 + 화면 이동 유지)
- [x] 에이전트 진입 = 전역 드로어 (별도 탭·시작 버튼·hint 정리 — #131)
- [x] 새로고침에도 세션 유지 (서버 detached 세션 + scrollback replay)
- [x] 드로어 반응형 도킹 + 드래그 재도킹 + 위치 기억 (#129)
- [x] 새 이슈 + Claude Code 위임 토글 (#126)
- [x] 드래그로 크기 조절 (폭/높이) — #141
- [x] 이슈 목록 뷰 (이슈별 claude 세션 진행상태 + 이슈↔결과 PR 연결) — #142 목록 + #143 상세
- [x] 다중 세션 관리 (목록·종료·이름·전환) — #144 + 목록 라이브 새로고침 #145
- [ ] 이슈→Claude 위임 워크플로 (위임 시 agent_run 생성 + 이슈명 세션 자동 시작 + 종료 시 상태 기록) — 진행 중

## Phase 13.1 — 변경 요청 자동 처리

- [ ] pull_request_review webhook 자동 spawn
- [ ] 작성자 화이트리스트 + 반복 한계 가드
- [ ] autoResolveChangesEnabled 토글

## Phase 13.2 — 병합 충돌 자동 해결

- [x] mergeable_state=dirty 자동 해결 (merge base→head + claude 마커 해소) — #135
- [x] 충돌 크기 한계 + Cortex auto-merge PR 만 자동
- [x] autoResolveConflictsEnabled 토글 (디폴트 OFF)

## Phase 13.3 — CI/테스트 실패 자동 수정

- [x] check webhook conclusion=failure 감지 → claude CLI spawn 으로 테스트 자동 수정 + push — #135
- [x] 같은 head_sha 당 반복 한계 + Cortex 관리 PR 만 (사람 PR 은 사람 결정)
- [x] autoFixTestsEnabled 토글 (디폴트 OFF)

## Phase 13.4 — 위임 워크플로 · 운영 후속 (큐)

- [ ] 세션 관리 테스트 보강 — #144 후속. `/api/sessions` 핸들러·`sanitizeName`·`listSessionMeta` 단위 테스트 (pty registry 를 테스트 가능하게 추출)
- [ ] push(synchronize) 시 AI 사전 리뷰 재분석 검증 — 코드상 재분석함 (sync.ts `shouldAnalyze`+`safeAnalyze`, `analyzePR` 가 (prId, headSha) 캐시로 새 커밋마다 새 리뷰). 확인 필요: GitHub App webhook 의 synchronize 구독 + `analyzePR` 실패를 UI 에 표면화 (현재 silent skip 이라 "안 도는 것처럼" 보임)
- [ ] PR 커밋 로그 컨벤션 — 의미 있는 커밋 단위 + PR 본문에 커밋 요약 포함 (AGENTS 박제)

## Phase 14 — /help 인터랙티브 도움말

- [x] HelpOverlay + spotlight — #127
- [x] 가이드 투어
- [x] ? 단축키

## Phase 15 — UI/UX · 최적화 (지속)

- [x] 텍스트 최소화 원칙 (AGENTS §2 박제 — 상태 중복 텍스트 제거)
- [x] 죽은 코드 / 미사용 UI 정리 (formatAge 중복 · getNote · disabled 클러스터 버튼)
- [x] 터미널 폰트 monospace 교정
- [ ] ReportsCharts 색 디자인 토큰화 (Recharts 런타임 CSS var)
- [ ] 디자인 시스템 미준수 / 어색한 부분 점진 교정
- [ ] 패키징 전 전체 UI/UX 검토 패스

## Phase 16 — 세션 연속성 (.cortex work-state)

- [ ] .cortex/ work-state 파일 (진행 중 브랜치·worktree·다음 단계)
- [ ] 새 세션 onboarding 시 먼저 읽기 (README→AGENTS 다음)
- [ ] 메타 schema v1 (사람·에이전트 공용)
- [ ] 에이전트 작업은 worktree 격리 — 별도 worktree(임시 디렉토리+전용 브랜치)에서 claude spawn, 메인 작업트리 무오염 (dev 서버 코드베이스 보호)
- [ ] claude --resume 로 서버 재시작에도 대화 세션 연속 (pty 죽어도 세션id 저장→resume)

## Phase 17 — DB 중앙화 (멀티 환경 일관성)

- [ ] 로컬 SQLite → 중앙 DB (여러 머신·환경 간 작업 상태 일관성)
- [ ] 환경별 접속 설정 + 마이그레이션 경로 (단일 사용자 가정 유지)
- [ ] 오프라인/로컬 폴백 검토
