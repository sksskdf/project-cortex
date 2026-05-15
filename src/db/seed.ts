import { sql } from 'drizzle-orm';
import { db } from './client';
import { clusters, preReviews, prs, projects, triageDecisions } from './schema';

// seed는 멱등하지 않습니다 — 매번 전체 데이터를 새로 만듭니다.
// 개발용. 프로덕션은 Phase 3+에서 GitHub 동기화로 데이터 적재.

const NOW = Date.now();
const ago = {
  min: (m: number) => new Date(NOW - m * 60_000),
  hour: (h: number) => new Date(NOW - h * 60 * 60_000),
  day: (d: number) => new Date(NOW - d * 24 * 60 * 60_000),
};

function reset() {
  // FK 의존 역순으로 삭제 + 안정된 ID 부여를 위해 AUTOINCREMENT 카운터 초기화.
  db.delete(triageDecisions).run();
  db.delete(preReviews).run();
  db.delete(prs).run();
  db.delete(clusters).run();
  db.delete(projects).run();
  db.run(
    sql`DELETE FROM sqlite_sequence WHERE name IN ('projects', 'issues', 'agent_runs', 'clusters', 'prs', 'pre_reviews', 'triage_decisions')`,
  );
}

function seedProjects() {
  return db
    .insert(projects)
    .values([
      { slug: 'cortex-web', name: 'Cortex Web', defaultBranch: 'master', autoMergeEnabled: true },
      {
        slug: 'payments-api',
        name: 'Payments API',
        defaultBranch: 'main',
        autoMergeEnabled: false,
      },
      {
        slug: 'data-pipeline',
        name: 'Data Pipeline',
        defaultBranch: 'main',
        autoMergeEnabled: false,
      },
    ])
    .returning({ id: projects.id, slug: projects.slug })
    .all();
}

function seedI18nCluster() {
  return db
    .insert(clusters)
    .values({
      pattern: 'i18n-labels',
      title: 'i18n 라벨 추가 패턴',
      commonDiffSnippet: 'useTranslation + t() 호출',
      avgConfidence: 91,
      status: 'open',
      createdAt: ago.hour(3),
    })
    .returning({ id: clusters.id })
    .get();
}

type RepoMap = Map<string, number>;

