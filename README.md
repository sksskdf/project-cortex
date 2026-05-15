# Project Cortex

> 에이전트가 짜고, 사람은 가장 중요한 결정만 합니다.

AI 코딩 에이전트의 시대에, 개발자의 리뷰 처리량은 AI의 코드 생산량을 따라가지 못합니다. Cortex는 그 격차를 좁히는 도구입니다 — **사람의 시간을 어디에 쓸지** 결정하는 트라이아지 레이어.

## 4대 원칙

| 원칙 | 의미 |
|---|---|
| **Default Trust** | AI가 자신 있는 작업은 자동 진행. 사람은 예외에만 개입합니다. |
| **Triage First** | 사람의 디폴트 화면은 인박스입니다. 작업 자체보다 "지금 봐야 할 것"이 먼저. |
| **Batch by Default** | 유사 작업은 묶어서 한 번에 결정. 컨텍스트 스위칭을 최소화합니다. |
| **Every Run is Auditable** | 에이전트의 모든 결정·파일 접근·도구 호출이 추적 가능합니다. |

## 핵심 흐름

1. **사람**이 이슈를 정의하고 에이전트(또는 본인)에게 할당
2. **AI 에이전트**가 작업하고 PR 생성 (Devin·Codex·내부 에이전트 등)
3. **Cortex**가 PR에 사전 리뷰를 수행 — 신뢰 점수·위험 플래그·인라인 코멘트
4. **트라이아지** — 신뢰 높은 PR은 자동 머지, 의심스러운 것만 사람 인박스로
5. **사람**은 인박스에서 우선순위 순으로 처리. 예외 우선 diff, 클러스터 배치 리뷰로 효율 극대화

## 도메인 객체

- **Issue** — 자연어 스펙 + 수용 기준. 에이전트 또는 사람에 할당.
- **Agent Run** — 한 번의 에이전트 실행. 인풋·작업 로그·도구 호출·산출물(PR).
- **PR** — Agent Run 또는 사람의 산출물. 외부 git에 존재.
- **Pre-review** — Cortex AI의 자동 PR 리뷰. 신뢰 점수(0–100), 위험 플래그, 인라인 코멘트.
- **Triage Decision** — 자동 머지 / 사람 검토 / 클러스터 묶음 중 어디로 갈지.
- **Cluster** — 유사 PR 묶음. 한 결정으로 일괄 처리.

## 정보구조

```
워크스페이스
├── 인박스           ← 디폴트 랜딩 (=우선순위 큐)
├── 프로젝트
│   └── [프로젝트별 개요·이슈·PR·에이전트·설정]
├── 에이전트
├── 클러스터
└── 보고서
```

## 가정

- **Cortex는 oversight layer**입니다. 자체 git 호스팅은 없고 GitHub/GitLab 위에 인박스·트라이아지·에이전트 관리 레이어를 얹습니다.
- "프로젝트"는 git 레포 단위. 한 워크스페이스에 여러 프로젝트.
- 카피 톤은 한국어 존댓말, Toss/Linear 스타일.

## 프로토타입

`prototype/` 폴더에 정적 HTML 프로토타입이 있습니다 — Urock 디자인 시스템 기반.

| 파일 | 화면 |
|---|---|
| `prototype/index.html` | Workspace Dashboard — 랜딩 |
| `prototype/inbox.html` | Review Inbox — 우선순위 큐 |
| `prototype/pr.html` | PR Review — 예외 우선 diff |
| `prototype/cluster.html` | Cluster Review — 배치 머지 |

브라우저로 `prototype/index.html`을 여는 것이 시작입니다.

## 작업자(사람·AI) 가이드

- [`AGENTS.md`](./AGENTS.md) — **AI 에이전트가 먼저 읽는 룰.** 토큰 절감 원칙 포함.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Next.js 모노리식 구조와 모듈 경계.
- [`docs/DESIGN.md`](./docs/DESIGN.md) — 단순함의 디자인 철학과 5개 원칙.
- [`docs/CONVENTIONS.md`](./docs/CONVENTIONS.md) — 코드·카피·네이밍 컨벤션.

## 스택 (한 줄)

**Next.js (App Router) + TypeScript + SQLite(Drizzle) + Urock 디자인 시스템 CSS.** 백·프런트 티어 분리 없음, 한 프로세스 모노리식.

## 비-목표 (이번 단계)

- 실제 git 연동·인증·API
- 모바일 반응형 / 다크 모드
- 에이전트 설정·빌링·워크스페이스 설정
- 코드 에디터·인라인 편집
- 알림 센터·이메일 다이제스트
