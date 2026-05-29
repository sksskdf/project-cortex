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
- [ ] 위험 플래그·신뢰 점수 정확도 개선 (오탐/미탐 감소, 머지 결과 피드백 학습)
- [ ] 인라인 코멘트 품질 — 라인별 지적의 정확도·실행가능성 향상
- [ ] 컨텍스트 추가 보강 — 연결된 이슈 spec / 관련 파일 / 이전 리뷰 컨텍스트
- [ ] 대형 diff 재검토 — 청크 분할·요약·핵심 hunk 우선 검토
- [ ] 리뷰 프롬프트/모델 튜닝 + 회귀 평가 세트 (지속적 품질 관리)

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
- [ ] 클러스터링 사용성 검토 — 실사용 빈도 낮음. 제거 vs 고도화(유사 PR 자동 묶음 추천·일괄
      리뷰/머지·중복 작업 감지 등) 결정 필요.
      **중간 점검 결정(2026-05-29)**: 일단 **유지**, keep/cut 판단 보류 — 실사용 데이터 축적 후 재검토.

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
- [~] **위임 완료 처리** — agent_run 이 영영 `running` 으로 남는 문제.
      - [x] 명시적 '완료 처리' 액션 — 이슈 상세 버튼이 running/queued run 을 completed 로 마감 +
            이슈를 done 으로. 대화형 세션 미종료/대시보드 '진행 중' 잔류 해소(수동). (#172)
      - [x] **서버 재시작 시 orphan 정리** — 라이브 pty 세션은 프로세스와 함께 죽으므로 재시작 직후
            남은 running/queued agent_run 은 고아 → failed 로 마감. 세션 메타에 runId 영속해
            복원 가능한 세션은 정리 제외(종료 시 finishAgentRun 마감 유지). (#204)
      - [ ] 자동 완료 기준 (후속) — 결과 PR 생성/머지 연동, idle 타임아웃(running N시간+ 자동 failed).

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
   - [ ] 후속: R3 2단계(/reports 집계), R5 `--fallback-model`, R4 권한 정밀화(allowedTools).
3. [ ] **평가** — 품질·성능·비용 측정 후 다음 단계 결정.

각 단계는 별도 PR. 일관성·안전성·비용에 모두 영향을 미치므로 신중히 진행.

진척:

- [x] **Cortex 컨텍스트 스킬 + 스폰 주입** (#173) — 정적 방법론은 \`cortex\` 스킬(설정에서
      \`~/.claude/skills/cortex\` 설치)로, 동적 상태(로드맵 남은 작업 요약 + 컨벤션 안내)는
      위임 세션 초기 prompt 앞에 주입(\`buildCortexContextPreamble\`). 불러온 프로젝트에서
      claude 가 Cortex 맥락을 갖고 시작. (사용자 시그널: "불러온 프로젝트에서 cortex 컨텍스트 부재")
- [ ] **`.cortex` 스킬·지침 항상 글로벌 적용** (사용자 시그널 2026-05-29) — 현재 cortex 스킬은
      설정에서 `~/.claude/skills/cortex` 설치(선택). 모든 위임/헤드리스 호출에 자동·전역으로
      적용되도록 (스킬 설치 보장 + spawn 시 항상 주입 + 헤드리스 호출에도 컨텍스트 일관).
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
- [x] /projects 카드 자동화 토글 **스위치화 + 액션 버튼 분리** (ds-btn 알약 6개 난잡 → '자동화'
      스위치 그룹 + 마스터 'Cortex 관리' 스위치) — #182, 자동화 패널 완성(테스트수정·리뷰반영 토글) #186
- [x] 뮤트(Cortex 관리 OFF) 시 하위 자동화 토글 비활성 + OFF 표시 — #185
- [x] 최근 머지 목록에 #PR번호 노출 — #187
- [ ] 디자인 시스템 미준수 / 어색한 부분 점진 교정
- [ ] 패키징 전 전체 UI/UX 검토 패스
- [ ] 반응형 디자인 — 좁은 화면·모바일·태블릿·세로 모니터에서 레이아웃 적응 (사이드바 collapse,
      대시보드 그리드, 에이전트 드로어, 모달 브레이크포인트). 현재는 데스크톱 가로 기준 고정. — 진행 중

### 중간 점검 패스 (2026-05-29) — 트랙 C(로드맵 위생) → B(내부 품질) → A(사용성)

**트랙 B · 내부 품질**

- [x] (1) 7개 토글 컴포넌트 복붙 → `useOptimisticToggle` 훅 + `ProjectAutomationToggle` 제네릭 (−187줄) — #189
- [x] (2) `listProjectsWithStats` N+1(1+3N) → 배치 3쿼리 — #190
- [x] (3) 핫 컬럼 인덱스(`prs(repo_id,status)`·`projects(installation_id)`, migration 0023) — #190
- [x] (4) 자동화 알림 종류 분리 — analysis/conflict/test/review 실패가 모두 'auto-merge-failed'
      재사용이라 구분 불가하던 걸 전용 kind 로. + 성공도 알림(자동화 가시성). — 이 묶음
- [ ] (5) 토글 동시 클릭 race 가드 (단일 사용자라 후순위)

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
- [ ] (A7-1) 모달 포커스 트랩/복원/Escape/ARIA — 진행 중(별도 PR)
- [ ] (A7-2) 반응형 디자인 — Phase 15 반응형 항목과 동일. 단일 사용자라 최하 우선순위(아래 참조).

> 갭 분석 요약: 이 도구의 본질은 "자동화 신뢰"인데 자동화가 **조용히 돌고 조용히 실패**하던 게
> 최대 홀. 단일 사용자 localhost 라 반응형·a11y 보다 **피드백·가시성·막다른 길 복구**가 우선.

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
- [x] 공통 상태 어휘 정규화 + 상태 칩 컴포넌트 공유 — `StatusChip` (issue/todo/roadmap), `t.status` — #198

## Phase 19 — 외부 노출 + 인증 (Cloudflare)

현재는 localhost 단일 사용자 가정(인증 없음). Cloudflare(Tunnel/Access)로 외부 노출하면 인증 필수.

- [ ] Cloudflare Tunnel/Access 로 안전한 외부 노출 (오리진 직접 노출 금지, TLS 종단)
- [ ] 인증 게이트 — Cloudflare Access(IdP) 또는 앱 레벨 세션으로 모든 라우트 보호.
- [ ] **pty ws(`/api/pty`) · 세션 제어(`/api/sessions`) 엔드포인트 인증·인가** — 현재 무인증.
      공개 노출 시 치명적(claude spawn·터미널 입출력·세션 종료를 누구나 호출 가능).
- [ ] webhook(`/api/webhooks/github`)은 서명 검증 유지하되 Access 게이트 우회 경로 허용(서비스 토큰).
- [ ] `currentUser` 하드코딩 제거 → 인증 주체와 연동 (이슈/PR assignee, 활동 로그).
- [ ] **Cloudflare 제거 검토 — GitHub App 웹훅이 공개 터널 없이 가능한가** (사용자 시그널 2026-05-29).
      현재 Cloudflare 게스트 터널로 웹훅 수신 → URL 이 계속 바뀜. 검토 결론(요지): GitHub 웹훅은
      **GitHub→내 서버로의 인바운드 HTTP** 라 어떤 형태로든 공개 도달 주소가 필요(웹훅 자체는
      터널을 없앨 수 없음). 단, **게스트 터널의 URL 가변성**은 (a) named tunnel(고정 도메인) (b)
      GitHub App 의 webhook URL 을 한 번만 등록 후 고정 (c) 폴링 대안(App 자격으로 주기적 sync)
      으로 완화 가능. → 옵션 비교·결정 필요(별도 검토 doc).

## Phase 20 — PR 검토 UX (READ 마킹 · 라이트 모달 · 확인 요약)

자동 머지가 늘면서 "이미 머지됐지만 내가 아직 확인 안 한 PR" 을 가볍게 훑고 뭐가 바뀌었는지
파악하는 흐름이 필요. (사용자 시그널 2026-05-29: "PR 상세를 일일이 다 눌러 봐야 해서 불편 —
목록에서 누르면 모달로 라이트하게, 앞뒤 넘기며 READ 처리가 제일 깔끔")

- [ ] **PR READ/미확인 마킹** — 이미 자동 머지된 PR 중 내가 확인한 것 추적. prs 에 readAt(또는
      reviewedAt) 컬럼 + 확인/미확인 토글 액션. 목록·대시보드에 미확인 배지.
- [ ] **라이트 모달 뷰어** — 목록(대시보드 최근 머지 + 인박스)에서 PR 클릭 시 페이지 이동 없이
      모달로 PR 상세 요약 표시. **앞뒤 네비게이션**(prev/next)으로 넘기며 READ 처리. 인박스·
      대시보드 **일관**된 동작. (포커스 트랩은 A7-1 #202 재사용.)
- [x] **PR 상세 마지막 단락 = "내가 확인하면 될 부분" 요약** — 사전 리뷰가 사용자용 체크포인트
      (`whatToCheck`)를 산출(R1 json-schema 필드로 강제). preReviews.whatToCheck 컬럼(migration 0024)
      + 프롬프트/스키마 + PR 상세 마지막 섹션(액션 바 직전, 좌측 액센트). 빈 배열이면 "특이사항 없음".
      단순 PR(자동승인)은 빈 배열. 렌더 시각 검증은 사용자 머신에서.
- [x] **머지 후 워크스페이스 자동 git pull** — 자동/사람 머지 성공 시 해당 프로젝트의 등록
      워크스페이스를 `git pull --ff-only` (ambient credential, best-effort, 실패 무시). 워크스페이스
      등록이 곧 opt-in. ff-only 라 로컬 변경/발산 시 비파괴적으로 거부. 미clone(빈 디렉토리)
      워크스페이스는 머지 이벤트에서 무거운 clone 트리거 안 함(수동 '리포 받아오기'로).

## Phase 21 — 세션/프로젝트 상태 한눈 파악 (glanceability) ⚠️ 두번째 핵심 원칙

CLI claude 세션은 대화형·선형이라 길어지면 한눈에 파악하기 어렵다. Cortex 의 두번째 핵심
가치 = **현재 무슨 일이 돌고 있고 프로젝트가 어떤 상태인지 한눈에**. (사용자 시그널 2026-05-29,
신중한 검토·좋은 아이디어 필요 — 추측 구현 금지.)

- [ ] 상태 한눈 대시보드 강화 — 진행 중 위임/자동화(in-flight, A1 확장)·각 프로젝트 진척·대기 중
      검토를 한 화면 타임라인/보드로. (설계 검토 선행.)
- [ ] 세션 요약 — 긴 선형 세션을 단계/결정/산출물로 압축 표시(세션 타임라인). claude CLI
      stream-json(Phase 13.6) 진행 이벤트 활용 검토.
- [ ] **비선형 요청 캡처** (메타 원칙) — 사용자 요청이 병렬·인터럽트성이라 누락되기 쉬움. 흩어진
      요청을 즉시 캡처해 로드맵/이슈로 연결하는 흐름(quick-capture inbox → 분류). 이 누락 패턴
      자체가 Cortex 가 풀어야 할 문제. (현재는 수동으로 roadmap 에 박제 — 자동화 검토.)

## Phase 9 후속 — 패키징 테스트성 · dev 서버 속도

- [ ] **desktop-service 패키징 테스트** — hot-reload dev 서버로 돌리고 있어 NSSM/launchd 패키징을
      아직 실검증 못 함. 프로덕션 빌드(서비스 등록) 경로 테스트 절차 마련.
- [ ] **dev 서버 속도** — 느린 원인 진단(커스텀 서버 + ws + better-sqlite3 + Next dev). turbopack/
      빌드 캐시·HMR 범위·불필요 재컴파일 점검.

---

## 로드맵 완료 — 남은 항목 분류 (2026-05-29 기준)

자율 구현 가능한 트랙 A/B + 보조 항목은 모두 처리(#188~#199). 남은 `[ ]` 는 셋으로 갈린다.

### 1) 자율 구현 가능 — 진행 중/예정 (결정 불필요)

- (A7-1) 모달 포커스 트랩 — 진행 중. (Phase 16) `.cortex/work-state` 파일 — 진행 중.
- (B5) 토글 race 가드 — 소규모, 단일 사용자라 후순위지만 구현 가능.
- (Phase 18) 통합 "작업" 뷰 + 승격 플로우 — 구현 가능(중규모 UI).
- (Phase 14) 요소 단위 contextual 도움말 — 구현 가능(중규모).
- (Phase 10.4) UI 에서 로드맵 산출물 추가·편집 — 구현 가능(중규모, roadmap CRUD).
- **(Phase 20) PR 검토 UX** — READ 마킹 · 라이트 모달 뷰어 · "확인할 부분" 요약 · 머지 후 자동 pull.
  자율 구현 가능, ROI 높음(자동 머지 신뢰 흐름 직결). 2026-05-29 인입.
- (Phase 9 후속) dev 서버 속도 진단 — 구현/진단 가능. 패키징 테스트는 런타임 검증(§3) 성격.
- (Phase 13.6) `.cortex` 스킬 전역 적용 — 구현 가능(스킬 설치 보장 + 주입 일관).

### 2) 사용자 결정 필요 — 결정하면 즉시 구현 (completion 차단)

- **Phase 6 클러스터링 keep/cut** — 실사용 저조. "유지/제거/고도화" 중 택. (현재: 유지·보류)
- **Phase 8 새 리포 생성(PAT)** — fine-grained PAT 발급·저장 정책 필요(보안). PAT 주입 방식 결정 시 구현.
- **Phase 8 로컬 경로 먼저 등록→연결** — `projects.slug` nullable/draft 스키마 방향 결정 필요.
- **Phase 13.4 위임 자동 완료 기준** — (b) 세션 사망 감지(서버 재시작 시 orphan 정리)는 #204 로 구현.
  남은 정책 택1: (a) running N시간+ 자동 idle 타임아웃 (c) 결과 PR 머지 시 완료. 정책 정하면 구현.
- **Phase 17 DB 중앙화** — 중앙 DB 선택(예: libSQL/Turso vs Postgres) + 단일 사용자 가정 유지
  범위 결정 필요. 큰 인프라 변경.
- **Phase 19 외부 노출 + 인증** — Cloudflare Tunnel/Access vs 앱 레벨 세션 등 배포·인증 모델
  결정 필요. (pty/세션 엔드포인트 무인증이라 외부 노출 전 필수 — 보안 중대)
- **Phase 19 Cloudflare 제거 / 고정 웹훅 URL** — 웹훅은 공개 도달 주소가 필수라 터널 자체 제거는
  불가. URL 가변성 완화책 택1: (a) named tunnel 고정 도메인 (b) GitHub App webhook URL 1회 고정
  (c) 폴링 대안. 트레이드오프 결정 필요.
- **Phase 21 glanceability 설계** — 상태 한눈 보드/세션 타임라인/비선형 요청 캡처는 구현 가능하나
  "어떤 뷰가 실제로 한눈 파악에 도움 되는가"는 설계 방향 결정 선행(추측 구현 금지, 좋은 아이디어 필요).

### 3) 반복·런타임 검증 필요 — 단발 구현 아님 (지속 작업)

- **Phase 4.7 AI 리뷰 품질 고도화** — 실제 머지 결과 피드백·프롬프트/모델 튜닝·회귀 평가 세트.
  데이터 기반 반복이라 1회 PR 로 "완료" 되지 않음.
- **Phase 13.5/13.6 claude CLI 고도화** — stream-json 진행 표시·MCP 도구 노출·hooks·모델
  escalation·토큰 측정. 실기기/CI 런타임 검증 선행 필요(claude CLI 부재 환경에선 typecheck 만 통과).
- **Phase 15 반응형/패키징 전 검토** — 지속 항목.

> 요약: 트랙 A/B 완주. **completion 의 실제 차단 요인은 §2 의 결정 6건**. 각 항목에 택1 옵션을
> 적어뒀으니, 결정해주시면 해당 항목부터 바로 구현한다. §1 은 결정 없이도 계속 진행 가능.
