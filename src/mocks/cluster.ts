import type { CodeLine, GaugeTier, PRTag } from '@/lib/types';

export type Similarity = 'identical' | 'different';

export type ClusterPR = {
  id: string;
  number: number;
  title: string;
  repo: string;
  score: number;
  scoreTier: GaugeTier;
  similarity: Similarity;
  active?: boolean;
};

export type ClusterDiffRow = {
  id: string;
  numbers: ReadonlyArray<number>;
  title: string;
  detailSegments: ReadonlyArray<{ text: string; code?: boolean; emphasis?: boolean }>;
  flag: PRTag;
};

export type ClusterSummary = {
  avgScore: number;
  totalAdditions: number;
  filesChanged: number;
};

export type ClusterDecisionNote = {
  highlight: string;
  rest: string;
};

export type ClusterDetail = {
  id: string;
  title: string;
  descriptionSegments: ReadonlyArray<{ text: string; code?: boolean }>;
  detectedAgo: string;
  author: string;
  repo: string;
  prs: ReadonlyArray<ClusterPR>;
  summary: ClusterSummary;
  pattern: {
    sourceLabel: string;
    lines: ReadonlyArray<CodeLine>;
  };
  diffs: ReadonlyArray<ClusterDiffRow>;
  individualReviewNumber: number;
  decisionNote: ClusterDecisionNote;
};

export const clusterDetail: ClusterDetail = {
  id: 'cluster-1',
  title: 'i18n 라벨 추가 패턴',
  descriptionSegments: [
    { text: '5개 PR이 동일한 패턴으로 ' },
    { text: 't()', code: true },
    { text: ' 호출을 추가합니다. 한 번의 결정으로 처리할 수 있어요.' },
  ],
  detectedAgo: '3시간 전',
  author: 'Devin',
  repo: 'cortex-web',
  prs: [
    {
      id: 'pr-841',
      number: 841,
      title: '설정 페이지 — i18n 라벨 추가',
      repo: 'cortex-web',
      score: 92,
      scoreTier: 'success',
      similarity: 'identical',
      active: true,
    },
    {
      id: 'pr-840',
      number: 840,
      title: '알림 페이지 — i18n 라벨 추가',
      repo: 'cortex-web',
      score: 94,
      scoreTier: 'success',
      similarity: 'identical',
    },
    {
      id: 'pr-839',
      number: 839,
      title: '프로필 페이지 — i18n 라벨 추가',
      repo: 'cortex-web',
      score: 91,
      scoreTier: 'success',
      similarity: 'identical',
    },
    {
      id: 'pr-838',
      number: 838,
      title: '결제 페이지 — i18n 라벨 추가',
      repo: 'cortex-web',
      score: 93,
      scoreTier: 'success',
      similarity: 'identical',
    },
    {
      id: 'pr-837',
      number: 837,
      title: '대시보드 — i18n 라벨 + 신규 키 정의',
      repo: 'cortex-web',
      score: 85,
      scoreTier: 'blue',
      similarity: 'different',
    },
  ],
  summary: {
    avgScore: 91,
    totalAdditions: 184,
    filesChanged: 18,
  },
  pattern: {
    sourceLabel: 'settings/page.tsx (#841)',
    lines: [
      { lineNumber: 12, text: "import { useState } from 'react';", kind: 'ctx' },
      { lineNumber: 13, text: "import { useTranslation } from '@/i18n';", kind: 'add' },
      { lineNumber: 14, text: '', kind: 'ctx' },
      { lineNumber: 15, text: 'export default function SettingsPage() {', kind: 'ctx' },
      { lineNumber: 16, text: "  const { t } = useTranslation('settings');", kind: 'add' },
      { lineNumber: 17, text: '  return (', kind: 'ctx' },
      { lineNumber: 18, text: '    <div>', kind: 'ctx' },
      { lineNumber: 19, text: '      <h1>설정</h1>', kind: 'del' },
      { lineNumber: 20, text: '      <p>계정 정보를 관리하세요</p>', kind: 'del' },
      { lineNumber: 19, text: "      <h1>{t('title')}</h1>", kind: 'add' },
      { lineNumber: 20, text: "      <p>{t('description')}</p>", kind: 'add' },
      { lineNumber: 21, text: '    </div>', kind: 'ctx' },
      { lineNumber: 22, text: '  );', kind: 'ctx' },
      { lineNumber: 23, text: '}', kind: 'ctx' },
    ],
  },
  diffs: [
    {
      id: 'diff-identical',
      numbers: [841, 840, 839, 838],
      title: '기존 i18n 키 참조만 추가',
      detailSegments: [
        { text: '이미 정의된 키(' },
        { text: 'settings.title', code: true },
        { text: ', ' },
        { text: 'notifications.title', code: true },
        { text: ' 등)를 ' },
        { text: 't()', code: true },
        { text: '로 감싸기만 합니다. 새 키 정의 없음.' },
      ],
      flag: { label: '동일 패턴', tone: 'cyan' },
    },
    {
      id: 'diff-837',
      numbers: [837],
      title: 'i18n 라벨 + 신규 키 8개 정의',
      detailSegments: [
        { text: '대시보드 페이지는 일부 텍스트의 키가 아직 ' },
        { text: 'i18n/ko.json', code: true },
        { text: '에 없어서 ' },
        { text: '신규 키 8개', emphasis: true },
        {
          text: '를 함께 정의합니다. 키 이름 컨벤션은 다른 PR과 동일하지만, 검토 시 새 키의 영문 번역도 확인이 필요합니다.',
        },
      ],
      flag: { label: '차이 있음', tone: 'yellow' },
    },
  ],
  individualReviewNumber: 837,
  decisionNote: {
    highlight: '#837은 신규 키 정의를 포함합니다.',
    rest: '일괄 머지 시 새 키 8개가 함께 들어갑니다 — 영문 번역이 빠져 있지 않은지 확인하세요.',
  },
};
