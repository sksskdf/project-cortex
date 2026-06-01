// Phase 13.6 — 위임 세션에 Cortex 워크플로 컨텍스트를 주입.
// 정적 방법론(커밋 트레일러·Closes 컨벤션·브랜치 규칙 등)은 cortex 스킬(cortex-skill.ts →
// ~/.claude/skills/cortex)에 두고, 여기선 "이 레포가 Cortex 관리 대상"이라는 안내 +
// 동적 상태(로드맵 남은 작업 요약)를 초기 prompt 앞에 붙인다. 불러온 프로젝트에서도
// claude 세션이 Cortex 맥락을 갖고 시작하도록.

import { getProjectRoadmap } from './roadmap';

// 프리앰블이 너무 길면 bracketed-paste 주입이 부담스러우니 Phase/항목 수를 제한.
const MAX_PHASES = 8;
const MAX_ITEMS_PER_PHASE = 5;

export function buildCortexContextPreamble(projectId: number): string {
  const lines: string[] = [
    '# Cortex 컨텍스트',
    '이 작업은 Cortex 가 관리하는 레포입니다. 작업 전 `.cortex/roadmap.md` 를 확인하고, ' +
      'Cortex 워크플로(의미 있는 커밋 + 트레일러, 완료 시 `Closes #PHASE-<키>`/`Closes #ITEM-<id>`, ' +
      '지정 개발 브랜치, 작업 종료 시 PR 생성, PR 전 typecheck·prettier·테스트)를 따르세요. ' +
      '자세한 규칙은 `cortex` 스킬을 참고하세요.',
    '**작업 완료 시 마지막 commit message 에 `Cortex: ready` trailer 를 박으세요** — 이 신호가 ' +
      '있어야 Cortex 가 자동 머지 큐에 올립니다(분석 후 추가 commit push 로 인한 race 박제).',
  ];

  const roadmap = getProjectRoadmap(projectId);
  if (roadmap) {
    const openGroups = roadmap.openItemGroups.filter((g) => g.openCount > 0);
    if (openGroups.length > 0) {
      lines.push('', '## 로드맵 남은 작업', `전체 진척 ${roadmap.overallPct}%`);
      for (const g of openGroups.slice(0, MAX_PHASES)) {
        const items = g.items
          .filter((i) => i.status !== 'done')
          .slice(0, MAX_ITEMS_PER_PHASE)
          .map((i) => i.title);
        lines.push(`- Phase ${g.phaseKey} ${g.phaseTitle}: ${items.join(' / ')}`);
      }
    }
  }

  lines.push('', '---', '');
  return lines.join('\n');
}
