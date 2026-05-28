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

## Phase 4.7 — AI 사전 리뷰 고도화 (검토·반복)

현재 리뷰 품질·신뢰도를 높이기 위한 검토·반복 항목. 일회성이 아니라 실제 리뷰 결과 보며 진행.

- [x] PR 설명(본문)을 프롬프트에 포함 (작성자 의도 컨텍스트) — #166
- [ ] 위험 플래그·신뢰 점수 정확도 개선 (오탐/미탐 감소, 머지 결과 피드백 학습)
- [ ] 인라인 코멘트 품질 — 라인별 지적의 정확도·실행가능성 향상
- [ ] 컨텍스트 추가 보강 — 연결된 이슈 spec / 관련 파일 / 이전 리뷰 컨텍스트
- [ ] 대형 diff 재검토 — 청크 분할·요약·핵심 hunk 우선 검토
- [ ] 리뷰 프롬프트/모델 튜닝 + 회귀 평가 세트 (지속적 품질 관리)

## Phase 5 — 트라이아지 엔진

- [x] runTriage (위험 아니면 자동 머지 — 신뢰점수 게이트 제거)
- [x] auto-merge 흐름 (동시 webhook race 가드)

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster
- [ ] 클러스터링 사용성 검토 — 실사용 빈도 낮음. 제거 vs 고도화(유사 PR 자동 묶음 추천·일괄
      리뷰/머지·중복 작업 감지 등) 결정 필요.

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
- [ ] 자동 양방향 동기화 — 수동 '.cortex 동기화' 버튼 대신 프로젝트 .cortex 를 감시해 자동 반영.
      git→Cortex 는 push webhook(.cortex 변경, 이미 있음) 활용, Cortex→git 은 변경 시 자동 PR,
      cortex marker 로 무한 루프 방지. (현재는 사용자가 버튼으로 수동 단방향 sync)

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
      ambient git credential 사용(토큰 주입 X), 비어있지 않은 비-git 폴더는 덮어쓰기 방지로 거부.

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
      bracketed-paste 자동 전달 + 종료 시 상태 기록. 위임 토글 제거(항상 위임). #149·#156·#157

## Phase 13.1 — 변경 요청 자동 처리

- [x] pull_request_review webhook 자동 spawn (changes_requested → 백그라운드 claude 반영) — #148
- [x] 작성자 화이트리스트(agent PR) + 반복 한계 가드(PR당 3회) — #148
- [x] autoResolveChangesEnabled 토글 (디폴트 OFF, .cortex/project.yml) — #148

## Phase 13.2 — 병합 충돌 자동 해결

- [x] mergeable_state=dirty 자동 해결 (merge base→head + claude 마커 해소) — #135
- [x] 충돌 크기 한계 + Cortex auto-merge PR 만 자동
- [x] autoResolveConflictsEnabled 토글 (디폴트 OFF)

## Phase 13.3 — CI/테스트 실패 자동 수정

- [x] check webhook conclusion=failure 감지 → claude CLI spawn 으로 테스트 자동 수정 + push — #135
- [x] 같은 head_sha 당 반복 한계 + Cortex 관리 PR 만 (사람 PR 은 사람 결정)
- [x] autoFixTestsEnabled 토글 (디폴트 OFF)

## Phase 13.4 — 위임 워크플로 · 운영 후속 (큐)

