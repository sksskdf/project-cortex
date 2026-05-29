# claude CLI 활용 리서치 (Phase 13.6 step 1)

근거: code.claude.com 공식 문서(2026-05 기준, headless / cli-reference / subagents 페이지).
목적: Cortex 의 헤드리스·위임 호출이 claude CLI 의 풍부한 기능을 충분히 쓰는지 점검하고,
ROI 순으로 적용 우선순위를 정한다. 추측 금지 — 아래는 모두 문서에서 확인한 플래그·동작.

> ⚠️ **비용 모델 변경 예고 (반드시 인지)**: 문서 Note — **2026-06-15 부터 구독 플랜의
> `claude -p`(및 Agent SDK) 사용량은 대화형 한도와 분리된 별도 "월간 Agent SDK 크레딧"에서
> 차감**된다. Cortex 의 "크레딧 0(사용자 플랜으로 헤드리스 호출)" 전제가 이 날짜 이후
> 바뀐다 — 헤드리스 자동화(사전 리뷰·테스트 수정·충돌/리뷰 반영)가 별도 크레딧을 소모.
> → 비용 관측(아래 R3)과 모델 선택 전략(Haiku 1차)의 중요도가 올라간다.

## 1. 현재 Cortex 헤드리스 호출 (`src/lib/claude-cli.ts`)

```
claude -p --output-format json [--model X] [--dangerously-skip-permissions] <instruction>
        + stdin(시스템 규칙 + 컨텍스트 + diff)
```

- 응답: `--output-format json` 봉투에서 `result`(문자열) 추출 → `parseJsonFromText` 가
  **산문/코드펜스 섞인 텍스트에서 첫 균형 객체를 정규식·괄호매칭으로 추출** (취약점).
- 분석 전용 호출은 중립 `tmpdir` 에서 실행(코딩 에이전트 변질 방지), 충돌 해결은 `cwd`(워크스페이스).
- 도구 필요 시 `--dangerously-skip-permissions` (전부 허용 or 전부 없음, 중간 없음).
- 미사용: `--bare` · `--json-schema` · 비용/usage 수집 · `stream-json` · `--max-turns` ·
  `--allowedTools` 스코프 · `--append-system-prompt(-file)` · `--fallback-model` · subagents/MCP.

## 2. 기능 매트릭스 (문서 확인 ✓) × Cortex 적용 여부

| 기능 (플래그)                         | 무엇                                                                 | Cortex |
| ------------------------------------- | -------------------------------------------------------------------- | ------ |
| `-p` / `--output-format json`         | 비대화형 + result/메타 봉투                                           | ✅ 사용 |
| `--json-schema <schema>`              | 스키마 검증된 구조화 출력 → `structured_output` 필드 (print 모드)     | ❌      |
| `--output-format json` 비용 필드      | `total_cost_usd` + 모델별 cost breakdown, usage, session_id          | ❌ 무시 |
| `--bare`                              | hooks/skills/plugins/MCP/CLAUDE.md auto-discovery 스킵 → 빠른·결정적 | ❌      |
| `--append-system-prompt(-file)`       | 기본 시스템 프롬프트에 규칙 추가(파일 가능)                           | ❌      |
| `--allowedTools "Read,Edit,Bash(..)"` | 권한 룰 문법으로 도구 스코프 (prefix 매칭 `Bash(git diff *)`)         | ❌      |
| `--permission-mode dontAsk`           | allow 룰/read-only 외 전부 거부 — 락다운 CI 용                        | ❌      |
| `--fallback-model sonnet`             | 기본 모델 과부하/은퇴 시 자동 폴백 (print/백그라운드 모드만 발효)     | ❌      |
| `--max-turns N`                       | 에이전트 턴 제한(print 모드) — 도달 시 에러 종료                      | ❌(의도)|
| `stream-json` + `--include-partial-messages` + `--verbose` | 토큰/이벤트 스트리밍, `system/init`·`api_retry` 이벤트 | ❌      |
| `--session-id` / `--resume` / `--continue` | 세션 고정·재개·최근 대화 이어가기                                 | ✅ pty  |
| subagents (`.claude/agents/*.md`, `--agents` JSON) | 도구·모델·권한 격리된 전문 에이전트, description 으로 위임 | ❌      |
| `--mcp-config` / `--strict-mcp-config` | MCP 서버 주입 — Cortex 도구를 claude 에 노출                         | ❌      |

`--agents` JSON 지원 frontmatter(문서): `description, prompt, tools, disallowedTools, model,
permissionMode, mcpServers, hooks, maxTurns, skills, initialPrompt, memory, effort, background,
isolation, color`.