function seedInboxQueue(repoIds: RepoMap, i18nClusterId: number) {
  const rows = [
    {
      slug: 'payments-api',
      number: 1142,
      title: '결제 모듈 — 환불 정책 변경',
      authorKind: 'agent' as const,
      authorId: 'Devin',
      headSha: 'sha-101',
      linesAdded: 286,
      linesRemoved: 47,
      filesChanged: 14,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.min(12),
      preReview: {
        confidence: 46,
        confidenceTier: 'critical' as const,
        flags: ['payment-domain', 'low-coverage'] as string[],
        summary: '결제 도메인 변경 + 커버리지 미달',
        testsPassed: true,
        coverage: 0.58,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '결제 영역 변경 + 테스트 커버리지 58%로 기준 미달입니다.',
      },
    },
    {
      slug: 'payments-api',
      number: 1141,
      title: '데이터베이스 — users 테이블 인덱스 추가',
      authorKind: 'agent' as const,
      authorId: 'Codex',
      headSha: 'sha-102',
      linesAdded: 34,
      linesRemoved: 0,
      filesChanged: 2,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.min(38),
      preReview: {
        confidence: 63,
        confidenceTier: 'low' as const,
        flags: ['migration', 'db-schema'] as string[],
        summary: '프로덕션 마이그레이션 포함',
        testsPassed: true,
        coverage: 0.82,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '프로덕션 마이그레이션 포함 — 사람 승인이 항상 필수입니다.',
      },
    },
    {
      slug: 'cortex-web',
      number: 843,
      title: '알림 — Slack webhook 연동 추가',
      authorKind: 'agent' as const,
      authorId: 'Devin',
      headSha: 'sha-103',
      linesAdded: 128,
      linesRemoved: 12,
      filesChanged: 6,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.hour(1),
      preReview: {
        confidence: 76,
        confidenceTier: 'medium' as const,
        flags: ['external-api-new'] as string[],
        summary: '신규 외부 호출 — 보안 검토 권장',
        testsPassed: true,
        coverage: 0.81,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '신규 외부 호출이 추가되었습니다 — 보안 검토를 권장합니다.',
      },
    },
    {
      slug: 'cortex-web',
      number: 842,
      title: '검색 페이지 — 무한 스크롤 적용',
      authorKind: 'human' as const,
      authorId: '서연',
      headSha: 'sha-104',
      linesAdded: 92,
      linesRemoved: 38,
      filesChanged: 4,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.hour(2),
      preReview: {
        confidence: 82,
        confidenceTier: 'medium' as const,
        flags: ['ui-change'] as string[],
        summary: '사람 작성 PR',
        testsPassed: true,
        coverage: 0.88,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '사람 작성 PR — 자동 머지 정책에서 항상 제외됩니다.',
      },
    },
    {
      slug: 'cortex-web',
      number: 841,
      title: '대시보드 — 차트 라이브러리 마이너 업데이트',
      authorKind: 'agent' as const,
      authorId: 'Codex',
      headSha: 'sha-105',
      linesAdded: 12,
      linesRemoved: 8,
      filesChanged: 1,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.hour(3),
      preReview: {
        confidence: 84,
        confidenceTier: 'medium' as const,
        flags: ['dependency'] as string[],
        summary: '의존성 마이너 업데이트',
        testsPassed: true,
        coverage: 0.87,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '의존성 변경 — lock 파일 비교가 권장됩니다.',
      },
    },
    {
      slug: 'payments-api',
      number: 1140,
      title: '결제 영수증 PDF 폰트 교체',
      authorKind: 'agent' as const,
      authorId: 'Devin',
      headSha: 'sha-106',
      linesAdded: 24,
      linesRemoved: 11,
      filesChanged: 3,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.hour(5),
      preReview: {
        confidence: 71,
        confidenceTier: 'medium' as const,
        flags: ['payment-domain'] as string[],
        summary: '결제 도메인 변경',
        testsPassed: true,
        coverage: 0.79,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '결제 도메인 — 정책상 사람 검토가 필요합니다.',
      },
    },
    {
      slug: 'data-pipeline',
      number: 312,
      title: '로그 파이프라인 — 에러 레벨 필터 추가',
      authorKind: 'agent' as const,
      authorId: '내부 에이전트',
      headSha: 'sha-107',
      linesAdded: 412,
      linesRemoved: 187,
      filesChanged: 22,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.hour(6),
      preReview: {
        confidence: 79,
        confidenceTier: 'medium' as const,
        flags: ['large-change'] as string[],
        summary: '500줄 이상 변경',
        testsPassed: true,
        coverage: 0.83,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '500줄 이상 변경 — 큰 PR 정책으로 인한 검토 요청입니다.',
      },
    },
    {
      slug: 'cortex-web',
      number: 840,
      title: '문서 사이트 — 검색 인덱스 재생성',
      authorKind: 'agent' as const,
      authorId: 'Codex',
      headSha: 'sha-108',
      linesAdded: 8,
      linesRemoved: 4,
      filesChanged: 1,
      status: 'review-needed' as const,
      clusterId: null,
      createdAt: ago.day(1),
      preReview: {
        confidence: 88,
        confidenceTier: 'medium' as const,
        flags: ['documentation'] as string[],
        summary: '빌드 산출물 변경',
        testsPassed: true,
        coverage: 0.91,
      },
      triage: {
        decision: 'human-review' as const,
        reason: '빌드 산출물 변경 — 캐시 무효화가 필요할 수 있습니다.',
      },
    },
    // 클러스터 내 5개 PR (i18n 라벨 패턴). cluster_id 부착 → 인박스 개별 큐에서 제외.
    ...[
      { number: 837, title: '대시보드 — i18n 라벨 + 신규 키 정의', score: 85 },
      { number: 838, title: '결제 페이지 — i18n 라벨 추가', score: 93 },
      { number: 839, title: '프로필 페이지 — i18n 라벨 추가', score: 91 },
      { number: 945, title: '알림 페이지 — i18n 라벨 추가', score: 94 },
      { number: 946, title: '설정 페이지 — i18n 라벨 추가', score: 92 },
    ].map((c, i) => ({
      slug: 'cortex-web',
      number: c.number,
      title: c.title,
      authorKind: 'agent' as const,
      authorId: 'Devin',
      headSha: `sha-cluster-${c.number}`,
      linesAdded: 24 + i * 6,
      linesRemoved: 8 + i * 2,
      filesChanged: 1,
      status: 'review-needed' as const,
      clusterId: i18nClusterId,
      createdAt: ago.hour(3 + i),
      preReview: {
        confidence: c.score,
        confidenceTier: 'medium' as const,
        flags: ['ui-change'] as string[],
        summary: 'i18n 키 참조 추가',
        testsPassed: true,
        coverage: 0.9,
      },
      triage: {
        decision: 'cluster' as const,
        reason: 'i18n 라벨 패턴 — 클러스터 일괄 처리 후보.',
      },
    })),
  ];

  for (const r of rows) {
    const repoId = repoIds.get(r.slug);
    if (repoId === undefined) throw new Error(`unknown repo slug: ${r.slug}`);

    const inserted = db
      .insert(prs)
      .values({
        repoId,
        number: r.number,
        title: r.title,
        authorKind: r.authorKind,
        authorId: r.authorId,
        headSha: r.headSha,
        linesAdded: r.linesAdded,
        linesRemoved: r.linesRemoved,
        filesChanged: r.filesChanged,
        status: r.status,
        clusterId: r.clusterId,
        createdAt: r.createdAt,
        updatedAt: r.createdAt,
      })
      .returning({ id: prs.id })
      .get();

    db.insert(preReviews)
      .values({
        prId: inserted.id,
        headSha: r.headSha,
        confidence: r.preReview.confidence,
        confidenceTier: r.preReview.confidenceTier,
        flags: r.preReview.flags,
        summary: r.preReview.summary,
        testsPassed: r.preReview.testsPassed,
        coverage: r.preReview.coverage,
        analyzedAt: r.createdAt,
      })
      .run();

    db.insert(triageDecisions)
      .values({
        prId: inserted.id,
        decision: r.triage.decision,
        reason: r.triage.reason,
        clusterId: r.triage.decision === 'cluster' ? i18nClusterId : null,
        decidedBy: 'system',
        decidedAt: r.createdAt,
      })
      .run();
  }
}

