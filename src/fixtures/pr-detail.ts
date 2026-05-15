import type { FileBlock, FileStatus } from '@/lib/types';

// 실제 git diff 콘텐츠는 Phase 3 GitHub 통합에서 fetch. LLM 요약 세그먼트는
// Phase 4에서 Anthropic API로 생성. 현 단계는 PR 1개 고정 fixture.

export type AiCheckTone = 'ok' | 'warn' | 'alert';

export type AiCheck = {
  key: 'tests' | 'coverage' | 'risk';
  value: string;
  tone: AiCheckTone;
};

export type AiSummaryFixture = {
  analyzedAgo: string;
  summarySegments: ReadonlyArray<{ text: string; emphasis?: boolean }>;
  checks: ReadonlyArray<AiCheck>;
};

export type TreeFile = {
  path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  active?: boolean;
};

export type TreeGroup = {
  groupKey: 'needsReview' | 'autoApprovable';
  files: ReadonlyArray<TreeFile>;
  collapsedExtraCount?: number;
};

export type PRDetailFixture = {
  aiSummary: AiSummaryFixture;
  hunkSummary: {
    totalHunks: number;
    autoApprovableHunks: number;
  };
  tree: ReadonlyArray<TreeGroup>;
  files: ReadonlyArray<FileBlock>;
};

// 모든 PR이 같은 fixture diff를 받음 — Phase 3 GitHub 통합 전 시각 보존용.
export const fixturePRDetail: PRDetailFixture = {
  aiSummary: {
    analyzedAgo: '2분 전',
    summarySegments: [
      { text: '이 PR은 결제 모듈을 수정하므로 ' },
      { text: '자동 머지 정책에서 제외', emphasis: true },
      { text: '되었습니다. 17개 hunk 중 ' },
      { text: '3개', emphasis: true },
      {
        text: '가 검토를 필요로 합니다. 환불 정책의 임계값 변경이 핵심이며, 기존 환불 케이스의 회귀 테스트가 추가되었습니다. 다만 동시성 시나리오에 대한 테스트가 누락되어 있어 확인이 필요합니다.',
      },
    ],
    checks: [
      { key: 'tests', value: '통과 (134/134)', tone: 'ok' },
      { key: 'coverage', value: '58% · 기준 미달', tone: 'warn' },
      { key: 'risk', value: '결제 도메인', tone: 'alert' },
    ],
  },
  hunkSummary: {
    totalHunks: 17,
    autoApprovableHunks: 14,
  },
  tree: [
    {
      groupKey: 'needsReview',
      files: [
        { path: 'refund/service.ts', status: 'alert', additions: 82, deletions: 18, active: true },
        { path: 'refund/policy.ts', status: 'warn', additions: 34, deletions: 9 },
        { path: 'refund/api.ts', status: 'warn', additions: 28, deletions: 0 },
      ],
    },
    {
      groupKey: 'autoApprovable',
      collapsedExtraCount: 8,
      files: [
        { path: 'refund/types.ts', status: 'ok', additions: 14, deletions: 2 },
        { path: 'utils/format.ts', status: 'ok', additions: 5, deletions: 0 },
        { path: 'i18n/ko.json', status: 'ok', additions: 8, deletions: 0 },
        { path: 'i18n/en.json', status: 'ok', additions: 8, deletions: 0 },
        { path: 'tests/refund.spec.ts', status: 'ok', additions: 62, deletions: 10 },
      ],
    },
  ],
  files: [
    {
      path: 'refund/service.ts',
      status: 'alert',
      additions: 82,
      deletions: 18,
      hunks: [
        {
          kind: 'collapsed',
          id: 'hunk-fixture-1',
          summary: '자동 승인 가능 · {highlight}',
          summaryHighlight: 'import 정리',
          lineCount: 5,
        },
        {
          kind: 'expanded',
          id: 'hunk-fixture-2',
          reason: {
            text: '환불 임계값을 50,000원에서 100,000원으로 상향 — 비즈니스 정책 변경입니다. 승인된 변경인지 확인이 필요합니다.',
            tone: 'alert',
          },
          lines: [
            { lineNumber: 42, text: '@@ -42,8 +42,8 @@ class RefundService {', kind: 'hunk-head' },
            {
              lineNumber: 42,
              text: '  async processRefund(orderId: string, amount: number) {',
              kind: 'ctx',
            },
            {
              lineNumber: 43,
              text: '    const order = await this.orderRepo.findById(orderId);',
              kind: 'ctx',
            },
            { lineNumber: 44, text: '    if (amount > 50_000) {', kind: 'del' },
            { lineNumber: 45, text: "      throw new Error('환불 한도 초과');", kind: 'del' },
            { lineNumber: 44, text: '    if (amount > REFUND_LIMIT) {', kind: 'add' },
            {
              lineNumber: 45,
              text: '      throw new RefundLimitError(amount, REFUND_LIMIT);',
              kind: 'add',
            },
            { lineNumber: 46, text: '    }', kind: 'ctx' },
          ],
          aiComment:
            '`REFUND_LIMIT`이 `policy.ts`에서 `100_000`으로 정의되어 있습니다. 기존 50,000원 → 100,000원으로 상향되는데, 이는 명시적 비즈니스 결정인지 확인이 필요합니다. 관련 이슈 또는 ADR 링크가 PR 설명에 없습니다.',
        },
        {
          kind: 'expanded',
          id: 'hunk-fixture-3',
          reason: {
            text: '동시 환불 처리 시 race condition 가능성 — 트랜잭션 격리 수준이 명시되어 있지 않습니다.',
            tone: 'alert',
          },
          lines: [
            { lineNumber: 78, text: '@@ -78,6 +78,9 @@ class RefundService {', kind: 'hunk-head' },
            { lineNumber: 78, text: '  async processRefund(orderId: string) {', kind: 'ctx' },
            {
              lineNumber: 79,
              text: '    const order = await this.orderRepo.findById(orderId);',
              kind: 'ctx',
            },
            {
              lineNumber: 80,
              text: '    if (order.status === RefundStatus.IN_PROGRESS) {',
              kind: 'add',
            },
            { lineNumber: 81, text: '      return order;', kind: 'add' },
            { lineNumber: 82, text: '    }', kind: 'add' },
            {
              lineNumber: 83,
              text: '    return this.refundRepo.create({ orderId });',
              kind: 'ctx',
            },
          ],
          aiComment:
            '동시에 같은 `orderId`로 호출이 들어오면 두 트랜잭션 모두 `status` 체크를 통과한 뒤 환불을 중복 생성할 수 있습니다. `SELECT FOR UPDATE` 또는 분산 락이 필요해 보입니다.',
        },
      ],
    },
  ],
};
