import type { CodeLine, PRTag } from '@/lib/types';

// 클러스터링 분석 출력은 Phase 6에서 자동 생성될 예정.
// 현재는 mock-equivalent 시각 유지용 fixture.

export type ClusterDescriptionSegment = { text: string; code?: boolean };
export type ClusterDiffDetailSegment = { text: string; code?: boolean; emphasis?: boolean };

export type ClusterDiffRowFixture = {
  id: string;
  prNumbers: ReadonlyArray<number>;
  title: string;
  detailSegments: ReadonlyArray<ClusterDiffDetailSegment>;
  flag: PRTag;
};

export type ClusterFixture = {
  descriptionSegments: ReadonlyArray<ClusterDescriptionSegment>;
  patternSourceLabel: string;
  patternLines: ReadonlyArray<CodeLine>;
  diffs: ReadonlyArray<ClusterDiffRowFixture>;
  decisionNote: { highlight: string; rest: string };
};

const i18nFixture: ClusterFixture = {
  descriptionSegments: [
    { text: '5개 PR이 동일한 패턴으로 ' },
    { text: 't()', code: true },
    { text: ' 호출을 추가합니다. 한 번의 결정으로 처리할 수 있어요.' },
  ],
  patternSourceLabel: 'settings/page.tsx (#946)',
  patternLines: [
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
  diffs: [
    {
      id: 'diff-identical',
      prNumbers: [946, 945, 839, 838],
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
      prNumbers: [837],
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
  decisionNote: {
    highlight: '#837은 신규 키 정의를 포함합니다.',
    rest: '일괄 머지 시 새 키 8개가 함께 들어갑니다 — 영문 번역이 빠져 있지 않은지 확인하세요.',
  },
};

// 패턴별 fixture (cluster.pattern 컬럼 값으로 lookup).
export const clusterFixtures: Record<string, ClusterFixture> = {
  'i18n-labels': i18nFixture,
};

// "다른 패턴" PR 번호 — fixture 차이점 행에서 단독으로 분류된 PR.
export const clusterIndividualReviewNumber: Record<string, number> = {
  'i18n-labels': 837,
};
