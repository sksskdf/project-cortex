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

- [x] Anthropic 호출
- [x] 신뢰 점수 + 위험 플래그
- [x] testsPassed CI 통합
- [x] CI 실행중 '측정중' 표시 (PR 상세)

## Phase 4.5 — LLM 비용 최적화

- [x] diff 토큰 절감 (hunk 우선순위 + 자르기)
- [x] Haiku 1차 필터

## Phase 5 — 트라이아지 엔진

- [x] runTriage (위험 아니면 자동 머지 — 신뢰점수 게이트 제거)
- [x] auto-merge 흐름 (동시 webhook race 가드)

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster

## Phase 7 — 운영

- [x] /reports 페이지 (Recharts)
- [x] 알림 시스템
- [ ] 구조화 로깅 (Pino)
- [ ] Sentry 에러 트래킹
- [x] 배포 자동화 (GitHub Actions CI — typecheck/lint/format/test/build 게이트)
- [ ] 백업·복구 절차

## Phase 8 — 기존 프로젝트 인테이크

- [x] /projects 페이지
- [x] 자동 onboard (첫 webhook)
- [x] 인테이크 마법사 (수동 등록 UI — slug 입력)
- [ ] 설치된 GitHub 리포 선택 등록 (app-level JWT)
- [ ] 로컬 경로 먼저 등록 → 리포 연결
- [ ] 새 리포 생성 (PAT)
- [ ] 6 개 레포 첫 메트릭

## Phase 9 — Desktop 서비스 패키징

- [ ] NSSM (Windows) / launchd (Mac) 등록
- [ ] OS 부팅 시 자동 실행

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

## Phase 10.4 — 양방향 sync

- [ ] Cortex UI 토글 → git PR 자동 생성
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
- [x] 에이전트 시작 헤더 액션
- [x] 새로고침에도 세션 유지 (서버 detached 세션 + scrollback replay)
- [ ] 드로어 드래그 리사이즈 (영역 확대/축소)
- [ ] 새 이슈 + Claude Code 위임 토글

## Phase 13.1 — 변경 요청 자동 처리

- [ ] pull_request_review webhook 자동 spawn
- [ ] 작성자 화이트리스트 + 반복 한계 가드
- [ ] autoResolveChangesEnabled 토글

## Phase 13.2 — 병합 충돌 자동 해결

- [ ] mergeable_state=dirty 자동 rebase + resolve
- [ ] 충돌 크기 한계 + Cortex auto-merge PR 만 자동
- [ ] autoResolveConflictsEnabled 토글

## Phase 14 — /help 인터랙티브 도움말

- [ ] HelpOverlay + spotlight
- [ ] 가이드 투어
- [ ] ? 단축키

## Phase 15 — UI/UX · 최적화 (지속)

- [x] 텍스트 최소화 원칙 (AGENTS §2 박제 — 상태 중복 텍스트 제거)
- [x] 죽은 코드 / 미사용 UI 정리 (formatAge 중복 · getNote · disabled 클러스터 버튼)
- [x] 터미널 폰트 monospace 교정
- [ ] ReportsCharts 색 디자인 토큰화 (Recharts 런타임 CSS var)
- [ ] 디자인 시스템 미준수 / 어색한 부분 점진 교정
- [ ] 패키징 전 전체 UI/UX 검토 패스
