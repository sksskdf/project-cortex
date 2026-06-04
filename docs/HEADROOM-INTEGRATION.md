# Headroom 통합

[Headroom](https://github.com/chopratejas/headroom) 은 LLM 에 보내기 전 컨텍스트(프롬프트·도구 출력·로그·diff)를 로컬에서 압축해 토큰 60–95% 절감하는 미들웨어다. 원본은 로컬에 저장되고 LLM 이 필요할 때 `headroom_retrieve` 도구로 회수(CCR — 가역 압축).

## 통합 모드 선택

Headroom 은 세 모드를 제공:

| 모드 | 적용 표면 | Cortex 적용 가능? |
|---|---|---|
| **wrap** (`headroom wrap claude`) | 에이전트 CLI 를 감쌈 — 코드 변경 0 | ✅ **선택됨** |
| **proxy** (`headroom proxy --port 8787`) | Anthropic/OpenAI SDK `baseURL` 를 가리킴 | ❌ Cortex 는 Anthropic SDK 안 씀 (Phase 4.6 #136 — 크레딧 0, claude CLI 전용) |
| **inline SDK** (`withHeadroom(new Anthropic())`) | SDK 클라이언트 직접 wrap | ❌ 동일 사유 |

→ **wrap 모드만 자연스럽게 맞음**. `claude ...args` 앞에 `headroom wrap` 만 붙이는 패턴이라 기존 spawn 인프라(`runClaudeHeadless`)에 최소 침습.

## 적용 범위 (1차)

**On**: `runClaudeHeadless` 경로 → 자동화 4종 모두 영향
- 사전 리뷰 (`pre-review.ts`)
- 충돌 자동 해결 (`conflict-resolve.ts`)
- 테스트 실패 자동 수정 (`test-fix.ts`)
- 리뷰 변경 요청 자동 반영 (`review-fix.ts`)

**Off (별도 후속)**:
- PTY 인터랙티브 위임 세션 — TUI 입출력·렌더링 호환성 런타임 검증 필요
- `headroom_retrieve` 도구 노출 — `--print` 모드에서 도구 호출 제한적이라 헤드리스 1차 가치 낮음

## 동작

1. `getSettings().headroomEnabled` 가 true 이고
2. `resolveHeadroom()` 이 PATH 에서 binary 를 찾으면

`spawn(headroom, ['wrap', 'claude', ...원본 args])` 로 spawn. 그 외(토글 OFF / binary 미감지)는 원본 `claude` 직접 spawn — **무회귀**.

토글 ON 인데 binary 미감지면 warning 로그 1회 + UI 에 안내 배너:
> PATH 에서 headroom 을 찾을 수 없어 원본 claude 로 동작 중입니다.

## 안전 가정 (런타임 검증 게이트)

다음은 README "zero code changes, any language" 명시상 그렇지만 **이 환경에선 검증 불가**, 사용자 머신에서 토글 1회 켜서 확인:

- `headroom wrap claude` 가 Cortex 가 쓰는 모든 플래그를 그대로 forwarding:
  - `-p --output-format json`
  - `--model <id>` · `--fallback-model <id>` (R5)
  - `--json-schema <inline-json>` (R1)
  - `--append-system-prompt-file <path>` (R2)
  - `--dangerously-skip-permissions` (도구 자동화)
- stdin/stdout pass-through (Cortex 는 무거운 본문을 stdin 으로 전달)
- envelope JSON 구조(`result`·`structured_output`·`usage`·`total_cost_usd`) 가 wrap 후에도 동일 유지 — R3 비용 관측 의존

호환 안 되면 토글로 즉시 OFF → 원본 claude 로 무회귀 복귀.

## 설치 (사용자 머신)

```bash
# Python (메인 배포)
pip install "headroom-ai[all]"

# 또는 Node.js (SDK 패키지에 CLI 포함)
npm install -g headroom-ai

# 확인
headroom --version
```

설치 후 Cortex `/settings` → "Headroom 컨텍스트 압축" 토글 ON.

## 코드 표면

| 파일 | 역할 |
|---|---|
| `src/lib/headroom.ts` | binary 감지(`resolveHeadroom`) · 버전 추출(`getHeadroomVersion`) · spawn argv 변환(`wrapClaudeSpawn` — 순수 함수) |
| `src/lib/claude-cli.ts` (수정) | spawn 직전 `wrapClaudeSpawn` 적용 분기 |
| `src/lib/settings.ts` (확장) | `setHeadroomEnabled` 토글 |
| `src/actions/settings.ts` (확장) | `toggleHeadroomAction` Server Action |
| `src/components/HeadroomToggle.tsx` | `/settings` 토글 UI |
| `src/db/migrations/0029_app_settings_headroom.sql` | `app_settings.headroom_enabled` 컬럼 |
| `src/server/pty.ts` (수정) | 시작 시 헤드룸 버전 로깅(claude 버전 로깅과 짝) |
