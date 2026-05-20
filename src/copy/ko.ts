export const ko = {
  app: {
    name: 'Cortex',
    tagline: '에이전트가 짜고, 사람은 가장 중요한 결정만 합니다.',
  },
  nav: {
    section: {
      workspace: '워크스페이스',
      favorites: '즐겨찾기',
    },
    dashboard: '대시보드',
    inbox: '인박스',
    projects: '프로젝트',
    agents: '에이전트',
    clusters: '클러스터',
    reports: '보고서',
    settings: '설정',
    help: '도움말',
    comingSoon: '준비 중',
  },
  dashboard: {
    greeting: (name: string) => `안녕하세요, ${name}님`,
    greetingSub: (count: number) => `오늘 검토할 PR이 ${count}건 있습니다. 평균보다 적은 양이에요.`,
    notifications: '알림',
    startAgent: '에이전트 시작',
    newIssue: '새 이슈',
    principle: {
      title: (count: number) => `이번 주 ${count}건이 자동 머지되었어요`,
      desc: '에이전트가 자신 있는 작업은 자동으로 처리됩니다. 인박스에는 검토가 필요한 것만 올라옵니다.',
    },
    stat: {
      pendingReview: '검토 대기',
      autoMergedThisWeek: '이번 주 자동 머지',
      agentsRunning: '에이전트 진행 중',
      avgConfidence: '평균 신뢰 점수',
      runningNow: '지금 실행 중',
      scoreUnit: '점',
      regionAria: '현황',
    },
    section: {
      todo: '지금 처리할 것',
      todoMore: '인박스 전체 보기 →',
      recentAutoMerge: '최근 자동 머지',
      recentMore: '전체 활동 →',
      workload: '에이전트 워크로드',
      workloadMore: '전체 보기 →',
      clusters: '묶인 클러스터',
      clustersMore: '클러스터 보기 →',
    },
    todoRow: {
      diff: (additions: number, deletions: number) => `+${additions} −${deletions}`,
    },
    feed: {
      autoMerged: (agent: string, title: string, score: number) =>
        `${agent}이(가) ${title}을(를) 자동 머지했어요 · 신뢰 점수 ${score}`,
    },
    workload: {
      count: (current: number, capacity: number) => `${current} / ${capacity}`,
      empty: '진행 중인 에이전트가 없습니다 — 이슈에서 에이전트를 시작하면 여기에 표시됩니다.',
    },
    cluster: {
      bundle: (title: string, count: number) => `${title} · ${count}건이 묶였어요`,
    },
  },
  inbox: {
    title: '인박스',
    subtitle: '우선순위 순으로 자동 정렬됩니다. 가장 위에서부터 처리하세요.',
    notifications: '알림',
    filter: '필터',
    sort: {
      priority: '우선순위',
      confidence: '신뢰 점수',
      latest: '최신순',
      author: '작성자',
      ariaLabel: '정렬',
    },
    search: {
      placeholder: '제목, 작성자, 레포로 검색',
      ariaLabel: '검색',
    },
    rail: {
      ariaLabel: '카테고리',
      categoryTitle: '분류',
      projectTitle: '프로젝트',
      all: '전체',
      flagged: '위험 표시됨',
      largeChange: '큰 변경',
      migration: '마이그레이션',
      cluster: '클러스터',
      mentioned: '나에게 멘션',
    },
    clusterBanner: {
      open: '클러스터 열기',
    },
    meta: {
      fileCount: (count: number) => `파일 ${count}`,
    },
  },
  pr: {
    backToInbox: '인박스로 돌아가기',
    authorSuffix: '이 생성',
    confidenceLabel: '신뢰 점수',
    aiSummary: {
      title: 'Cortex 사전 리뷰',
      subtitle: '자동 분석 완료 · 사람 검토를 권장합니다',
      ariaLabel: 'AI 사전 리뷰',
    },
    fixtureBanner: '샘플 데이터 표시 중 — 이 PR 은 아직 분석되지 않았거나 시드 데이터입니다.',
    aiCheck: {
      tests: '테스트 실행',
      coverage: '커버리지',
      risk: '위험 영역',
    },
    tree: {
      ariaLabel: '파일 트리',
      summary: {
        filesChanged: '변경 파일',
        linesAdded: '변경 라인',
        linesDeleted: '삭제 라인',
        autoApprovable: '자동 승인 가능',
        needsReview: '검토 필요',
        hunkCount: (n: number) => `${n} hunk`,
      },
      group: {
        needsReview: '검토 필요 파일',
        autoApprovable: '자동 승인 가능',
        more: (n: number) => `외 ${n}개 파일`,
      },
    },
    collapsedHunk: {
      lines: (count: number) => `${count}줄 변경`,
      expand: '펼치기 →',
      autoApprovable: '자동 승인 가능 · ',
    },
    hunk: {
      reasonLabel: '이유:',
      aiCommentLabel: 'Cortex 코멘트',
    },
    fileDiff: (additions: number, deletions: number) => `+${additions} −${deletions}`,
    actionBar: {
      summary: (autoApprovable: number, total: number) =>
        `총 ${total} hunk 중 ${autoApprovable}개는 자동 승인 가능합니다.`,
      requestChanges: '변경 요청',
      autoApprove: '자동 승인 가능 항목만 머지',
      mergeAll: '전체 머지',
    },
  },
  cluster: {
    backToInbox: '인박스로 돌아가기',
    chip: '클러스터',
    detectedAgo: (text: string) => `${text} 자동 묶음`,
    prList: {
      ariaLabel: '클러스터 PR 목록',
      title: (count: number) => `묶인 PR · ${count}건`,
      similarity: {
        identical: '동일',
        different: '약간 다름',
      },
    },
    info: {
      title: '클러스터 요약',
      subtitle: (count: number, author: string, repo: string) =>
        `전체 PR ${count}건 · 작성자 ${author} · 대상 ${repo}`,
      avgScore: '평균 신뢰 점수',
      totalAdditions: '총 변경 라인',
      filesChanged: '변경 파일',
      tests: '테스트 결과',
      testsAllPass: '전체 통과',
    },
    pattern: {
      title: (count: number) => `공통 패턴 — ${count}개 PR 모두 같은 변경을 합니다`,
      example: (sample: string) => `예시: ${sample}`,
    },
    diff: {
      title: '각 PR의 차이점',
      idList: (numbers: ReadonlyArray<number>) => numbers.map((n) => `#${n}`).join(' · '),
    },
    action: {
      ariaLabel: '결정',
      title: '결정',
      countLabel: '개 PR을 한 번에',
      timeNote: '개별 검토 시 평균 8분 → 클러스터로 1분',
      mergeAll: (count: number) => `전체 ${count}개 머지`,
      splitMerge: (mergeCount: number, individualNumber: number) =>
        `${mergeCount}개만 머지 · #${individualNumber} 개별 검토`,
      switchIndividual: '개별 검토로 전환',
      dissolve: '클러스터 해제',
    },
  },
} as const;
