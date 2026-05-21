# Domain Model — Project Cortex

> 도메인 객체와 상태 전이. 새 lib·DB 스키마·API를 만들 때 참조합니다.

---

## 1. 객체 한눈에

```
Issue ──┬─→ AgentRun ──→ PR ──→ PreReview ──→ TriageDecision
        │                       │                    │
        │                       └────────────────────┴─→ Cluster (optional)
        │                                                    │
        └────────────────────────────────────────────────────┴─→ MergeEvent

AppSettings (단일 행 — 글로벌 토글)
```

도메인 객체는 6개 + 글로벌 AppSettings. 새 객체를 늘리기 전 기존에 흡수 가능한지 검토.

---

## 2. 객체 정의

### Issue
> 사람이 정의한 작업 단위.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `repoId` | int (FK Project) | |
| `title` | string | 짧은 한 줄 |
| `spec` | text | 자연어 스펙 + 수용 기준 |
| `assigneeKind` | `'human' \| 'agent'` | |
| `assigneeId` | string | 사람 ID 또는 에이전트 key |
| `status` | `'open' \| 'in-progress' \| 'done' \| 'closed'` | |
| `createdAt`, `updatedAt` | timestamp | |

**불변**: 한 Issue는 0…N개의 `AgentRun`을 가질 수 있음 (재시도 포함). 한 Issue는 최종적으로 0…1개의 머지된 `PR`로 귀결.

### AgentRun
> Issue를 받아 에이전트가 한 번 실행한 것.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `issueId` | int (FK) | |
| `agent` | string | `'devin' \| 'codex' \| 'internal'` 등 |
| `status` | `'queued' \| 'running' \| 'completed' \| 'failed'` | |
| `input` | json | 에이전트에 넘긴 프롬프트·옵션 |
| `log` | text | 작업 로그 (대용량) |
| `toolCalls` | json | 도구 호출 시퀀스 (감사용) |
| `outputPrId` | int (FK PR, nullable) | 만들어진 PR |
| `startedAt`, `completedAt` | timestamp | |
| `etaSec` | int | 평균 ETA 계산용 |

**불변**: `completed` 상태면 `outputPrId`가 set이거나 `log`에 "no changes" 사유가 있음.

### PR
> Agent Run 또는 사람의 산출물. 외부 git에 존재하고, Cortex가 메타·상태만 보유.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | 내부 ID |
| `repoId` | int (FK) | |
| `number` | int | GitHub의 PR 번호 |
| `title` | string | |
| `body` | text? | GitHub PR description. 빈 본문 가능 — UI 가 섹션 자체 숨김 |
| `authorKind` | `'agent' \| 'human'` | |
| `authorId` | string | |
| `headSha` | string | 사전 리뷰 캐시 키 |
| `linesAdded`, `linesRemoved` | int | |
| `filesChanged` | int | |
| `status` | `'open' \| 'review-needed' \| 'auto-mergeable' \| 'merged' \| 'closed'` | |
| `clusterId` | int (FK, nullable) | 묶이면 set |
| `branchDeletedAt` | timestamp? | head 브랜치 삭제 시점. PR 상세의 '브랜치 삭제' 버튼 멱등성 |
| `createdAt`, `updatedAt` | timestamp | `updatedAt` 은 synchronize webhook 마다 갱신 (인박스 ageText 의 원천) |

**상태 전이**:
```
open
 ├─→ auto-mergeable  (PreReview 통과 + Triage decision = auto)
 │     └─→ merged
 ├─→ review-needed   (PreReview 위험 or 낮은 confidence)
 │     ├─→ merged    (사람이 머지)
 │     └─→ closed    (사람이 거절)
 └─→ closed          (외부에서 닫힘)
```

### PreReview
> Cortex AI의 자동 PR 분석 결과.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `prId` | int (FK) | |
| `headSha` | string | 같은 SHA면 재사용 (캐시) |
| `confidence` | int | 0–100 |
| `confidenceTier` | `'critical' \| 'low' \| 'medium' \| 'high'` | 점수→티어 매핑 |
| `flags` | json | 위험 플래그 배열 (`['payment-domain', 'low-coverage', ...]`) |
| `changedPaths` | json | 변경된 파일 경로 배열 — 클러스터링 자카드 유사도 입력 |
| `hunkAnnotations` | json | hunk별 `'auto' \| 'review'` + 사유 |
| `summary` | text? | 사람 노출용 한국어 요약 |
| `comments` | json? | 인라인 코멘트 (path, line, body) |
| `parsedFiles` | json? | diff 파싱 결과 (FileBlock[]) — UI 트리/diff 렌더 입력 |
| `testsPassed` | bool? | null이면 미실행. Phase 4 백로그 — Check Runs API 로 채울 예정 |
| `coverage` | float? | null이면 미측정. Phase 4 백로그 |
| `analyzedAt` | timestamp | |

