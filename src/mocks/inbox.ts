import type { PR } from '@/lib/types';

export type InboxCategoryId = 'all' | 'flagged' | 'large' | 'migration' | 'cluster' | 'mentioned';

export type InboxCategory = {
  id: InboxCategoryId;
  count: number;
};

export type InboxProject = {
  id: string;
  name: string;
  count: number;
  dot: 'blue' | 'green' | 'yellow';
};

export type InboxClusterBanner = {
  id: string;
  title: string;
  description: string;
};

export const inboxClusterBanner: InboxClusterBanner = {
  id: 'cluster-1',
  title: 'i18n 라벨 추가 패턴 — 5건이 묶였어요',
  description: '평균 신뢰 91 · 한 번의 결정으로 5개 PR을 처리할 수 있습니다',
};

export const inboxProjects: ReadonlyArray<InboxProject> = [
  { id: 'cortex-web', name: 'cortex-web', count: 5, dot: 'blue' },
  { id: 'payments-api', name: 'payments-api', count: 2, dot: 'green' },
  { id: 'data-pipeline', name: 'data-pipeline', count: 1, dot: 'yellow' },
];

export const inboxQueue: ReadonlyArray<PR> = [
  {
    id: 'pr-101',
    title: '결제 모듈 — 환불 정책 변경',
    repo: 'payments-api',
    number: 1142,
    author: { name: 'Devin', kind: 'agent' },
    tags: [
      { label: '결제 모듈', tone: 'red' },
      { label: '테스트 부족', tone: 'yellow' },
      { label: 'SLA 30분 남음', tone: 'red' },
    ],
    reason: { text: '결제 영역 변경 + 테스트 커버리지 58%로 기준 미달입니다.', tone: 'alert' },
    additions: 286,
    deletions: 47,
    fileCount: 14,
    ageText: '12분 전',
    gauge: { value: 46, tier: 'error' },
  },
  {
    id: 'pr-102',
    title: '데이터베이스 — users 테이블 인덱스 추가',
    repo: 'payments-api',
    number: 1141,
    author: { name: 'Codex', kind: 'agent' },
    tags: [
      { label: '마이그레이션', tone: 'red' },
      { label: 'DB 스키마', tone: 'purple' },
    ],
    reason: { text: '프로덕션 마이그레이션 포함 — 사람 승인이 항상 필수입니다.', tone: 'alert' },
    additions: 34,
    deletions: 0,
    fileCount: 2,
    ageText: '38분 전',
    gauge: { value: 63, tier: 'warning' },
  },
  {
    id: 'pr-103',
    title: '알림 — Slack webhook 연동 추가',
    repo: 'cortex-web',
    number: 843,
    author: { name: 'Devin', kind: 'agent' },
    tags: [{ label: '외부 API', tone: 'purple' }],
    reason: { text: '신규 외부 호출이 추가되었습니다 — 보안 검토를 권장합니다.', tone: 'warn' },
    additions: 128,
    deletions: 12,
    fileCount: 6,
    ageText: '1시간 전',
    gauge: { value: 76, tier: 'blue' },
  },
  {
    id: 'pr-104',
    title: '검색 페이지 — 무한 스크롤 적용',
    repo: 'cortex-web',
    number: 842,
    author: { name: '서연', kind: 'human' },
    tags: [{ label: 'UI 변경', tone: 'sky-blue' }],
    reason: { text: '사람 작성 PR — 자동 머지 정책에서 항상 제외됩니다.', tone: 'info' },
    additions: 92,
    deletions: 38,
    fileCount: 4,
    ageText: '2시간 전',
    gauge: { value: 82, tier: 'blue' },
  },
  {
    id: 'pr-105',
    title: '대시보드 — 차트 라이브러리 마이너 업데이트',
    repo: 'cortex-web',
    number: 841,
    author: { name: 'Codex', kind: 'agent' },
    tags: [{ label: '의존성', tone: 'gray' }],
    reason: { text: '의존성 변경 — lock 파일 비교가 권장됩니다.', tone: 'info' },
    additions: 12,
    deletions: 8,
    fileCount: 1,
    ageText: '3시간 전',
    gauge: { value: 84, tier: 'blue' },
  },
  {
    id: 'pr-106',
    title: '결제 영수증 PDF 폰트 교체',
    repo: 'payments-api',
    number: 1140,
    author: { name: 'Devin', kind: 'agent' },
    tags: [{ label: '결제 모듈', tone: 'red' }],
    reason: { text: '결제 도메인 — 정책상 사람 검토가 필요합니다.', tone: 'alert' },
    additions: 24,
    deletions: 11,
    fileCount: 3,
    ageText: '5시간 전',
    gauge: { value: 71, tier: 'warning' },
  },
  {
    id: 'pr-107',
    title: '로그 파이프라인 — 에러 레벨 필터 추가',
    repo: 'data-pipeline',
    number: 312,
    author: { name: '내부 에이전트', kind: 'agent' },
    tags: [{ label: '큰 변경', tone: 'yellow' }],
    reason: { text: '500줄 이상 변경 — 큰 PR 정책으로 인한 검토 요청입니다.', tone: 'warn' },
    additions: 412,
    deletions: 187,
    fileCount: 22,
    ageText: '6시간 전',
    gauge: { value: 79, tier: 'blue' },
  },
  {
    id: 'pr-108',
    title: '문서 사이트 — 검색 인덱스 재생성',
    repo: 'cortex-web',
    number: 840,
    author: { name: 'Codex', kind: 'agent' },
    tags: [{ label: '문서', tone: 'gray' }],
    reason: { text: '빌드 산출물 변경 — 캐시 무효화가 필요할 수 있습니다.', tone: 'info' },
    additions: 8,
    deletions: 4,
    fileCount: 1,
    ageText: '1일 전',
    gauge: { value: 88, tier: 'success' },
  },
];

export const inboxCategories: ReadonlyArray<InboxCategory> = [
  { id: 'all', count: inboxQueue.length },
  { id: 'flagged', count: 2 },
  { id: 'large', count: 3 },
  { id: 'migration', count: 1 },
  { id: 'cluster', count: 2 },
  { id: 'mentioned', count: 0 },
];
