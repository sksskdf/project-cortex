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
- [x] 전역 AI 토글(settings.aiEnabled) + **프로젝트별 AI 사전 리뷰 토글**(aiReviewEnabled, 둘이 AND) — #179

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
- [ ] 위험 플래그·신뢰 점수 정확도 개선 (오탐/미탐 감소, 머지 결과 피드백 학습) **[게이트: 런타임
      피드백 루프 필요]** — 머지 결과 학습은 실제 머지 이력·LLM 출력 corpus 가 쌓여야 측정 가능.
      휴리스틱 플래그(`risk-flags`)는 결정적이라 테스트 완비(15건). LLM 정확도 튜닝은 사용자 머신.
- [x] 인라인 코멘트 품질 — 라인별 지적의 정확도·실행가능성 향상. system 프롬프트에 "변경 라인을
      명확히 짚고 무엇을 어떻게 고칠지(또는 왜 위험한지) 한 줄, 추측성·일반론 금지" 규칙 박제 +
      whatToCheck 를 `<페이지·파일:line> 에서 <액션> → <결과>` 형식으로 강제(좋은/나쁜 예시 포함).
- [x] 컨텍스트 추가 보강 — **위임 이슈 spec 주입** (`getIssueContextForPR` — agent_runs.outputPrId
      매칭 이슈의 title+spec 을 사전 리뷰 user 프롬프트에 "수용 기준" 섹션으로 포함). 사람 PR/
      미위임 PR 은 컨텍스트 없이 진행(무회귀). 1500자 자르기로 토큰 보호. 관련 파일·이전 리뷰
      컨텍스트는 후속.
- [x] 대형 diff 재검토 — 청크 분할·핵심 hunk 우선. `diff-budget` 가 위험 도메인 우선 정렬 +
      lock/generated 본문 제외 + 예산 초과 시 자르고 노트(잘린 파일 경로 노출로 LLM 이 분석 범위
      인지). LLM 요약(summarization)은 런타임 영역으로 후속.
- [ ] 리뷰 프롬프트/모델 튜닝 + 회귀 평가 세트 (지속적 품질 관리) **[게이트: LLM corpus 필요]** —
      정책 게이트(`decideTriage`)는 결정적이라 회귀 테스트 완비(25건). 프롬프트/모델 튜닝의 품질
      회귀 세트는 실제 LLM 출력을 채점해야 해 사용자 머신(claude CLI) 필요.

## Phase 5 — 트라이아지 엔진

- [x] runTriage (위험 아니면 자동 머지 — 신뢰점수 게이트 제거)
- [x] auto-merge 흐름 (동시 webhook race 가드)
- [x] **CI 없는 레포 자동 머지** — check run 0개면 testsPassed 가 영구 null → 무한 대기하던 문제.
      testsPassed null 이어도 mergeable_state='clean'(=CI 없는 레포, GitHub 머지 가능 판정)이면
      통과. 필수 CI 가 있으면 GitHub 가 clean 을 안 줘 조기 머지 위험 0. `lib/merge-gate.ts` — #184
- [x] **목록(인박스/대시보드) 머지버튼 disable + 불가 사유 인라인 표시** — PR 상세와 동일 게이트
      (merge-gate) 공유. prs.mergeableState 저장(migration 0022, sync 가 getPRMergeStatus 로 갱신) — #184

## Phase 6 — 클러스터링

- [x] jaccard 유사도
- [x] tryClusterPR + dissolveCluster
- [x] 클러스터링 사용성 검토 — 실사용 저조. **결정(2026-05-29, 사용자 "추천으로 진행"): cut(소프트).**
      sync 의 자동 클러스터링 호출 제거(신규 클러스터 미형성) + 사이드바 네비에서 제외. **데이터·스키마
      ·라우트(/clusters)·lib 은 보존** — 기존 클러스터는 /clusters URL 로 여전히 dissolve/관리 가능, PR
      숨김/고립 없음(필터 그대로지만 신규 clusterId 미부여라 무력화). 전면 삭제(스키마/UI 27파일)는
      blast radius 커서 별도 확인 시 진행.

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
      installation→App 자격증명 해석 + 다중 webhook secret 검증 + import 가 모든 App 순회.
      .env.local 단일 App 은 폴백으로 유지.
- [x] 안전 기본값 — 회사/조직 레포 보호. 웹훅 자동 onboard 시 autoMergeEnabled=false 디폴트(기존
      true 에서 변경), 브랜치 자동 삭제 토글(autoDeleteBranchEnabled) 신설·디폴트 OFF 로 자동/클러스터
      머지 후 삭제 게이트. /projects 카드에 두 토글. CI 대기 문구도 정책(자동/직접 머지)에 맞게 분기.
