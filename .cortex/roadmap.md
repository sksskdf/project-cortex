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

## Phase 4.5 — LLM 비용 최적화

- [x] diff 토큰 절감 (hunk 우선순위 + 자르기)
- [x] Haiku 1차 필터

## Phase 5 — 트라이아지 엔진

- [x] runTriage 5 조건
- [x] auto-merge 흐름

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster

## Phase 7 — 운영

- [x] /reports 페이지 (Recharts)
- [x] 알림 시스템
- [ ] 구조화 로깅 (Pino)
- [ ] Sentry 에러 트래킹
- [ ] 배포 자동화 (GitHub Actions)
- [ ] 백업·복구 절차

## Phase 8 — 기존 프로젝트 인테이크

- [x] /projects 페이지
- [x] 자동 onboard (첫 webhook)
- [ ] 인테이크 마법사 (수동 등록 UI)
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

## Phase 12 — 로컬 워크스페이스

- [x] workspaces 테이블
- [x] 로컬 경로 등록 (path validation)
- [x] git pull 버튼 (child_process.spawn, 보안 박제)
- [ ] PR 상세 "로컬 클론으로 열기" (IDE handler — 후속)

## Phase 13 — Claude CLI 통합

- [ ] /agents 페이지 (Claude Code 세션 매니저)
- [ ] xterm.js 터미널 임베드
- [ ] 에이전트 시작 헤더 액션
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
