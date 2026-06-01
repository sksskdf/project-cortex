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

- claude/continue-next-task-pb8O5 / PR #227 (롤링): readiness 가드 + Phase 18 승격 + 15 B5 토글 가드 + 10.4 직렬화/마커. SHA 가드(#226 머지됨)로 partial-squash race 차단됨 → 한 squash 로 안전 머지 가능. 검증 그린(605 tests).

## 로드맵 상태 — 자율 완결분 소진

이번 세션에 샌드박스에서 완결 가능한 로드맵 항목을 모두 처리. 남은 항목은 **전부 게이트**:

- **런타임 게이트 (사용자 머신 claude CLI 필요)**: Phase 4.7 플래그 정확도·평가 세트, 13.5/13.6 stream-json·MCP·hooks·R4, G2 세션 요약, 패키징 테스트, worktree 기본 ON 전환.
- **결정 게이트 (사용자 결정 필요)**: Phase 8 PAT·로컬-먼저 등록(승인됨, 별도 PR), Phase 10.4 자동 양방향 sync(PR 빈도 UX), Phase 17 DB 중앙화, Phase 19 인증/Cloudflare(외부 노출 시).
- **시각 게이트 (화면 확인 필요)**: Phase 10.4 뷰 통합, Phase 15 DS 점진 교정·UI/UX 패스·반응형(A7-2).

→ 다음 진행은 사용자가 게이트 항목 중 하나를 열어줘야 함 (예: "PAT 등록 구현", "worktree 기본 ON", "DB 중앙화 시작").

## 이번 세션 완료 (PR #227)

- Phase 18 승격 플로우 (TODO→이슈 위임)
- Phase 15 B5 토글 동시 클릭 race 가드
- Phase 15 A7-1 모달 포커스 트랩 (검증·완료 마킹)
- Phase 4.7 인라인 코멘트 품질·대형 diff 우선순위 (프롬프트·diff-budget)
- Phase 10.4 로드맵 직렬화 코어 + cortex 마커 루프 방지(147)
- 자동 머지 readiness 가드 (draft/`Cortex: ready`) + SHA 가드

## 메모

- 작업 완료 = 커밋 + 푸시 + PR 생성 (CLAUDE.md). PR 전 typecheck·prettier·test 통과 필수.
- PR 생성 후 같은 브랜치 추가 push 금지 (자동 머지가 직전 SHA 로 돌아 누락) — AGENTS §8.2.
- 로드맵 체크박스(.cortex/roadmap.md·docs/ROADMAP.md)는 orchestrator 가 관리. 직접 편집 금지.
- 워크스페이스 등록 시 동일 localPath 다른 projectId 거부 + GitHub remote slug 매칭 검증 박제(#224 가드 1/2). 신규만 막으므로 기존 잘못된 row 는 사용자가 정리해야.
- worktree 격리는 검증 완료(스폰 cwd `.cortex-worktrees/<repo>-<sessionId>`, 메인 브랜치 무회귀). off-by-default 토글은 `appSettings.agentWorktreeEnabled`.
- 위임 prompt 주입은 REPL 준비 신호(`? for shortcuts`) + 8s fallback 으로 신뢰성 확보 — 신호 정규식은 claude code 버전 변경 시 갱신 필요.
