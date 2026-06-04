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

- **없음 — 진행 중 작업 0.** #240–255 전부 머지 완료, 브랜치는 master 와 동기. 다음 작업은
  아래 "로드맵 상태" 의 게이트가 열려야 시작 가능(사용자 머신/결정/시각).

## 로드맵 상태 — 자율 완결분 + 코드 리뷰 하드닝 소진 (게이트만 남음)

샌드박스에서 검증 가능한 모든 것 완료: 로드맵 §1(자율 구현) + 5차에 걸친 코드 리뷰 스윕(전
핫파일). **715 tests 그린.** 남은 항목은 **전부 게이트**:

- **런타임 게이트 (claude CLI/서버 런타임 필요 — 이 샌드박스에 없음)**: Phase 4.7 평가 세트,
  13.5/13.6 stream-json·MCP·hooks·allowedTools(R4), G2 세션 요약, 패키징 테스트, worktree 기본
  ON, SSE 구독자 누수(events route), pty 타이밍/누수 실효 확인, #248(프롬프트 주입)·#254(알림
  배지) 실제 동작 확인.
- **데이터 게이트**: Phase 4.7 리뷰 품질 튜닝 — 머지 결과 corpus 축적 후. (자동 머지 정확도
  지표 `getAutoMergeAccuracy` 는 #231 에 가시화 완료.)
- **결정 게이트**: Phase 19 인증/Cloudflare(외부 노출 시). (Phase 17 DB 중앙화·8 PAT 제거됨.
  10.4 자동 양방향 sync 비채택.)
- **시각 게이트 (화면 필요)**: Phase 10.4 뷰 통합, Phase 15 UI/UX 패스·반응형(A7-2).

→ 다음 진행은 사용자가 게이트를 열어줘야 함 ("claude CLI 로 X 검증했다" / UI 스샷 / "인증 진행").

## 직전 세션 완료 — 코드 리뷰 하드닝 스윕 (PR #240–255, 전부 머지)

5차에 걸친 고-recall 코드 리뷰로 핫파일을 전수 검토, CONFIRMED·sandbox-검증 가능·저위험 버그
16건을 단일-commit PR 로 각각 수정·머지 (643 → 715 tests):

- **로드맵/sync 무결성**: Closes-매칭 단어경계·펜스·override·멱등(#240) · sync 미검증 SHA 자동
  머지(#241) · 로드맵 delete FK(#242) · roadmap `[~]` in-progress 데이터 손실(#233) ·
  project.yml `#`주석·숫자 강제변환(#238) · syncProjectFromGit 트랜잭션+issues FK(#239).
- **자동 머지/게이트**: github 페이지네이션(check runs>100 → CI 실패 누락 자동 머지)(#246) ·
  triage `blocked`↔merge-gate 일관(#247) · merge-gate mergeBlockedByCI 신호(#250).
- **보안/생명주기**: App 삭제 FK + 토큰 캐시 무효화(키 로테이션 보안)(#244) · headless 비용
  관측 누수(#243) · 위임 status 무결성(closed 회귀·sweep-failed 되돌림)(#251) · startAgentRun
  중복 running supersede(#252).
- **워크스페이스/알림/CLI**: workspace 경로 정규화+동시 pull 직렬화(#245) · 알림 dedupe(#253) ·
  알림 배지 stale(#254) · claude CLI 펜스 파싱·degrade(#235) · reports analyzedAt 버킷팅(#236) ·
  대시보드 메트릭 일관(#232).
- **기능 복원**: Phase 4.7 outputPrId writer 배선 — `Cortex-Issue: #<id>` 본문 마커로 위임
  이슈↔결과 PR 연결, cross-project 가드. result-PR 배지 + 사전 리뷰 이슈 spec 주입 되살림(#255).
- **검토 후 무변경(건전 확인)**: pr.ts 머지 핸들러(GitHub 405 backstop) · diff-budget(첫 파일
  헤더 항상 포함, 스킵 정보 LLM 노출) — 억지 변경 안 함.

## 메모

- 작업 완료 = 커밋 + 푸시 + PR 생성 (CLAUDE.md). PR 전 typecheck·prettier·test 통과 필수.
- PR 생성 후 같은 브랜치 추가 push 금지 (자동 머지가 직전 SHA 로 돌아 누락) — AGENTS §8.2.
- 로드맵 체크박스(.cortex/roadmap.md·docs/ROADMAP.md)는 orchestrator 가 관리. 직접 편집 금지.
- 워크스페이스 등록 시 동일 localPath 다른 projectId 거부 + GitHub remote slug 매칭 검증 박제(#224 가드 1/2). 신규만 막으므로 기존 잘못된 row 는 사용자가 정리해야.
- worktree 격리는 검증 완료(스폰 cwd `.cortex-worktrees/<repo>-<sessionId>`, 메인 브랜치 무회귀). off-by-default 토글은 `appSettings.agentWorktreeEnabled`.
- 위임 prompt 주입은 REPL 준비 신호(`? for shortcuts`) + 8s fallback 으로 신뢰성 확보 — 신호 정규식은 claude code 버전 변경 시 갱신 필요.
