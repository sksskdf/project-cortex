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
    todos: 'TODO',
    notes: '메모',
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
    // 알림·새 이슈 hint 는 미구현/예정 안내. 에이전트 시작은 Phase 13 활성화 — /agents 로 이동.
    header: {
      notificationsHint: '알림 — Phase 7 (운영 메트릭 + 이벤트) 예정',
      startAgentHint: '에이전트 — Claude Code 세션 매니저로 이동',
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
      projects: '프로젝트 진척',
      projectsMore: '프로젝트 전체 →',
    },
    projectsWidget: {
      empty: '등록된 프로젝트가 없습니다.',
      // 한 행: slug + 진척 + open count.
      openCount: (n: number) => `남은 ${n}건`,
      // 모든 phase 완료 또는 phase 없음.
      noOpen: '진행 항목 없음',
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
      seed: 'App 미설치 (대기 / 시드)',
      seedDesc:
        'GitHub installation 이 없어 webhook 을 받지 못합니다. App 설치 후 첫 webhook 도착 시 자동 연결됩니다.',
    },
    stat: {
      active: '활성 PR',
      merged: '머지 누적',
      avgConfidence: '평균 신뢰',
    },
    action: {
      autoMerge: '자동 머지',
      sync: '동기화',
      roadmap: '로드맵',
    },
    autoMergeAria: (enabled: boolean) =>
      enabled ? '자동 머지 켜짐 — 누르면 끔' : '자동 머지 꺼짐 — 누르면 켬',
    seedBadge: '시드',
    progress: {
      label: '진척',
      phases: (done: number, total: number) => `Phase ${done} / ${total}`,
      empty: '로드맵 없음',
    },
    // 카드 통계 한 줄 — 활성 PR · 머지 누적 · 평균 신뢰.
    statInline: (active: number, merged: number, confidence: number) =>
      `활성 ${active} · 머지 ${merged} · 신뢰 ${confidence || '-'}`,
    add: {
      button: '프로젝트 추가',
      title: '수동 레포 등록',
      desc: 'GitHub App 미설치 상태에서도 레포를 미리 등록할 수 있어요. 설치 후 첫 webhook 도착 시 자동 연결됩니다.',
      slugLabel: 'GitHub 슬러그 (owner/repo)',
      slugPlaceholder: '예: vercel/next.js',
      nameLabel: '표시 이름 (옵션)',
      namePlaceholder: '비워두면 슬러그로 대체',
      cancel: '취소',
      submit: '등록',
      result: {
        added: '프로젝트를 등록했습니다.',
        duplicate: '이미 등록된 슬러그입니다.',
        invalidSlug: (reason: string) => `슬러그 오류: ${reason}`,
        error: (message: string) => `처리 실패: ${message}`,
      },
    },
    drawer: {
      open: '로드맵 열기',
      title: '로드맵',
      close: '닫기',
      expand: '전체 화면',
      expandAria: '로드맵 전체 화면으로 이동',
      empty: '아직 로드맵이 없습니다 — 우측 상단 전체 화면에서 동기화 또는 Phase 추가.',
    },
  },
  // Phase 10 — 프로젝트별 로드맵 화면.
  roadmap: {
    title: '로드맵',
    subtitle: (slug: string) => `${slug} 의 Phase · 산출물 진척도.`,
    backToProject: '← 프로젝트로',
    overallProgress: (pct: number) => `전체 진척 ${pct}%`,
    empty: {
      title: '아직 등록된 Phase 가 없습니다',
      desc: 'Phase 를 추가하면 카드 + 산출물 체크박스로 진척을 추적할 수 있어요.',
    },
    section: {
      addPhase: 'Phase 추가',
      addItem: '산출물 추가',
    },
    phase: {
      keyLabel: '키',
      keyPlaceholder: '예: 3 / auth / launch',
      keyHint: 'PR 본문의 "Closes #PHASE-<키>" 형식으로 자동 done 됩니다.',
      titleLabel: '제목',
      titlePlaceholder: 'Phase 이름 (예: GitHub 통합)',
      goalLabel: '목표 (선택)',
      goalPlaceholder: '이 Phase 의 산출물 또는 DoD',
      submit: 'Phase 추가',
      cancel: '취소',
      delete: '삭제',
      deleteConfirm: '이 Phase 와 산출물을 모두 삭제합니다.',
      deleteSubmit: '삭제',
      noItems: '산출물 없음',
    },
    item: {
      titleLabel: '제목',
      titlePlaceholder: '산출물 이름',
      submit: '추가',
      cancel: '취소',
      delete: '삭제',
      autoDoneBadge: '자동 완료',
      autoDoneTip: (prId: number) => `PR #${prId} 머지로 자동 완료됨`,
    },
    statusLabel: {
      planned: '예정',
      'in-progress': '진행 중',
      done: '완료',
    },
    statusAria: '상태 변경',
    result: {
      created: '추가했습니다.',
      updated: '갱신했습니다.',
      deleted: '삭제했습니다.',
      duplicateKey: '이미 같은 키의 Phase 가 있어요.',
      notFound: '대상을 찾을 수 없습니다.',
      noProject: '프로젝트를 찾을 수 없습니다.',
      error: (message: string) => `처리 실패: ${message}`,
    },
    prLinks: {
      title: '연결된 로드맵',
      ariaLabel: '이 PR 이 닫는 로드맵 항목',
      phaseLabel: (key: string) => `PHASE-${key}`,
      itemLabel: (id: number) => `ITEM-${id}`,
    },
    // Phase 10.1 — .cortex/ 동기화 + open items 패널 + source 배지.
    sync: {
      button: '.cortex 동기화',
      pending: '동기화 중…',
      result: {
        synced: (phases: number, items: number) =>
          `동기화 완료 — Phase ${phases}건 · 산출물 ${items}건 갱신.`,
        noMetaFile: '.cortex/project.yml 이 없습니다 — 레포에 추가 후 다시 시도.',
        noInstallation: 'GitHub App 설치가 없어 동기화 불가.',
        noProject: '프로젝트를 찾을 수 없습니다.',
        parseError: (message: string) => `메타 파싱 실패: ${message}`,
        error: (message: string) => `동기화 실패: ${message}`,
      },
    },
    openItems: {
      title: '남은 작업',
      ariaLabel: '진행 중 + 예정 산출물 목록',
      empty: '남은 작업이 없습니다 — 모두 완료되었어요.',
      count: (n: number) => `${n}건`,
      // open items 패널의 한 줄: phase key + item title.
      phaseRef: (phaseKey: string) => `PHASE-${phaseKey}`,
      // Phase 그룹 헤더: 남은 N / 전체 M 또는 모두 완료.
      openOf: (open: number, total: number) => `${open} / ${total}건 남음`,
      allDone: '모두 완료',
      groupEmpty: '이 Phase 의 항목이 없습니다.',
      prLinkTip: '이 항목을 완료한 PR 로 이동',
    },
    sourceBadge: {
      git: 'git',
      gitTip: '.cortex/roadmap.md 에서 가져옴 — 다음 동기화 시 갱신',
      override: '사용자 수정',
      overrideTip: 'git 항목을 사용자가 수정함 — 다음 동기화 시 충돌 표기',
    },
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
      // CI 상태 라벨 — running 은 GitHub check run 이 queued/in_progress 일 때.
      status: {
        passed: '통과',
        failed: '실패',
        running: '측정중',
        none: '미측정',
      },
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
        ciFailed: '머지 불가 · CI 실패 — 원인 수정 후 재시도',
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
    // Phase 10.2 후속 — 브라우저 Notification 권한 토글 chip.
    browserPerm: {
      label: '브라우저 알림',
      deniedShort: '차단',
      tooltip: '브라우저 알림 권한 토글',
      deniedHint: '브라우저 설정에서 알림 권한을 허용해 주세요.',
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
      button: 'PR 동기화',
      pending: '동기화 중…',
      result: {
        reconciled: (slug: string, total: number, inserted: number, updated: number) =>
          total === 0
            ? `${slug} — 최근 갱신된 PR 이 없어요.`
            : `${slug} — 총 ${total}건 (신규 ${inserted} · 갱신 ${updated}). AI 분석은 안 했어요.`,
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
  // Phase 11 — TODO 페이지 + 사이드바 위젯.
  todos: {
    title: 'TODO',
    subtitle: '한 줄 작업을 빠르게 적고 관리합니다.',
    empty: '아직 등록된 TODO 가 없습니다.',
    // 프로젝트별 관리 + 개인(미연결) — projectId null = 개인.
    projectLabel: '프로젝트',
    projectFilterAll: '전체',
    projectPersonal: '개인',
    section: {
      open: '진행 중',
      done: '완료',
    },
    add: {
      placeholder: '새 TODO — Enter 로 추가',
      noteLabel: '메모 (선택)',
      prioritySelect: '우선순위',
      submit: '추가',
    },
    priority: {
      low: '낮음',
      normal: '보통',
      high: '높음',
    },
    actions: {
      toggle: '완료 토글',
      delete: '삭제',
    },
    meta: {
      due: (text: string) => `마감 ${text}`,
      project: (slug: string) => `· ${slug}`,
      pr: (number: number) => `· #${number}`,
    },
    widget: {
      title: '오늘 할 일',
      empty: 'TODO 없음',
      more: '전체 보기 →',
    },
  },
  // Phase 12 — 로컬 워크스페이스 등록 + git pull.
  workspace: {
    title: '로컬 워크스페이스',
    subtitle: '로컬 클론 경로를 등록해 git pull / 향후 Claude CLI spawn 의 작업 디렉토리로 사용.',
    notRegistered: '워크스페이스 미등록',
    notRegisteredDesc: '로컬 클론 경로를 등록하면 한 클릭으로 git pull 할 수 있어요.',
    register: '워크스페이스 등록',
    pathLabel: '로컬 절대 경로',
    pathPlaceholder: '예: /home/user/projects/my-repo 또는 C:\\dev\\my-repo',
    submit: '등록',
    cancel: '취소',
    update: '경로 변경',
    remove: '등록 해제',
    removeConfirm: (path: string) => `${path} 등록을 해제할까요?`,
    removeConfirmYes: '해제',
    removeConfirmNo: '취소',
    pullButton: 'git pull',
    pullPending: 'git pull 중…',
    lastPull: (ago: string) => `마지막: ${ago}`,
    result: {
      registered: '워크스페이스를 등록했습니다.',
      updated: '경로를 변경했습니다.',
      deleted: '등록을 해제했습니다.',
      invalidPath: (reason: string) => `경로 오류: ${reason}`,
      noProject: '프로젝트를 찾을 수 없습니다.',
      noWorkspace: '등록된 워크스페이스가 없습니다.',
      pulled: 'git pull 완료',
      pullFailed: 'git pull 실패',
      error: (message: string) => `처리 실패: ${message}`,
    },
  },
  // Phase 13 — Claude CLI 터미널 임베드 (전역 drawer).
  agents: {
    title: '에이전트',
    subtitle: '등록된 워크스페이스에서 Claude Code 를 실행합니다.',
    launcher: '에이전트 열기',
    close: '닫기',
    expand: '전체화면',
    collapse: '축소',
    pickerLabel: '워크스페이스',
    start: 'Claude Code 시작',
    stop: '세션 종료',
    restart: '다시 시작',
    placeholder: '워크스페이스를 고르고 시작을 누르면 터미널이 열립니다.',
    hint: 'claude CLI 가 선택한 경로에서 실행됩니다. 사용자 Claude 플랜을 사용하며 별도 크레딧이 들지 않습니다.',
    notReady: 'claude CLI 를 찾을 수 없습니다. 설치 후 다시 시도해 주세요.',
    status: {
      connecting: '연결 중…',
      open: '실행 중',
      closed: '세션 종료됨',
      error: '연결 오류',
    },
    sessionEnd: (code: string) => `claude 세션 종료 — code ${code}`,
    empty: {
      title: '등록된 워크스페이스가 없습니다',
      desc: '프로젝트에 로컬 워크스페이스를 먼저 등록해 주세요.',
      cta: '프로젝트로 이동',
    },
  },
  // Phase 11 후속 — 자유 마크다운 메모.
  notes: {
    title: '메모',
    subtitle: '자유 메모. 핀 고정하면 상단에 유지됩니다.',
    add: '메모 추가',
    titlePlaceholder: '제목',
    bodyPlaceholder: '메모 본문 (마크다운 OK)',
    searchPlaceholder: '제목 / 본문 검색',
    // 프로젝트별 관리 + 개인(미연결) 노트 — projectId null = 개인.
    projectLabel: '프로젝트',
    projectFilterAll: '전체',
    projectPersonal: '개인',
    cancel: '취소',
    save: '저장',
    edit: '편집',
    delete: '삭제',
    pin: '핀 고정',
    unpin: '핀 해제',
    deleteConfirm: '이 메모를 삭제할까요?',
    deleteConfirmYes: '삭제',
    deleteConfirmNo: '취소',
    pinnedLabel: '핀 고정',
    empty: '메모가 없습니다. 첫 메모를 추가해 보세요.',
    emptySearch: (q: string) => `"${q}" 와 일치하는 메모가 없습니다.`,
    untitled: '제목 없음',
    error: {
      emptyTitle: '제목은 필수입니다.',
      notFound: '메모를 찾을 수 없습니다.',
      generic: (message: string) => `처리 실패: ${message}`,
    },
    widget: {
      title: '핀 메모',
      more: '전체 보기 →',
      empty: '핀 고정한 메모가 없습니다.',
    },
  },
} as const;
