// PR 머지 버튼 게이팅 단일 구현 — 상세(PRActions)·인박스 행(deriveRowActions) 공용.
// "머지 가능한가 + 아니면 왜" 를 한 곳에서 계산해 두 화면이 일관되게 동작한다.
//
// 핵심: CI 가 없는 레포(필수 체크 0개)는 GitHub mergeable_state 가 'clean' 으로 온다.
// 이때 testsPassed 는 영원히 null 이지만 머지는 가능하므로 'CI 대기' 로 막지 않는다.

export type MergeBlockReasonKey =
  | 'conflict'
  | 'blocked'
  | 'ciFailed'
  | 'ciPending'
  | 'ciPendingManual';

// CI 게이트 통과 여부. testsPassed===true(통과) 또는 testsPassed===null 이면서
// mergeable_state==='clean'(CI 없는 레포 — GitHub 가 머지 가능 판정) 일 때 통과.
export function ciSatisfied(testsPassed: boolean | null, mergeableState: string | null): boolean {
  return testsPassed === true || (testsPassed === null && mergeableState === 'clean');
}

export type MergeGateInput = {
  // installation 있는 레포인가 (없으면 시드/데모 PR — GitHub 머지 불가).
  hasInstall: boolean;
  // 머지/닫힘이 아닌가.
  active: boolean;
  testsPassed: boolean | null;
  mergeableState: string | null;
  autoMergeEnabled: boolean;
};

export type MergeGate = {
  canMerge: boolean;
  // CI 미통과로 막혔는지 (대기/실패) — disabled 사유 노출용. canMerge=false 의 부분 집합.
  mergeBlockedByCI: boolean;
  // 막힌 사유 키 (없으면 null). copy 의 pr.actionBar.mergeBlock[key] 로 문구화.
  reasonKey: MergeBlockReasonKey | null;
};

// 우선순위: 충돌(dirty) > 보호규칙(blocked) > CI 실패 > CI 대기.
// 충돌·차단·실패는 사용자 조치 필요, CI 대기는 시간 지나면 풀림.
export function computeMergeGate(input: MergeGateInput): MergeGate {
  const blockedByState = input.mergeableState === 'dirty' || input.mergeableState === 'blocked';
  const ciOk = !input.hasInstall || ciSatisfied(input.testsPassed, input.mergeableState);
  // 'mergeBlockedByCI' 는 **지배적 사유가 CI 일 때만** true. 예전엔 CI 실패 + state=blocked 인 PR
  // 에서 reasonKey='blocked' 인데 mergeBlockedByCI=true 라 UI 가 모순된 사유를 동시 표시했다(리뷰
  // 발견 — canMerge 는 정확). state 차단(충돌·보호규칙)이 있으면 그게 사용자 조치 1순위라 CI 사유
  // 는 숨김. reasonKey 의 우선순위와 일관.
  const mergeBlockedByCI = input.hasInstall && input.active && !ciOk && !blockedByState;
  const canMerge = input.hasInstall && input.active && ciOk && !blockedByState;

  let reasonKey: MergeBlockReasonKey | null = null;
  if (input.active && input.hasInstall) {
    if (input.mergeableState === 'dirty') reasonKey = 'conflict';
    else if (input.mergeableState === 'blocked') reasonKey = 'blocked';
    else if (mergeBlockedByCI) {
      reasonKey =
        input.testsPassed === false
          ? 'ciFailed'
          : input.autoMergeEnabled
            ? 'ciPending'
            : 'ciPendingManual';
    }
  }

  return { canMerge, mergeBlockedByCI, reasonKey };
}
