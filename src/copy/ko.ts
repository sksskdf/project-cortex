export const ko = {
  app: {
    name: 'Cortex',
    tagline: '에이전트가 짜고, 사람은 가장 중요한 결정만 합니다.',
  },
  nav: {
    section: {
      workspace: '워크스페이스',
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
    // 헤더 3 버튼 모두 백엔드 미구현으로 disabled. 어느 Phase 에서 활성화될지 hover/aria 로 알려줌.
    header: {
      notificationsHint: '알림 — Phase 7 (운영 메트릭 + 이벤트) 예정',
      startAgentHint: '에이전트 시작 — Phase 13 (Claude CLI 통합) 예정',
      newIssueHint: '새 이슈 — Phase 13 (Claude CLI 통합) 예정',
    },
    principle: {
      title: (count: number) => `이번 주 ${count}건이 자동 머지되었어요`,
      desc: '에이전트가 자신 있는 작업은 자동으로 처리됩니다. 인박스에는 검토가 필요한 것만 올라옵니다.',
    },
    stat: {
      pendingReview: '검토 대기',
      autoMergedThisWeek: '이번 주 자동 머지',
      humanMergedThisWeek: '이번 주 수동 머지',
      agentsRunning: '에이전트 진행 중',
      avgConfidence: '평균 신뢰 점수',
      runningNow: '지금 실행 중',
      runningIdle: '진행 중 에이전트 없음',
      scoreUnit: '점',
      regionAria: '현황',
    },
    section: {
      todo: '지금 처리할 것',
      todoMore: '인박스 전체 보기 →',
      recentMerge: '최근 머지',
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
      // 머지 종류별 한 줄 메시지 — kind 가 auto/human/github.
      merged: (kind: 'auto' | 'human' | 'github', agent: string, title: string, score: number) => {
        const action =
          kind === 'auto'
            ? '자동 머지했어요'
            : kind === 'human'
              ? 'Cortex 에서 직접 머지했어요'
              : 'GitHub 에서 머지됐어요';
        const trailing = kind === 'github' ? '' : ` · 신뢰 점수 ${score}`;
        return `${agent}이(가) ${title}을(를) ${action}${trailing}`;
      },
      // 작은 배지용 라벨 (kind 별).
      mergeKindBadge: {
        auto: '자동',
        human: '수동',
        github: '외부',
      },
    },
    workload: {
      count: (current: number, capacity: number) => `${current} / ${capacity}`,
      empty: '진행 중인 에이전트가 없습니다 — 이슈에서 에이전트를 시작하면 여기에 표시됩니다.',
    },
    cluster: {
      bundle: (title: string, count: number) => `${title} · ${count}건이 묶였어요`,
    },
  },
  // /projects 페이지 (Phase 8) — 등록된 프로젝트 목록 + 통계 + 액션.
  projects: {
    title: '프로젝트',
    subtitle: 'Cortex 가 다루는 GitHub 레포 목록 — 통계 · 자동 머지 · 동기화.',
    empty: {
      title: '등록된 프로젝트가 없습니다',
      desc: 'GitHub App 을 레포에 설치하면 첫 webhook 도착 시 자동으로 등록됩니다.',
    },
    section: {
      active: '활성 (App 설치됨)',
      seed: '시드 / 데모',
      seedDesc: 'GitHub installation 이 없어 실 webhook 받지 못합니다 — 화면 확인용.',
    },
    stat: {
      active: '활성 PR',
      merged: '머지 누적',
      avgConfidence: '평균 신뢰',
    },
    action: {
      autoMerge: '자동 머지',
      sync: '동기화',
    },
    seedBadge: '시드',
  },
  // 인박스 / 대시보드 행 인라인 액션 — PR 상세 안 들어가도 빠르게 머지·닫기·삭제 가능.
  row: {
    actions: {
      merge: '머지',
      mergeAria: 'PR 머지',
      mergeBlockedByCI: 'CI 결과 대기 중 — 통과 후 머지 가능',
      close: '닫기',
      closeAria: 'PR 닫기 (폐기)',
      deleteBranch: '브랜치 삭제',
      deleteBranchAria: 'head 브랜치 삭제',
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
      done: '완료',
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
    body: {
      title: 'PR 설명',
      ariaLabel: 'PR 본문',
    },
    reviews: {
      title: '리뷰 이력',
      ariaLabel: 'PR 리뷰 이력',
      stateLabel: {
        APPROVED: '승인',
        CHANGES_REQUESTED: '변경 요청',
        COMMENTED: '코멘트',
        DISMISSED: '취소됨',
        PENDING: '대기',
      },
    },
    aiSummary: {
      title: 'Cortex 사전 리뷰',
      subtitle: '자동 분석 완료 · 사람 검토를 권장합니다',
      ariaLabel: 'AI 사전 리뷰',
    },
    fixtureBanner: '이 PR 은 아직 분석되지 않았습니다',
    fixtureBannerDesc:
      'GitHub 에서 가져온 diff 를 표시하고 있어요. AI 분석을 요청하면 신뢰 점수·위험 플래그가 채워집니다.',
    seedBanner: '시드 데이터 화면',
    seedBannerDesc:
      'GitHub installation 이 없어 샘플 화면을 표시합니다. 실 PR 은 분석되거나 GitHub diff 가 표시됩니다.',
    analyze: {
      request: 'AI 분석 요청',
      pending: '분석 중…',
      done: '분석 완료',
      disabledByToggle: 'AI 분석 비활성 — 설정에서 켜기',
      result: {
        success: '분석이 완료되었습니다. 페이지를 새로고침하면 결과가 보입니다.',
        error: (message: string) => `분석 실패: ${message}`,
      },
    },
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
      requestPlaceholder:
        '어떤 부분을 수정해야 할지 짧게 적어주세요. 비워두면 일반 안내 문구가 전송됩니다.',
      requestSubmit: '변경 요청 보내기',
      requestSending: '보내는 중…',
      requestCancel: '취소',
      autoApprove: '자동 승인 가능 항목만 머지',
      mergeAll: '전체 머지',
      merging: '머지 중…',
      // 머지 완료 후 노출 — 머지 = 브랜치 자동 삭제 한 흐름.
      mergedWithBranchDeleted: '머지 완료 — 브랜치도 자동 삭제했어요.',
      // PR 닫기 — 머지 안 하고 폐기. 테스트용 PR / 의미 없어진 PR 정리.
      closePR: 'PR 닫기',
      closeConfirm:
        '이 PR 을 머지하지 않고 닫습니다. GitHub 에서도 closed 상태가 됩니다 — 되돌리려면 reopen 필요.',
      closeConfirmSubmit: '닫기',
      closing: '닫는 중…',
      // GitHub mergeable_state 가 'dirty'/'blocked' 일 때 또는 CI 결과 대기 중일 때
      // 머지 버튼 옆에 표시되는 사유.
      mergeBlock: {
        conflict: '머지 불가 · base 와 충돌',
        blocked: '머지 불가 · 보호 규칙·필수 리뷰로 차단됨',
        ciPending: '머지 대기 · CI 결과 도착 후 자동 머지',
      },
      result: {
        merged: (shortSha: string) => `머지 완료 (${shortSha}).`,
        error: (message: string) => `머지 실패: ${message}`,
        branchDeleted: (ref: string) => `브랜치 삭제됨: ${ref}.`,
        branchSkipped: (message: string) => message,
        branchError: (message: string) => `브랜치 삭제 실패: ${message}`,
        requestSubmitted: '변경 요청이 GitHub 에 전송되었습니다.',
        requestError: (message: string) => `변경 요청 실패: ${message}`,
        closed: (number: number) => `PR #${number} 을 닫았습니다.`,
        closeError: (message: string) => `PR 닫기 실패: ${message}`,
      },
    },
  },
  // Phase 7 — /reports 페이지 (운영 메트릭 시각화).
  reports: {
    title: '보고서',
    subtitle: '최근 7일 자동 머지율 · 인입량 · 신뢰 점수 추이 · revert 감지.',
    section: {
      mergeRate: '자동 머지율',
      mergeRateDesc: '머지된 PR 중 Cortex 가 정책 기반으로 자동 머지한 비율.',
      dailyIncoming: '일별 PR 인입',
      dailyIncomingDesc: '새로 도착한 PR 수 (최근 7일).',
      dailyMerges: '일별 머지 추이',
      dailyMergesDesc: '자동(파랑) · 수동(노랑) · 외부(회색) 합계 (최근 7일).',
      avgConfidence: '평균 신뢰 점수 추이',
      avgConfidenceDesc: 'AI 분석된 PR 의 평균 신뢰 점수 (일별, 최근 7일).',
      reverts: 'Revert 감지',
      revertsDesc:
        '제목이 "Revert " 로 시작하는 PR — GitHub revert UI 로 만들어진 케이스. 자동 머지가 잘못된 변경을 머지했을 가능성 신호.',
    },
    mergeRate: {
      compareTo: (prev: number) => `지난 주 ${prev}%`,
      total: (auto: number, total: number) => `자동 ${auto} / 전체 ${total}건 머지`,
      breakdown: (auto: number, human: number, github: number) =>
        `자동 ${auto} · 수동 ${human} · 외부 ${github}`,
    },
    legend: {
      auto: '자동',
      human: '수동',
      github: '외부',
    },
    revertEmpty: '감지된 revert 가 없습니다.',
    revertStatus: {
      merged: '머지됨',
      open: '열림',
      'review-needed': '검토 필요',
      'auto-mergeable': '머지 가능',
      closed: '닫힘',
    },
  },
  // Phase 7 — 헤더 알림 드롭다운. 이벤트별 라벨/포맷.
  notifications: {
    title: '알림',
    open: '알림 열기',
    empty: '새 알림이 없습니다.',
    markAllRead: '모두 읽음',
    markAllReadAria: '알림을 모두 읽음으로 표시',
    unreadBadge: (n: number) => (n > 99 ? '99+' : `${n}`),
    kindLabel: {
      'auto-merged': '자동 머지',
      'auto-merge-failed': '자동 머지 실패',
      'ci-failed': 'CI 실패',
      'cluster-created': '새 클러스터',
      'revert-detected': 'Revert 감지',
    },
  },
  settings: {
    title: '설정',
    subtitle: '단일 사용자 모드. 토글은 즉시 반영됩니다.',
    ai: {
      title: 'AI 사전 리뷰',
      ariaLabel: 'AI 분석 토글',
      desc: 'Cortex 가 webhook 으로 들어오는 PR 을 Anthropic 으로 분석할지 여부. 끄면 Anthropic 크레딧 사용이 0 입니다.',
      on: 'ON',
      off: 'OFF',
      statusOn: '활성',
      statusOff: '비활성',
      impactTitle: '비활성 시 동작',
      impact: {
        analyze:
          'Anthropic 호출 0 — 신규 PR 의 신뢰 점수 · 위험 플래그 · hunk 어노테이션이 채워지지 않음.',
        cluster: '자동 클러스터링 안 됨 (changedPaths 없어 자카드 계산 불가).',
        autoMerge:
          '자동 머지 안 됨 (preReview 없음). 단 현재 testsPassed 미연동이라 어차피 자동 머지는 비활성 상태.',
        humanFlow: 'PR 은 review-needed 로 인박스에 등장 — 사용자가 직접 머지 · 브랜치 삭제 가능.',
      },
      result: {
        enabled: 'AI 분석을 활성화했습니다.',
        disabled: 'AI 분석을 비활성화했습니다 — 다음 webhook 부터 Anthropic 호출 0.',
        error: (message: string) => `설정 변경 실패: ${message}`,
      },
    },
    // /projects 페이지로 이전된 프로젝트별 토글 안내. 컴포넌트가 result 메시지에 쓰는
    // reconcile.button / pending / result 와 autoMerge.result 는 그대로 유지.
    projectsLink: {
      title: '프로젝트별 설정',
      desc: '자동 머지 정책 · GitHub 와 동기화는 [프로젝트] 페이지에서 각 레포 카드에 모았습니다.',
      cta: '프로젝트 페이지로 →',
    },
    reconcile: {
      button: 'GitHub 와 동기화',
      pending: '동기화 중…',
      result: {
        reconciled: (slug: string, total: number, inserted: number, updated: number) =>
          `${slug} — 총 ${total}건 (신규 ${inserted} · 갱신 ${updated}). AI 분석은 안 했어요.`,
        error: (message: string) => `동기화 실패: ${message}`,
      },
    },
    autoMerge: {
      result: {
        enabled: (slug: string, retriagedCount: number) =>
          retriagedCount > 0
            ? `${slug} 자동 머지를 활성화했습니다 — 활성 PR ${retriagedCount}건 재트라이아지.`
            : `${slug} 자동 머지를 활성화했습니다.`,
        disabled: (slug: string) => `${slug} 자동 머지를 비활성화했습니다.`,
        notFound: '프로젝트를 찾을 수 없거나 GitHub App 설치 정보가 없습니다.',
        error: (message: string) => `설정 변경 실패: ${message}`,
      },
    },
  },
  clustersIndex: {
    title: '클러스터',
    subtitle: '같은 작성자 · 같은 패턴 PR 을 묶어 한 번에 결정합니다.',
    section: {
      active: '활성 클러스터',
      closed: '닫힘 — 머지 · 해체',
    },
    empty: {
      active: '아직 활성 클러스터가 없습니다.',
      closed: '닫힌 클러스터가 없습니다.',
    },
    statusLabel: {
      open: '열림',
      'partially-merged': '일부 머지',
      merged: '전체 머지',
      dissolved: '해체',
    },
    card: {
      meta: (count: number, author: string, repo: string) => `PR ${count}건 · ${author} · ${repo}`,
      score: '평균 신뢰',
      detectedAgo: (text: string) => `${text} 자동 묶음`,
      closedAgo: (text: string) => `${text} 닫힘`,
    },
  },
  cluster: {
    backToInbox: '인박스로 돌아가기',
    chip: '클러스터',
    detectedAgo: (text: string) => `${text} 자동 묶음`,
    description: {
      prefix: (count: number) => `${count}개 PR이 `,
      suffix: (totalPaths: number) =>
        totalPaths > 1
          ? ` 외 ${totalPaths - 1}개 파일을 공통으로 수정합니다.`
          : ' 를 공통으로 수정합니다.',
      noCommonPath: (count: number) =>
        `${count}개 PR이 같은 작성자의 유사 변경입니다 — 파일 경로는 분기되어 있어요.`,
    },
    derived: {
      majorityTitle: (count: number) => `${count}개 PR — 동일 패턴`,
      outlierTitle: (count: number) =>
        count > 1 ? `${count}개 PR — 다른 패턴` : '단독 PR — 다른 패턴',
      detailCommonPath: (count: number, path: string, totalPaths: number) =>
        totalPaths > 1
          ? `${count}개 PR 모두 ${path} 외 ${totalPaths - 1}개 파일을 공통으로 변경합니다.`
          : `${count}개 PR 모두 ${path} 를 변경합니다.`,
      detailNoCommonPath: (count: number) => `${count}개 PR이 분기된 경로를 변경합니다.`,
      flagIdentical: '동일 패턴',
      flagOther: '다른 패턴',
      noteOutlierHighlight: (number: number) => `#${number}는 다른 패턴입니다.`,
      noteOutlierRest: '일괄 머지 전에 해당 PR 의 차이를 한 번 더 확인하세요.',
      noteUniformHighlight: (total: number) => `${total}개 PR 이 동일 패턴입니다.`,
      noteUniformRest: '플래그가 일치하므로 일괄 머지 후보로 안전합니다.',
    },
    prList: {
      ariaLabel: '클러스터 PR 목록',
      title: (count: number) => `묶인 PR · ${count}건`,
      similarity: {
        identical: '동일',
        different: '약간 다름',
      },
      // 클러스터 사이드바의 PR 카드 상태 라벨 — 인박스와 일관성 보강.
      statusLabel: {
        merged: '머지됨',
        closed: '닫힘',
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
      // 클러스터링은 파일 셋 자카드 기준이라 같은 라인을 보장하지 않음.
      // 라벨을 "대표 변경 — 1건의 hunk 발췌" 로 정직하게 표기.
      title: (count: number) =>
        count > 1 ? `대표 변경 — ${count}개 PR 중 1건의 hunk 발췌` : '대표 변경 — 1건의 hunk 발췌',
      example: (sample: string) => `발췌: ${sample}`,
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
      pending: '처리 중…',
      result: {
        allMerged: (count: number) => `${count}건이 머지되었습니다.`,
        partial: (merged: number, failed: number, skipped: number, total: number) =>
          `전체 ${total}건 중 ${merged}건 머지 · ${failed}건 실패 · ${skipped}건 건너뜀.`,
        branches: (deleted: number, skipped: number, failed: number) => {
          const parts: string[] = [];
          if (deleted > 0) parts.push(`${deleted}개 삭제`);
          if (skipped > 0) parts.push(`${skipped}개 건너뜀`);
          if (failed > 0) parts.push(`${failed}개 실패`);
          return parts.length > 0 ? `브랜치: ${parts.join(' · ')}.` : '';
        },
        dissolved: (released: number) =>
          `클러스터를 해제했습니다 — PR ${released}건이 인박스로 돌아갔습니다.`,
        error: (message: string) => `처리 중 오류가 발생했습니다: ${message}`,
        closed: '이미 닫힌 클러스터입니다 — 추가 머지/해제는 불가합니다.',
      },
    },
  },
} as const;