- [x] 프로젝트 뮤트 — 조직의 남의 레포/관심 없는 프로젝트가 인박스를 어지럽히는 문제. projects.muted
      신설(migration 0021). 웹훅 자동 onboard 는 **muted=true 로 시작**(감지만, 관리 차단) — PR/check
      webhook ingest·분석·트라이아지·자동머지 스킵, 인박스에서도 제외. /projects 엔 "뮤트됨" 배지 +
      "관리 시작" 토글로 노출해 언제든 재개. 수동 등록/import 는 muted=false. **완전 적용(#183)** —
      인박스 사이드바 카운트·대시보드 '지금 처리할 것'·'검토 대기' stat 에서도 뮤트 PR 제외.

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

- [ ] 로드맵 상·하단 중복 뷰 통합 (상단 베이스 + 산출물 추가) **[게이트: UI/UX 판단 필요]** —
      RoadmapOpenItems(남은 작업 패널) ↔ RoadmapBoard(전체 보드) 중복. 통합/제거는 시각 확인이
      필요한 레이아웃 결정이라 블라인드 재구성 보류.
- [x] UI 에서 산출물(item) 추가·편집 — `RoadmapBoard` 에 phase/item 생성·삭제·상태토글·제목
      인라인 편집(createItem/deleteItem/toggleItemStatus/updateItemTitle 액션) 모두 구현됨(#203 등).
- [~] Cortex UI 토글 → git roadmap.md — **직렬화 코어 완료** (`serializeRoadmapToMd` — DB 로드맵을
      parseRoadmapMd 가 다시 읽는 markdown 으로, round-trip 테스트). PR 생성 UI(octokit 브랜치+커밋
      +PR)는 자동/수동 UX 결정 + 런타임 검증 필요로 후속.
- [x] cortex marker 인식으로 무한 sync 방지 — `CORTEX_SYNC_MARKER`(`Cortex-Sync: roadmap` trailer)
      + `isCortexSyncCommit`. push webhook 이 .cortex 변경 commit 이 전부 Cortex 자신이 만든 것이면
      git→Cortex sync skip(`cortex-authored-sync`) — Cortex→git→Cortex 무한 루프 차단. 테스트 4건.
- [ ] 자동 양방향 동기화 — 수동 '.cortex 동기화' 버튼 대신 프로젝트 .cortex 를 감시해 자동 반영.
      **[게이트: 자동 PR UX 결정 + 런타임]** — 마커 루프 방지(완료)·직렬화(완료)는 준비됨. Cortex→git
      자동 PR 의 빈도·트리거(토글마다 vs 배치)는 사용자 결정 + octokit PR 생성은 런타임 검증 필요.

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
- [x] 반복 한계 가드(PR당 3회) + fork 제외. **작성자 무관** — 단일 사용자 가정상 사람/agent
      모두 내 PR (#187, 기존 'agent PR 만' 가드 제거) — #148·#187
- [x] autoResolveChangesEnabled 토글 (디폴트 OFF, .cortex/project.yml) + /projects 카드 UI 토글 — #148·#186

## Phase 13.2 — 병합 충돌 자동 해결

- [x] mergeable_state=dirty 자동 해결 (merge base→head + claude 마커 해소) — #135
- [x] 충돌 크기 한계(10파일) + fork 제외. **작성자 무관** — 자동 머지 PR 은 머지 직전(auto-merge.ts),
      그 외(사람·플래그 차단·미분석)는 sync 가 dirty 감지 시 백그라운드 해결 (#187)
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
            이슈를 done 으로. 대화형 세션 미종료/대시보드 '진행 중' 잔류 해소(수동). (#172)
      - [x] **서버 재시작 시 orphan 정리** — 라이브 pty 세션은 프로세스와 함께 죽으므로 재시작 직후
            남은 running/queued agent_run 은 고아 → failed 로 마감. 세션 메타에 runId 영속해
            복원 가능한 세션은 정리 제외(종료 시 finishAgentRun 마감 유지). (#204)
      - [x] **idle 타임아웃** — 서버가 안 죽은 채 오래 방치된 케이스 보완. `reconcileStaleRuns(24h)`
            가 startedAt 기준 24h+ running/queued 를 failed 로 마감(startedAt null 은 제외). pty 부팅
            +1h 주기 스윕(unref). 보수적 임계라 정상 작업은 그 전 종료. 결과 PR 머지 연동(c)은 후속 선택.

## Phase 13.5 — claude CLI 활용 고도화·최적화 (검토)

현재 claude CLI 가 지원하는 기능을 효율·효과적으로 쓰기 위한 검토 항목.

- [x] 세션 영속/복원 — `--session-id`(생성 시 id 고정) + `--resume`(재시작 후 대화 연속) — #147
- [x] 위임 작업 지시 — interactive 세션에 bracketed-paste 로 초기 prompt 주입 — #157
- [ ] headless 호출 최적화 — `-p --output-format json` 모델 선택·토큰·타임아웃·재시도 튜닝
      **[게이트: 런타임 튜닝]** — 모델 선택(R5 fallback)·json 봉투·재시도는 구현됨(claude-cli.ts).
      타임아웃·재시도 수치 "튜닝"은 실제 호출 지연·실패율 측정 필요(사용자 머신).
- [~] `--continue` 폴백 / MCP 서버 연결 / 도구 권한 정책 / 세션 비용·토큰 측정 / **CLI 버전 추적**:
      - [x] 세션 비용·토큰 측정 — `recordLlmUsage`(R3, llm_usage 테이블 + /reports 집계).
      - [x] CLI 버전 추적 — `getClaudeCliVersion`(`claude --version` 첫 토큰, 미설치 시 null,
            서버 시작 시 로깅). 회귀 가드(지원 플래그·스키마 변동 진단). parseClaudeVersion 순수
            테스트 4건.
      - 나머지(--continue 폴백·MCP 서버·도구 권한 정책)는 **[게이트: 런타임 — claude CLI 필요]**.
        특히 도구 권한(allowedTools)은 잘못된 허용목록이 자동 수정을 깨뜨릴 수 있어 런타임 검증 필수.

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
     (input/output tokens)를 wrapper 가 추출(`ClaudeUsage`) + 호출별 구조화 로깅(Pino). 새 플래그
     없이 봉투만 읽어 **무회귀**. 06-15 크레딧 변경 대비 가시화. extractResult 단위 테스트.
   - [x] **R5 `--fallback-model`** — 본 분석(Opus) 과부하·은퇴 시 Sonnet 자동 폴백(print 모드 전용).
     wrapper `fallbackModel` 옵션 + 분석 호출에 적용. 미지원 CLI 는 read-only 재시도로 degrade(무회귀).
   - [x] **R3 2단계 — 비용 영속 + /reports 집계** — `llm_usage` 테이블(migration 0026). wrapper 가
     성공 시 봉투의 비용·토큰을 best-effort 기록(`recordLlmUsage`). `getLlmCostSummary`(누적·최근 7일·
     모델별) + /reports "LLM 비용·사용량" 섹션. 단위 테스트 4건. (06-15 크레딧 변경 가시화.)
   - [ ] 후속: R4 권한 정밀화(allowedTools/dontAsk).
3. [ ] **평가** — 품질·성능·비용 측정 후 다음 단계 결정.

각 단계는 별도 PR. 일관성·안전성·비용에 모두 영향을 미치므로 신중히 진행.

진척:

- [x] **Cortex 컨텍스트 스킬 + 스폰 주입** (#173) — 정적 방법론은 \`cortex\` 스킬(설정에서
      \`~/.claude/skills/cortex\` 설치)로, 동적 상태(로드맵 남은 작업 요약 + 컨벤션 안내)는
      위임 세션 초기 prompt 앞에 주입(\`buildCortexContextPreamble\`). 불러온 프로젝트에서
      claude 가 Cortex 맥락을 갖고 시작. (사용자 시그널: "불러온 프로젝트에서 cortex 컨텍스트 부재")
- [x] **`.cortex` 스킬·지침 항상 글로벌 적용** (사용자 시그널 2026-05-29) — 3축 모두 적용:
      (1) **서버 시작 시 자동 설치** (pty.ts startup → `installCortexSkill`, 멱등) — 사용자가
      settings 버튼 안 눌러도 보장. (2) **위임 spawn 시** `buildCortexContextPreamble` 로 동적
      상태(로드맵/이슈) 주입(#173). (3) **자동화 헤드리스**(test-fix·conflict-resolve·review-fix)
      에 `CORTEX_HEADLESS_GUIDANCE` 주입(R2). pre-review 는 분석(읽기) 작업이라 git 가드 적용
      의미 없어 제외(토큰 비용만 발생).
- [ ] 후속: hooks(SessionStart) 자동 주입 · MCP 도구 노출 · stream-json 진행 표시 · 모델 escalation 등.

## Phase 14 — /help 인터랙티브 도움말

- [x] HelpOverlay + spotlight — #127
- [x] 가이드 투어
- [x] ? 단축키
- [x] 인터랙티브 contextual 도움말 (재정의) — 요소 hover/focus 시 인라인 설명 툴팁. 순수 CSS
      `InfoTip` 컴포넌트(서버 호환, :hover/:focus-within) + 라이브 상태 스트립의 비자명 지표
      (진행 중 위임·자동화·검토 대기·미확인 머지)에 적용. 다른 비자명 컨트롤로 점진 확대 가능.

## Phase 15 — UI/UX · 최적화 (지속)

- [x] 텍스트 최소화 원칙 (AGENTS §2 박제 — 상태 중복 텍스트 제거)
- [x] 죽은 코드 / 미사용 UI 정리 (formatAge 중복 · getNote · disabled 클러스터 버튼)
- [x] 터미널 폰트 monospace 교정
- [x] ReportsCharts 색 디자인 토큰화 (Recharts 런타임 CSS var) — #153
- [x] 미정의 DS 타이포 토큰 정의 (font-size 10·11, letter-spacing-wide) — #155
- [x] 프로젝트 카드 spacing·typography DS 정렬 — #150
- [x] /projects 카드 자동화 토글 **스위치화 + 액션 버튼 분리** (ds-btn 알약 6개 난잡 → '자동화'
      스위치 그룹 + 마스터 'Cortex 관리' 스위치) — #182, 자동화 패널 완성(테스트수정·리뷰반영 토글) #186
- [x] 뮤트(Cortex 관리 OFF) 시 하위 자동화 토글 비활성 + OFF 표시 — #185
- [x] 최근 머지 목록에 #PR번호 노출 — #187
- [ ] 디자인 시스템 미준수 / 어색한 부분 점진 교정 — **하드코딩 색상 토큰화 패스 완료**: 컴포넌트
      CSS 의 하드코딩 hex(switch knob `#ffffff` 2곳)를 canonical `--ds-color-bg-00` 으로 통일.
      이제 컴포넌트 CSS 에 하드코딩 색 0(rgba 그림자만, 표준). global-error.tsx 는 테마 로드 실패
      시 렌더되는 폴백이라 의도적 하드코딩 유지. 나머지 "어색한 부분"은 시각 확인 필요(점진).
- [ ] 패키징 전 전체 UI/UX 검토 패스 **[게이트: 시각 검증 필요]**
- [ ] 반응형 디자인 — 좁은 화면·모바일·태블릿·세로 모니터에서 레이아웃 적응 (사이드바 collapse,
      대시보드 그리드, 에이전트 드로어, 모달 브레이크포인트). 현재는 데스크톱 가로 기준 고정. — 진행 중

### 중간 점검 패스 (2026-05-29) — 트랙 C(로드맵 위생) → B(내부 품질) → A(사용성)

**트랙 B · 내부 품질**

- [x] (1) 7개 토글 컴포넌트 복붙 → `useOptimisticToggle` 훅 + `ProjectAutomationToggle` 제네릭 (−187줄) — #189
- [x] (2) `listProjectsWithStats` N+1(1+3N) → 배치 3쿼리 — #190
- [x] (3) 핫 컬럼 인덱스(`prs(repo_id,status)`·`projects(installation_id)`, migration 0023) — #190
- [x] (4) 자동화 알림 종류 분리 — analysis/conflict/test/review 실패가 모두 'auto-merge-failed'
      재사용이라 구분 불가하던 걸 전용 kind 로. + 성공도 알림(자동화 가시성). — 이 묶음
- [x] (5) 토글 동시 클릭 race 가드 — `useOptimisticToggle` 에 inFlight ref 잠금. 이전 토글
      in-flight 중 들어온 클릭 무시(첫 클릭 직렬화)로 낙관 값↔서버 상태 어긋남(깜빡임) 방지.

**트랙 A · 사용성 스윕** — 전체 흐름·사용성 홀 분석(2026-05-29) 기반. ROI 순:

- [x] (A0) 자동화 가시성 1단계 — 알림 종류 분리 + 성공/실패 표면화 (위 B4 와 동일 PR)
- [x] (A1) **백그라운드 자동화 in-flight 표시** — 인메모리 레지스트리(automation-state, 프로세스
      재시작 시 자연 소멸)로 충돌해결·테스트수정·리뷰반영 도는 중을 인박스 행 칩 + PR 상세 배너 — #199
- [x] (A2) **토스트 시스템** — 인앱 토스트(#194) + SSE 알림 자동 표면화 + PR 상세 액션 결과(#195)
- [x] (A3) **막다른 길 복구 CTA** — disabled 컨트롤 사유/준비중(#193) + 멈춘 agent_run 안내(#196).
      ('분석 재요청' 은 미분석 PR 상세에 이미 존재 — AnalyzeRequestButton)
- [x] (A4) **error.tsx / loading.tsx / not-found 경계** — #192
- [x] (A5) **disabled 컨트롤 설명** — 인박스 알림·필터·정렬 탭, 대시보드 더보기 준비중 — #193
- [x] (A6) 텍스트 상태 중복 — 검토 결과 PR 상세에 실제 중복 없음(AnalyzeRequestButton 은 미분석 PR
      전용, 상태 배지와 비중복). 별도 조치 불필요로 종결.
- [x] (A7-1) 모달 포커스 트랩/복원/Escape/ARIA — `useFocusTrap` 훅(Tab 순환 트랩 + 초기 포커스 +
      Escape 닫기 + 포커스 복원)이 모든 모달(ActionablePeekModal·PRPeekModal·RoadmapDrawer·
      HelpOverlay·ImportInstalledRepos·NewIssueDialog)에 적용 + 각 모달 role="dialog"·aria-modal·
      aria-label(ledby). NotificationDropdown 은 드롭다운이라 Escape 닫기만(트랩 부적합).
- [ ] (A7-2) 반응형 디자인 — Phase 15 반응형 항목과 동일. 단일 사용자라 최하 우선순위. **[게이트:
      시각 검증 필요]** — 레이아웃 브레이크포인트는 실제 화면 없이 검증 불가.

> 갭 분석 요약: 이 도구의 본질은 "자동화 신뢰"인데 자동화가 **조용히 돌고 조용히 실패**하던 게
> 최대 홀. 단일 사용자 localhost 라 반응형·a11y 보다 **피드백·가시성·막다른 길 복구**가 우선.

## Phase 16 — 세션 연속성 (.cortex work-state)

- [x] .cortex/ work-state 파일 (진행 중 브랜치·worktree·다음 단계) — `lib/work-state` 파서+직렬화 (#201)
- [x] 새 세션 onboarding 시 먼저 읽기 (README→AGENTS 다음) — AGENTS.md 가 work-state 포인터 안내 (#201)
- [x] 메타 schema v1 (사람·에이전트 공용) — `WorkStateV1` 스키마 + 관대한 파서 (#201)
- [x] 에이전트 작업은 worktree 격리 — `lib/agent-worktree`(create/remove, 결정적 형제 경로 +
      전용 브랜치 `cortex/session-<id>`) + pty `resolveSpawnCwd`(ON 일 때 worktree, 아니면 워크스페이스
      cwd) + 종료 시 정리. **설정 토글 `agentWorktreeEnabled` 기본 OFF(opt-in)** — OFF 면 기존 동작
      그대로(무회귀). worktree git 동작은 실제 git 통합 테스트로 검증(샌드박스 claude 부재라 claude
      spawn-in-worktree·resume 동작만 사용자 머신 검증 필요). 동기 git(execFileSync) — 단일 사용자
      localhost 기준 허용. 종료 시 정리 + **서버 시작 시 고아 worktree prune**(`pruneOrphanWorktrees` —
      크래시로 정리 못 한 잔존분 제거, 복원 세션 worktree 는 보존). 실제 git 통합 테스트로 검증.
- [x] claude --resume 로 서버 재시작에도 대화 세션 연속 (세션 메타 영속 → dormant 복원 → --resume) — #147

## Phase 18 — 이슈·TODO·로드맵 통합

세 시스템을 묶어 사용성 향상 — 로드맵 산출물 ⊃ 이슈 ⊃ TODO 의 고도(altitude) 계층.

- [x] 데이터 연결 레이어 — `issues.roadmapItemId`, `todos.issueId` nullable FK + 마이그레이션 0017 +
      `linkIssueToRoadmapItem`/`linkTodoToIssue` + 상세/뷰 노출 + 테스트 — #159
- [x] 통합 "작업" 뷰 — `/work` 라우트(사이드바 '작업'). `getWorkView()` 가 활성 이슈를 로드맵
      산출물별로 묶고(미연결은 마지막) 각 이슈의 미완 TODO + 결과 PR(최신 run) + 세션 상태를 한
      화면에. 읽기 전용. 단위 테스트 4건.
      - [x] 대시보드 세 소스 통합 — **G1 라이브 상태 스트립**이 PR(검토 대기·미확인 머지)·이슈
            (진행 중 위임)·자동화 카운트를 대시보드 상단에 종합 표면화하고, **/work** 가 PR·이슈·TODO
            상세 계층을 통합 제공. "지금 처리할 것" 리스트는 검토 액션 중심 PR 로 유지(역할 분리).
- [x] 링크 설정 UI — 이슈 상세에서 로드맵 산출물 선택 + TODO 행에서 이슈 연결/해제 (select/chip)
- [x] 승격 플로우 — TODO →(이슈로 승격 = Claude 위임). `promoteTodoToIssue`(프로젝트 연결된
      TODO 만 승격 가능, note→spec, TODO↔이슈 연결 + in-progress). `/todos` 행에 "이슈로 승격"
      버튼 — NewIssueDialog 와 동일하게 워크스페이스 있으면 claude 세션 자동 spawn. 승격 후 이슈
      상세에서 로드맵 항목 연결은 기존 IssueRoadmapLink 로.
- [x] 공통 상태 어휘 정규화 + 상태 칩 컴포넌트 공유 — `StatusChip` (issue/todo/roadmap), `t.status` — #198

## Phase 19 — 외부 노출 + 인증 (Cloudflare)

현재는 localhost 단일 사용자 가정(인증 없음). Cloudflare(Tunnel/Access)로 외부 노출하면 인증 필수.

- [ ] Cloudflare Tunnel/Access 로 안전한 외부 노출 (오리진 직접 노출 금지, TLS 종단)
- [ ] 인증 게이트 — Cloudflare Access(IdP) 또는 앱 레벨 세션으로 모든 라우트 보호.
- [ ] **pty ws(`/api/pty`) · 세션 제어(`/api/sessions`) 엔드포인트 인증·인가** — 현재 무인증.
      공개 노출 시 치명적(claude spawn·터미널 입출력·세션 종료를 누구나 호출 가능).
- [ ] webhook(`/api/webhooks/github`)은 서명 검증 유지하되 Access 게이트 우회 경로 허용(서비스 토큰).
- [ ] `currentUser` 하드코딩 제거 → 인증 주체와 연동 (이슈/PR assignee, 활동 로그).
- [x] **Cloudflare 제거 검토 — GitHub App 웹훅이 공개 터널 없이 가능한가** — 조사 완료
      (`docs/WEBHOOK-DELIVERY.md`). 결론: 웹훅은 인바운드라 공개 주소 필수 → 웹훅 유지로는 터널
      제거 불가. **폴링 모드(GitHub App 설치 토큰으로 주기적 sync, ETag 조건부 요청)로 전환하면
      터널 완전 제거 가능**(아웃바운드만). 단일 사용자엔 폴링이 가장 적합. 옵션 A(폴링)/B(고정
      named tunnel)/C(하이브리드) 비교 + 권고 정리.
- [x] **(결정됨) 수신 모드 — 현행 웹훅 유지** (사용자 2026-05-29: "폴링은 별로, 현상태 유지").
      Cloudflare 제거(폴링)는 미채택. URL 가변성이 거슬리면 추후 옵션 B(고정 named tunnel)만 적용 가능.

## Phase 20 — PR 검토 UX (READ 마킹 · 라이트 모달 · 확인 요약)

자동 머지가 늘면서 "이미 머지됐지만 내가 아직 확인 안 한 PR" 을 가볍게 훑고 뭐가 바뀌었는지
파악하는 흐름이 필요. (사용자 시그널 2026-05-29: "PR 상세를 일일이 다 눌러 봐야 해서 불편 —
목록에서 누르면 모달로 라이트하게, 앞뒤 넘기며 READ 처리가 제일 깔끔")

- [x] **PR READ/미확인 마킹** — `prs.readAt` 컬럼(migration 0025, notifications 패턴) + `markPRRead`/
      `markPRsRead`/`unreadMergedCount`(lib/pr-read) + `markPRReadAction`. PR 상세 헤더에 확인/미확인
      토글(`PRReadToggle`, 낙관적). 대시보드 최근 머지에 미확인 점 + "최근 머지 N 미확인" 배지.
      (모달 뷰어가 앞뒤 넘김 READ 처리에 `markPRsRead` 재사용 예정.) 렌더 시각 검증은 사용자 머신에서.
- [x] **라이트 모달 뷰어** — 대시보드 최근 머지에서 행 클릭 시 페이지 이동 없이 모달(`PRPeekModal`)로
      요약(제목·규모·신뢰·요약·"확인할 부분") 표시. **앞뒤 네비게이션**(prev/next·←/→) + 넘기며 본 PR 은
      낙관적 점 제거 후 닫을 때 일괄 READ(`markPRsReadAction`). #202 포커스 트랩 재사용. `PeekItem` 은
      재사용 가능. 렌더 시각 검증은 사용자 머신에서.
      - [x] **모달 5개 제한 해제** — 행은 5개만 보여주되 모달 앞뒤 넘김은 머지 전체(200건 로드)를 순회
            (`displayLimit`). 미확인 머지 "모두 확인"(`markAllMergedRead`) 버튼도 추가.
      - [x] **액션 가능한 모달 + "지금 처리할 것" 적용** (사용자 요청 — by-design 번복) — `ActionablePeekModal`
            이 열 때/넘길 때 `getPRPeekAction`(getPRDetail 게이팅 재사용)으로 요약+액션상태 lazy fetch,
            모달 안에서 **머지/변경요청/닫기**(기존 `PRActions` 재사용) 실행. "지금 처리할 것" 행이 모달
            트리거(`TodayRows`). "전체 보기"→상세. 렌더·머지동작 시각 검증은 사용자 머신.
      - [x] **인박스 적용** — `InboxRows` 가 PRRow 를 onOpen 모드(행=모달 트리거, 인라인 액션은 모달이
            대신)로 렌더 + 동일 `ActionablePeekModal`. 최근 머지·"지금 처리할 것"·인박스 **일관 동작**.
- [x] **PR 상세 마지막 단락 = "내가 확인하면 될 부분" 요약** — 사전 리뷰가 사용자용 체크포인트
      (`whatToCheck`)를 산출(R1 json-schema 필드로 강제). preReviews.whatToCheck 컬럼(migration 0024)
      + 프롬프트/스키마 + PR 상세 마지막 섹션(액션 바 직전, 좌측 액센트). 빈 배열이면 "특이사항 없음".
      단순 PR(자동승인)은 빈 배열. 렌더 시각 검증은 사용자 머신에서.
- [x] **머지 후 워크스페이스 자동 git pull** — 자동/사람 머지 성공 시 해당 프로젝트의 등록
      워크스페이스를 `git pull --ff-only` (ambient credential, best-effort). 워크스페이스 등록이 곧
      opt-in. ff-only 라 로컬 변경/발산 시 비파괴적으로 거부. 미clone 워크스페이스는 clone 트리거 안 함.
      - [x] **결과 가시화** (사용자 보고: "자동 pull 안 되는 것 같다") — 이전엔 조용히 돌아 성공/실패
            (특히 워크스페이스가 다른 브랜치라 ff-only 거부)를 알 수 없었음. `workspace-pulled`/
            `workspace-pull-failed` 알림 추가 — 실패 사유(git 출력)까지 표면화. (근본 해결은 Phase 16
            worktree 격리 — 워크스페이스가 기본 브랜치 유지.)

## Phase 21 — 세션/프로젝트 상태 한눈 파악 (glanceability) ⚠️ 두번째 핵심 원칙

CLI claude 세션은 대화형·선형이라 길어지면 한눈에 파악하기 어렵다. Cortex 의 두번째 핵심
가치 = **현재 무슨 일이 돌고 있고 프로젝트가 어떤 상태인지 한눈에**. (사용자 시그널 2026-05-29,
신중한 검토·좋은 아이디어 필요 — 추측 구현 금지.)

- [x] **설계 제안서** — `docs/GLANCEABILITY.md`. 진단(세션 축·프로젝트 축) + 기존 자산 정리 +
      옵션 G1(라이브 상태 스트립)·G2(세션 단계 타임라인)·G3(quick-capture)·G4(프로젝트 한 줄 요약)
      ROI 비교 + 권고(G1→G3). **추측 구현 금지 지침에 따라 방향 결정 선행용.**
- [x] 상태 한눈 대시보드 강화(G1) — `getLiveStatus`(진행 중 위임·자동화 in-flight·검토 대기·미확인
      머지 집계, 기존 데이터 재집계라 추측 0) + `LiveStatusStrip`(대시보드 상단, 각 숫자 해당 목록
      링크, 라이브 항목 맥동 점). 단위 테스트. (사용자 선택: G1) 렌더 시각 검증은 사용자 머신.
- [x] **비선형 요청 캡처(G3)** (메타 원칙) — 사이드바 전역 `QuickCapture`(어느 화면에서든 한 줄 캡처
      → todos 저장, 분류는 /todos 의 이슈 연결·완료·삭제 재사용). 새 테이블 없이 todos 인프라 재사용.
      (사용자 선택: G3) 렌더 시각 검증은 사용자 머신.
- [ ] 세션 요약(G2) — 긴 선형 세션을 단계/결정/산출물로 압축. **stream-json(R6) 선행** 후 진행.

## Phase 9 후속 — 패키징 테스트성 · dev 서버 속도

- [ ] **desktop-service 패키징 테스트** — hot-reload dev 서버로 돌리고 있어 NSSM/launchd 패키징을
      아직 실검증 못 함. 프로덕션 빌드(서비스 등록) 경로 테스트 절차 마련. (진단·절차 `docs/DEV-PERFORMANCE.md`)
- [x] **dev 서버 속도 진단** — `docs/DEV-PERFORMANCE.md`. 원인: 커스텀 서버(PTY ws)라 dev 가
      Turbopack 이 아닌 webpack 경로. 권고: dev 스크립트 분리(B — Turbopack `next dev` + 필요 시
      커스텀 서버) 또는 커스텀서버 Turbopack 지원 확인(A). 측정은 사용자 머신.
      - [x] 스크립트 분리 적용 — `dev:turbo`(`next dev --turbopack`, PTY 없음·빠른 HMR, UI 전용) 추가.
            에이전트 터미널 필요 시 `dev`(커스텀 서버). 측정은 사용자 머신.

---

## 로드맵 상태 — resolved (2026-05-29, 세션 2 종료)

**§1(자율 구현 가능) 전부 완료, §2(결정) 전부 확정(채택/보류), §3(런타임·반복) 보류-with-트리거.**
즉 모든 항목이 "완료" 또는 "의식적 결정(보류·트리거 명시)" 상태 — 더 이상 open 미결 항목 없음.
남은 작업은 (a) 사용자 머신/claude 런타임 검증이 본질적으로 선행되거나(§3), (b) 보류 트리거가
발생해야(§2) 재개되는 것들이라, 이 (브라우저·claude CLI·dev 서버 없는) 샌드박스에서 더 진행하는
것은 블라인드 위험. 트리거/지시 시 즉시 재개.

### 1) 자율 구현 가능 — ✅ 전부 완료 (#204~#220)

- ✅ (Phase 13.4) orphan 정리(#204) + idle 타임아웃 자동 완료(#213).
- ✅ (Phase 20) PR 검토 UX 전체: READ 마킹 · 라이트/액션 모달(앞뒤 넘김·READ·**모달 내 머지/변경요청**)
  — 최근 머지·"지금 처리할 것"·인박스 일관 · "확인할 부분" 요약 · 머지 후 자동 pull(+결과 알림) ·
  미확인 일괄 확인 · 모달 무제한 넘김.
- ✅ (Phase 13.6) CLI 활용 1단계: R1 json-schema · R2 스킬 전역 · R3 비용 관측+/reports 집계 ·
  R5 fallback-model + 리서치 보고서.
- ✅ (Phase 21) glanceability: G1 라이브 상태 스트립 · G3 quick-capture.
- ✅ (Phase 18) 통합 "작업" 뷰 `/work`. (Phase 14) InfoTip 툴팁. (Phase 10.4) RoadmapBoard CRUD.
- ✅ (Phase 16) work-state(#201) + **worktree 격리(#220, 기본 OFF·런타임 검증 후 ON)**.
- ✅ (Phase 6) 클러스터링 **soft-cut**(#214 — 자동 클러스터링 비활성·네비 제외, 데이터 보존).
- ✅ (Phase 9 후속) dev:turbo 스크립트(#216). 보류(저가치): (B5) 토글 race 가드.

### 2) 결정 완료 — ✅ 보류 확정 (현재 단일 사용자 localhost 기준; 트리거 시 재개)

사용자 "추천으로 진행" 위임에 따라, 아래는 현재 셋업에 불필요/시기상조라 **의식적 보류**로 확정.
각 항목의 재개 트리거를 명시 — 그 상황이 오면 다시 연다.

- ✅ **(결정됨) 수신 모드** — 현행 웹훅 유지(폴링 미채택). (`docs/WEBHOOK-DELIVERY.md`)
- ✅ **(결정됨) glanceability** — G1+G3 채택·구현. (`docs/GLANCEABILITY.md`)
- ✅ **(결정됨) Phase 13.4 자동완료** — (a) idle 타임아웃 채택·구현(#213). (c) 결과 PR 연동은 outputPrId
  배선(미구현) 선행 필요라 보류.
- ⏸ **Phase 17 DB 중앙화** — **보류**. 단일 사용자 localhost 엔 SQLite 로 충분. **재개 트리거: 멀티 머신/환경
  공유 필요시.**
- ⏸ **Phase 19 외부 노출 + 인증** — **보류**. 현재 외부 노출 안 함(웹훅 유지). **재개 트리거: 외부 노출 결정
  시(그때 pty/세션 인증 필수).**
- ⏸ **Phase 8 새 리포 생성(PAT)/로컬-먼저** — **보류**. 웹훅 자동 onboard + import 로 충분. **재개 트리거:
  로컬에만 있는 repo 등록/신규 repo 생성 워크플로 필요시(PAT 시크릿 정책·slug nullable 스키마 동반).**
- ⏸ **Phase 6 클러스터링 잔여(전면 삭제)** — soft-cut 으로 비활성. 전면 삭제(스키마/UI 27파일)는 blast
  radius 커서 **보류**. **재개 트리거: 완전 제거 명시 요청 시.**

### 3) 런타임·반복 검증 선행 — 샌드박스 자율 완료 불가 (사용자 머신/데이터 필요)

이 환경엔 브라우저·claude CLI·dev 서버가 없어 **블라인드 구현이 위험**하거나, 데이터 축적이 필요해
1회 PR 로 "완료"되지 않는 항목. 안전하게 진행하려면 사용자 머신 검증/데이터가 선행되어야 한다.

- ⏸ **Phase 13.5/13.6 고도화(잔여)** — stream-json 진행 표시 · MCP 도구 노출 · hooks · 모델 escalation ·
  R4 권한 정밀화. claude CLI 런타임 검증 선행. (G2 세션 타임라인은 stream-json 의존.)
- ⏸ **Phase 4.7 AI 리뷰 품질** — 실 머지 피드백·프롬프트/모델 튜닝·회귀셋. 데이터 기반 반복.
- ⏸ **Phase 9 패키징 테스트** — 프로덕션 빌드 + 실제 OS 서비스 등록(사용자 머신). 진단 `docs/DEV-PERFORMANCE.md`.
- ⏸ **Phase 15 반응형** — 사용자가 최하 우선순위로 둠. 다중 브레이크포인트 시각 검증 필요.
- ⏸ **Phase 10.4 자동 양방향 sync** — Cortex→git 자동 PR + marker 무한루프 방지. git-write 부작용 — 검증 선행.

> **상태 요약**: §1(자율) 전부 완료. §2 결정은 모두 확정(채택 또는 보류-with-트리거). §3 은 사용자
> 머신/claude 런타임 검증이 본질적으로 선행되어야 하는 항목 — 샌드박스에서 블라인드로 끝낼 수 없다.
> **이 시점의 로드맵은 "자율 가능 범위 완주 + 나머지는 의식적 보류/런타임-게이트"로 resolved 상태.**
> 보류 항목은 위 트리거가 발생하거나 사용자가 명시 지시하면 즉시 재개.