주의(문서 확인):
- **user-invoked 스킬(`/code-review` 등)·built-in 커맨드는 interactive 모드 전용 — `-p` 에선 불가.**
  → `.cortex` 스킬을 헤드리스에 "글로벌 적용" 하려면 슬래시 스킬에 의존하지 말고
  `--append-system-prompt-file`(방법론 텍스트) 또는 `--agents`의 `skills`/`prompt` 로 명시 주입.
- `--bare` 는 skills/CLAUDE.md/MCP 도 스킵하므로, 쓰려면 필요한 컨텍스트를 플래그로 명시 전달해야 함.
- `--dangerously-skip-permissions` == `--permission-mode bypassPermissions` (전부 우회).

## 3. 권고 — ROI 순

각 항목 별도 PR. (E=노력, V=가치)

### R1. `--json-schema` 로 파싱 신뢰성 확보 ★ 최우선 (V:높 E:중)

`parseJsonFromText` 의 산문-속-객체 추출은 모델이 형식을 어기면 깨진다. 사전 리뷰·트라이아지
입력처럼 **구조화 출력이 필요한 호출**을 `--output-format json --json-schema '<schema>'` 로 바꾸면
`structured_output` 가 스키마 검증되어 반환 → 파싱 취약점 제거. **Phase 20 "내가 확인할 부분
요약"을 스키마 필드(`whatToCheck: string[]`)로 추가하면 동시에 해결.** `runClaudeHeadless` 에
`jsonSchema?` 옵션 추가 + 봉투에서 `structured_output` 우선 추출.

### R2. 헤드리스 컨텍스트 명시 주입 (`--append-system-prompt-file`) + `.cortex` 전역 (V:중상 E:중)

슬래시 스킬은 `-p` 에서 안 먹으므로, cortex 방법론을 텍스트 파일로 두고 모든 헤드리스 호출에
`--append-system-prompt-file` 로 주입 → "스킬 전역 적용" 목표를 헤드리스에서 견고하게 달성.
(위임 interactive 세션의 preamble 주입은 유지.) 선택적으로 `--bare` + 명시 주입으로 시작 속도·
결정성 확보(단 skills/MCP 스킵 트레이드오프 확인).

### R3. 비용·usage 수집 → /reports (V:중상 E:중) — 06-15 크레딧 변경으로 중요도↑

`--output-format json` 봉투의 `total_cost_usd`·usage·모델별 breakdown 을 호출별로 저장(헤드리스
호출 테이블 또는 preReview 메타) → /reports 에 노출. 06-15 이후 Agent SDK 크레딧 소모 가시화.

### R4. 도구 권한 정밀화 (`--allowedTools` + `--permission-mode dontAsk`) (V:중 E:중) — 보안

test-fix·conflict-resolve·review-fix 가 blanket `--dangerously-skip-permissions` 대신 작업별
최소 도구만 허용(예: `Read,Edit,Bash(git *)` — 네트워크/임의 셸 제외). `dontAsk` 베이스라인 +
필요한 `--allowedTools` 만. 외부 노출(Phase 19) 전 권장.

### R5. `--fallback-model` (V:중 E:낮) — 값싼 회복력

`runClaudeHeadless` 에 `--fallback-model`(예: opus 1차 실패 시 sonnet) 추가. print 모드에서만
발효라 Cortex 헤드리스에 딱 맞음. 모델 은퇴/과부하 시 자동화 중단 방지.

### R6. stream-json 진행 표시 (V:중 E:높) — Phase 21 glanceability 연계

`stream-json --include-partial-messages --verbose` 로 위임/자동화 진행을 실시간 이벤트로 받아
in-flight 패널(A1)·세션 타임라인(Phase 21)에 표시. `system/init`(모델·도구·MCP 보고)·
`system/api_retry`(재시도 진행) 이벤트 활용. 스트리밍 파서가 필요해 노력 큼 — Phase 21 와 함께.

### R7. subagents / MCP 노출 (V:높 E:높) — 대형, 후속

(a) 반복 자동화(test-fix·review·conflict-resolve)를 도구·모델 스코프가 박힌 subagent 정의로
추출(일관성·재사용·평가). (b) Cortex 도구(이슈/PR/로드맵 CRUD)를 MCP 서버로 노출 → claude 가
자율 조회·갱신. 둘 다 아키텍처 영향 커 별도 설계 PR.

## 4. 제안 진행 순서

1. **R1**(json-schema) — 파싱 신뢰성 + Phase 20 "확인할 부분" 동시 해결. 즉시 착수 후보.
2. **R3 + R5** — 비용 수집 + fallback (작고 가치 큼, 06-15 대비).
3. **R2** — 헤드리스 컨텍스트/스킬 전역.
4. **R4** — 권한 정밀화(외부 노출 전).
5. **R6 / R7** — Phase 21 / 대형 후속과 묶어 설계 선행.