function seedRecentAutoMerges(repoIds: RepoMap) {
  const rows = [
    {
      slug: 'cortex-web',
      number: 830,
      title: 'i18n 라벨 12개 추가',
      authorId: 'Devin',
      headSha: 'sha-fa-1',
      linesAdded: 38,
      linesRemoved: 6,
      filesChanged: 4,
      mergedAt: ago.min(3),
      confidence: 94,
    },
    {
      slug: 'payments-api',
      number: 1135,
      title: '유닛 테스트 보강',
      authorId: 'Codex',
      headSha: 'sha-fa-2',
      linesAdded: 124,
      linesRemoved: 18,
      filesChanged: 7,
      mergedAt: ago.min(14),
      confidence: 91,
    },
    {
      slug: 'cortex-web',
      number: 829,
      title: '타입 정의 정리',
      authorId: 'Devin',
      headSha: 'sha-fa-3',
      linesAdded: 56,
      linesRemoved: 42,
      filesChanged: 11,
      mergedAt: ago.min(42),
      confidence: 96,
    },
    {
      slug: 'data-pipeline',
      number: 310,
      title: '의존성 패치 업데이트',
      authorId: '내부 에이전트',
      headSha: 'sha-fa-4',
      linesAdded: 14,
      linesRemoved: 14,
      filesChanged: 5,
      mergedAt: ago.hour(1),
      confidence: 89,
    },
    {
      slug: 'cortex-web',
      number: 828,
      title: 'README 오타 수정',
      authorId: 'Codex',
      headSha: 'sha-fa-5',
      linesAdded: 4,
      linesRemoved: 4,
      filesChanged: 1,
      mergedAt: ago.hour(2),
      confidence: 99,
    },
  ];

  for (const r of rows) {
    const repoId = repoIds.get(r.slug);
    if (repoId === undefined) throw new Error(`unknown repo slug: ${r.slug}`);

    const inserted = db
      .insert(prs)
      .values({
        repoId,
        number: r.number,
        title: r.title,
        authorKind: 'agent',
        authorId: r.authorId,
        headSha: r.headSha,
        linesAdded: r.linesAdded,
        linesRemoved: r.linesRemoved,
        filesChanged: r.filesChanged,
        status: 'merged',
        clusterId: null,
        createdAt: r.mergedAt,
        updatedAt: r.mergedAt,
      })
      .returning({ id: prs.id })
      .get();

    db.insert(preReviews)
      .values({
        prId: inserted.id,
        headSha: r.headSha,
        confidence: r.confidence,
        confidenceTier: 'high',
        flags: [],
        summary: '자동 머지 통과',
        testsPassed: true,
        coverage: 0.9,
        analyzedAt: r.mergedAt,
      })
      .run();

    db.insert(triageDecisions)
      .values({
        prId: inserted.id,
        decision: 'auto-merge',
        reason: '자동 머지 통과',
        clusterId: null,
        decidedBy: 'system',
        decidedAt: r.mergedAt,
      })
      .run();
  }
}

function main() {
  reset();
  const insertedProjects = seedProjects();
  const repoIds = new Map(insertedProjects.map((p) => [p.slug, p.id]));
  const cluster = seedI18nCluster();
  seedInboxQueue(repoIds, cluster.id);
  seedRecentAutoMerges(repoIds);
  console.log('seed completed');
}

main();