**캐시 룰**: `(prId, headSha)` 유니크. 새 커밋이 오면 새 PreReview가 만들어지고 이전 것은 보존.

### TriageDecision
> "이 PR이 어디로 갈지" 결정. PreReview 직후 1회 생성, 사람의 액션으로 갱신 가능.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `prId` | int (FK) | |
| `decision` | `'auto-merge' \| 'human-review' \| 'cluster'` | |
| `reason` | string | 한국어 한 줄 (`'결제 영역 변경'`) |
| `clusterId` | int (FK, nullable) | `cluster`일 때 set |
| `decidedBy` | `'system' \| 'human'` | |
| `decidedAt` | timestamp | |

### Cluster
> 유사 PR 묶음. PR ↔ Cluster는 N:1.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `pattern` | string | 짧은 식별자 (`'i18n-labels'`) |
| `title` | string | 사람 노출용 (`'i18n 라벨 추가 패턴'`) |
| `commonDiffSnippet` | text | 공통 패턴 표시용 |
| `prIds` | json (int[]) | 묶인 PR (역참조 가능하면 생략) |
| `avgConfidence` | int | |
| `status` | `'open' \| 'partially-merged' \| 'merged' \| 'dissolved'` | |
| `createdAt`, `closedAt` | timestamp | |

### MergeEvent
> 머지가 발생한 순간의 기록. 자동/사람 구분, 회수(revert) 추적.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK) | |
| `prId` | int (FK) | |
| `mergedBy` | `'system' \| 'human'` | |
| `humanUserId` | string? | `human`이면 set |
| `clusterId` | int (FK, nullable) | 클러스터 일괄 머지면 set |
| `revertedAt` | timestamp? | 사후 revert 추적 |
| `mergedAt` | timestamp | |

### AppSettings
> 단일 행 (id=1) 의 글로벌 설정. 단일 사용자 가정상 워크스페이스/유저별 설정은 비-목표.

| 필드 | 타입 | 메모 |
|---|---|---|
| `id` | int (PK, 항상 1) | |
| `aiEnabled` | bool | false 면 Anthropic 호출 전부 skip (사전 리뷰·triage·클러스터링). 크레딧 차단 스위치 |
| `updatedAt` | timestamp | |

---

## 3. 신뢰 점수 → 티어 → 액션

`lib/confidence.ts` 한 곳에서 결정. UI는 이 결과만 받음.

```
score >= 90 → 'high'     → auto-merge 후보
70..89      → 'medium'   → review-needed (빠른 확인)
50..69      → 'low'      → review-needed (사람 검토)
< 50        → 'critical' → review-needed + 큐 최상단
```

티어와 색 매핑은 `docs/DESIGN.md` §1.4와 동기화.

---

## 4. 자동 머지 정책 (`lib/triage.ts`)

자동 머지 조건은 **AND**:
1. `PreReview.confidence >= 90`
2. `PreReview.testsPassed === true`
3. `PreReview.flags`가 다음 중 어느 것도 포함하지 않음:
   - `payment-domain` · `auth-domain` · `migration` · `security-sensitive` · `external-api-new`
4. `PR.authorKind === 'agent'` (사람 PR은 항상 사람 검토)
5. 레포 정책이 자동 머지를 허용 (`Project.autoMergeEnabled === true`)

위 조건을 하나라도 어기면 `human-review`로 라우팅. 클러스터링 후보 검사는 별도.

---

## 5. 클러스터링 (`lib/clustering.ts`)

PR이 review-needed로 라우팅된 직후 실행. 후보 묶기 룰:

- 같은 레포
- 같은 에이전트 작성
- 24시간 이내 생성
- 유사도 점수 ≥ 0.85 (파일 경로 자카드 유사도 + diff hunk 임베딩 코사인 유사도 평균)

위 조건을 만족하는 PR이 ≥ 3개면 `Cluster` 생성. 단, `payment-domain` 같은 강한 플래그가 있는 PR은 클러스터에서 제외 (항상 개별 검토).

---

## 6. 비-목표 (도메인 단순화 차원)

이번 단계에서 만들지 않는 객체:
- Comment 스레드 (사람 ↔ AI 대화) — PR 본문에 통합
- Notification 객체 — 알림은 외부 시스템(Slack/Email)에 위임, 영속 저장 안 함
- Workspace / Team — 단일 워크스페이스 가정
- Permission / Role — 모든 사용자 동등 (감사 로그로 충분)

이 객체들은 후속 phase에서 도입을 재검토합니다.
