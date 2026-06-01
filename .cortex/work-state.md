<!--
work-state schema v1 — 세션 연속성용 작업 상태 파일 (Phase 16)

이 파일은 사람과 에이전트가 공용으로 읽는, 머신 파서블한 "지금 작업 상태" 기록입니다.
새 세션(메모리 없는 에이전트/사람)이 README → AGENTS 다음으로 읽어, 진행 중 작업·
다음 단계·맥락을 git log 에서 비싸게 재추론하지 않고 바로 파악하도록 합니다.

`.cortex/roadmap.md` 가 "무엇을 만드는가(장기 산출물)"라면, 이 파일은 "지금 어디까지
왔고 다음에 뭘 하나(단기 작업 상태)"입니다. 로드맵 체크박스는 이 파일에서 다루지 않습니다.

파서: `src/lib/work-state.ts` (의존성 없는 자체 mini 파서, schema v1 한정).

규칙 (최소 schema):
- 섹션은 `## ` 헤딩으로 구분. 인식하는 세 섹션만 의미를 가집니다:
  - `## 진행 중` — 진행 중 브랜치/PR. 각 줄 `- <항목>: <한 줄 상태>` (콜론 뒤가 상태).
    콜론이 없으면 항목 전체가 상태 없는 항목으로 취급.
  - `## 다음 단계` — 다음 할 일. 각 줄 `- <한 줄>`.
  - `## 메모` — 맥락/주의. 각 줄 `- <한 줄>`.
- 알 수 없는 섹션·빈 섹션·없는 섹션 모두 허용(파서는 관대). HTML 주석은 무시됩니다.
- 한 줄 = 한 항목. 멀티라인 항목은 schema v1 미지원.
-->

# work-state

Cortex 자체의 단기 작업 상태. 새 세션은 README → AGENTS → 이 파일 순으로 읽으세요.

## 진행 중

- claude/continue-next-task-pb8O5 / PR #224: 위임 신뢰성·맥락 강화 묶음 — 워크스페이스 교차 등록 가드 + prompt 주입 race 해소 + cortex 스킬 자동 설치/내용 보강 + 점 구분 Phase 키 파서 (PR #222 의 fix 포함). 검증 그린(589 tests), 사용자 머지 대기.

## 다음 단계

- 사용자 머신 worktree 기본 ON 전환 검토 — 검증 끝났으므로 default true 변경 가능(사용자 결정).
- Phase 13.6 후속(런타임 필요): stream-json 진행 표시 · MCP 도구 노출 · hooks(SessionStart) 자동 주입 · R4 권한 정밀화.
- Phase 4.7 사전 리뷰 품질(런타임 평가 필요): 위험 플래그·신뢰 점수 정확도, 인라인 코멘트 품질, 대형 diff 청크 분할.
- Phase 15 반응형 디자인 — 단일 사용자 localhost 가정상 최하 우선순위.
- Phase 17 DB 중앙화 / Phase 19 인증 / Phase 8 PAT·로컬-먼저 등록 — 모두 사용자 결정 트리거 대기.

## 메모

- 작업 완료 = 커밋 + 푸시 + PR 생성 (CLAUDE.md). PR 전 typecheck·prettier·test 통과 필수.
- PR 생성 후 같은 브랜치 추가 push 금지 (자동 머지가 직전 SHA 로 돌아 누락) — AGENTS §8.2.
- 로드맵 체크박스(.cortex/roadmap.md·docs/ROADMAP.md)는 orchestrator 가 관리. 직접 편집 금지.
- 워크스페이스 등록 시 동일 localPath 다른 projectId 거부 + GitHub remote slug 매칭 검증 박제(#224 가드 1/2). 신규만 막으므로 기존 잘못된 row 는 사용자가 정리해야.
- worktree 격리는 검증 완료(스폰 cwd `.cortex-worktrees/<repo>-<sessionId>`, 메인 브랜치 무회귀). off-by-default 토글은 `appSettings.agentWorktreeEnabled`.
- 위임 prompt 주입은 REPL 준비 신호(`? for shortcuts`) + 8s fallback 으로 신뢰성 확보 — 신호 정규식은 claude code 버전 변경 시 갱신 필요.
