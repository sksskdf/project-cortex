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

- **PR #230 (claude/continue-next-task-pb8O5, 10 commit) — 머지 대기.** 에이전트/자동화
  신뢰성 + 보안 배치. 635 tests 그린. **Squash 한 번**으로 머지(부분-squash 방지). 머지 후
  master `auto-merge.ts` 에 `reconcileStuckAutoMerges`·`isPullRequestMerged`, `github.ts` 에
  `isUntrustedAuthorAssociation` 있으면 완전.

## 로드맵 상태 — 자율 완결분 소진 (게이트만 남음)

샌드박스에서 검증하며 완결 가능한 항목 + 코드 리뷰로 찾은 버그를 모두 처리. 남은 항목은 **전부 게이트**:

- **런타임 게이트 (claude CLI 필요 — 이 샌드박스에 없음)**: Phase 4.7 평가 세트, 13.5/13.6
  stream-json·MCP·hooks·allowedTools(R4; author 게이트로 일부 대체됨), G2 세션 요약, 패키징
  테스트, worktree 기본 ON, stuck SHA-mismatch 재분석, review-fix prompt-injection 잔여.
- **결정 게이트**: Phase 19 인증/Cloudflare(외부 노출 시). (Phase 17 DB 중앙화·8 PAT 는 사용자
  지시로 로드맵에서 제거됨. 10.4 자동 양방향 sync 는 비채택.)
- **시각 게이트 (화면 필요)**: Phase 10.4 뷰 통합, Phase 15 UI/UX 패스·반응형(A7-2).

→ 다음 진행은 사용자가 게이트를 열어줘야 함 ("claude CLI 로 X 검증했다" / UI 스샷 / "인증 진행").

## 이번 세션 완료 (PR #228·#229 머지됨, #230 대기)

- **사용자 보고 버그**: 자동화 토글이 git pull 마다 풀림 → 로컬 DB 전용(#228).
- **🔴 보안**: 자동 머지·claude 자동화 권한 상승 차단 — authorKind(본문 마커·위조 가능) 대신
  GitHub author_association(위조 불가) 게이트. 머지 + 3 자동화 일관 적용(#230, migration 0028).
- **자동 머지 안정성 (코드 리뷰)**: merged 오인(머지 안 됐는데 마킹)·muted 갭·readiness 회귀·
  base-modified·stuck reconcile.
- **자동화 push (3 경로)**: push 직전 + 시작 시 머지/닫힌 PR skip(죽은 브랜치 부활 방지).
- **세션/worktree**: 브랜치 누수·resume 격리 유실·위임 run 24h 잔류·destroy 멱등.
- Phase 18 승격·15 B5 토글·A7-1·4.7 프롬프트·10.4 직렬화/마커·readiness 가드·SHA 가드·CLI
  버전 추적·currentUser env·DS 토큰 (#227 머지됨).
- **코드 리뷰 4회**(세션 diff·자동 머지 경로·세션/worktree·웹훅 신뢰 경계) → 실제 버그 13건 +
  보안 2건. 검증 수단이 있는 작업의 가치를 입증.

## 메모

- 작업 완료 = 커밋 + 푸시 + PR 생성 (CLAUDE.md). PR 전 typecheck·prettier·test 통과 필수.
- PR 생성 후 같은 브랜치 추가 push 금지 (자동 머지가 직전 SHA 로 돌아 누락) — AGENTS §8.2.
- 로드맵 체크박스(.cortex/roadmap.md·docs/ROADMAP.md)는 orchestrator 가 관리. 직접 편집 금지.
- 워크스페이스 등록 시 동일 localPath 다른 projectId 거부 + GitHub remote slug 매칭 검증 박제(#224 가드 1/2). 신규만 막으므로 기존 잘못된 row 는 사용자가 정리해야.
- worktree 격리는 검증 완료(스폰 cwd `.cortex-worktrees/<repo>-<sessionId>`, 메인 브랜치 무회귀). off-by-default 토글은 `appSettings.agentWorktreeEnabled`.
- 위임 prompt 주입은 REPL 준비 신호(`? for shortcuts`) + 8s fallback 으로 신뢰성 확보 — 신호 정규식은 claude code 버전 변경 시 갱신 필요.