- [ ] 세션 관리 테스트 보강 — #144 후속. `sanitizeName`·`clampDim`·세션 메타 정렬 단위 테스트 (pty-util 추출) — 진행 중
- [x] push(synchronize) 시 AI 사전 리뷰 재분석 — 코드상 재분석 확인(sync.ts) + 분석 실패 알림 표면화(silent skip 해소) — #154
- [x] PR 커밋 로그 컨벤션 — 의미 있는 커밋 단위 + PR 본문 커밋/검증 요약 (AGENTS §8.1) — #160
- [~] **위임 완료 처리** — agent_run 이 영영 `running` 으로 남는 문제.
      - [x] 명시적 '완료 처리' 액션 — 이슈 상세 버튼이 running/queued run 을 completed 로 마감 +
            이슈를 done 으로. 대화형 세션 미종료/대시보드 '진행 중' 잔류 해소(수동). (#172)
      - [ ] 자동 완료 기준 — 결과 PR 생성/머지 연동, idle 타임아웃, dormant runId 영속화(서버 재시작
            시 runId 유실로 영구 running) 등은 후속.

## Phase 13.5 — claude CLI 활용 고도화·최적화 (검토)

현재 claude CLI 가 지원하는 기능을 효율·효과적으로 쓰기 위한 검토 항목.

- [x] 세션 영속/복원 — `--session-id`(생성 시 id 고정) + `--resume`(재시작 후 대화 연속) — #147
- [x] 위임 작업 지시 — interactive 세션에 bracketed-paste 로 초기 prompt 주입 — #157
- [ ] headless 호출 최적화 — `-p --output-format json` 모델 선택·토큰·타임아웃·재시도 튜닝
- [ ] `--continue` 폴백 / MCP 서버 연결 / 도구 권한 정책 / 세션 비용·토큰 측정 / CLI 버전 추적

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

1. **리서치 보고서** — CLI/SDK 기능 매트릭스 + 현재 Cortex 매핑 + 우선순위·ROI 평가 (별도 doc).
2. **1단계 적용** — ROI 가장 큰 1~2 항목 (예: stream-json 기반 진행 표시, runClaudeHeadless 공통화,
   agent skill 추출 PoC).
3. **평가** — 품질·성능·비용 측정 후 다음 단계 결정.

각 단계는 별도 PR. 일관성·안전성·비용에 모두 영향을 미치므로 신중히 진행.

진척:

- [x] **Cortex 컨텍스트 스킬 + 스폰 주입** (#173) — 정적 방법론은 \`cortex\` 스킬(설정에서
      \`~/.claude/skills/cortex\` 설치)로, 동적 상태(로드맵 남은 작업 요약 + 컨벤션 안내)는
      위임 세션 초기 prompt 앞에 주입(\`buildCortexContextPreamble\`). 불러온 프로젝트에서
      claude 가 Cortex 맥락을 갖고 시작. (사용자 시그널: "불러온 프로젝트에서 cortex 컨텍스트 부재")
- [ ] 후속: hooks(SessionStart) 자동 주입 · MCP 도구 노출 · stream-json 진행 표시 · 모델 escalation 등.

## Phase 14 — /help 인터랙티브 도움말

- [x] HelpOverlay + spotlight — #127
- [x] 가이드 투어
- [x] ? 단축키
- [ ] 인터랙티브 contextual 도움말 (재정의) — 현재 오버레이/스포트라이트 형태가 아니라, 실제
      화면 요소에 hover/focus in·out 할 때 그 요소 설명 툴팁이 인라인으로 뜨는 방식. 요소 단위
      contextual 가이드로 대체.

## Phase 15 — UI/UX · 최적화 (지속)

- [x] 텍스트 최소화 원칙 (AGENTS §2 박제 — 상태 중복 텍스트 제거)
- [x] 죽은 코드 / 미사용 UI 정리 (formatAge 중복 · getNote · disabled 클러스터 버튼)
- [x] 터미널 폰트 monospace 교정
- [x] ReportsCharts 색 디자인 토큰화 (Recharts 런타임 CSS var) — #153
- [x] 미정의 DS 타이포 토큰 정의 (font-size 10·11, letter-spacing-wide) — #155
- [x] 프로젝트 카드 spacing·typography DS 정렬 — #150
- [ ] 디자인 시스템 미준수 / 어색한 부분 점진 교정
- [ ] 패키징 전 전체 UI/UX 검토 패스
- [ ] 반응형 디자인 — 좁은 화면·모바일·태블릿·세로 모니터에서 레이아웃 적응 (사이드바 collapse,
      대시보드 그리드, 에이전트 드로어, 모달 브레이크포인트). 현재는 데스크톱 가로 기준 고정. — 진행 중

## Phase 16 — 세션 연속성 (.cortex work-state)

- [ ] .cortex/ work-state 파일 (진행 중 브랜치·worktree·다음 단계)
- [ ] 새 세션 onboarding 시 먼저 읽기 (README→AGENTS 다음)
- [ ] 메타 schema v1 (사람·에이전트 공용)
- [ ] 에이전트 작업은 worktree 격리 — 별도 worktree(임시 디렉토리+전용 브랜치)에서 claude spawn, 메인 작업트리 무오염 (dev 서버 코드베이스 보호)
- [x] claude --resume 로 서버 재시작에도 대화 세션 연속 (세션 메타 영속 → dormant 복원 → --resume) — #147

## Phase 17 — DB 중앙화 (멀티 환경 일관성)

- [ ] 로컬 SQLite → 중앙 DB (여러 머신·환경 간 작업 상태 일관성)
- [ ] 환경별 접속 설정 + 마이그레이션 경로 (단일 사용자 가정 유지)
- [ ] 오프라인/로컬 폴백 검토

## Phase 18 — 이슈·TODO·로드맵 통합

세 시스템을 묶어 사용성 향상 — 로드맵 산출물 ⊃ 이슈 ⊃ TODO 의 고도(altitude) 계층.

- [x] 데이터 연결 레이어 — `issues.roadmapItemId`, `todos.issueId` nullable FK + 마이그레이션 0017 +
      `linkIssueToRoadmapItem`/`linkTodoToIssue` + 상세/뷰 노출 + 테스트 — #159
- [ ] 통합 "작업" 뷰 — 로드맵 Phase ▸ 연결된 이슈 ▸ 그 이슈의 TODO/결과 PR 계층을 한 화면에.
      대시보드 "지금 처리할 것" 도 세 소스 통합.
- [x] 링크 설정 UI — 이슈 상세에서 로드맵 산출물 선택 + TODO 행에서 이슈 연결/해제 (select/chip)
- [ ] 승격 플로우 — TODO →(이슈로 승격 = Claude 위임)→(로드맵 항목 연결).
- [ ] 공통 상태 어휘 정규화 (planned/open → in-progress → done) + 상태 칩 컴포넌트 공유.

## Phase 19 — 외부 노출 + 인증 (Cloudflare)

현재는 localhost 단일 사용자 가정(인증 없음). Cloudflare(Tunnel/Access)로 외부 노출하면 인증 필수.

- [ ] Cloudflare Tunnel/Access 로 안전한 외부 노출 (오리진 직접 노출 금지, TLS 종단)
- [ ] 인증 게이트 — Cloudflare Access(IdP) 또는 앱 레벨 세션으로 모든 라우트 보호.
- [ ] **pty ws(`/api/pty`) · 세션 제어(`/api/sessions`) 엔드포인트 인증·인가** — 현재 무인증.
      공개 노출 시 치명적(claude spawn·터미널 입출력·세션 종료를 누구나 호출 가능).
- [ ] webhook(`/api/webhooks/github`)은 서명 검증 유지하되 Access 게이트 우회 경로 허용(서비스 토큰).
- [ ] `currentUser` 하드코딩 제거 → 인증 주체와 연동 (이슈/PR assignee, 활동 로그).
