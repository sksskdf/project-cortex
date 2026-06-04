import { describe, expect, it } from 'vitest';
import { allowedToolsFor } from './cli-permissions';

describe('allowedToolsFor — R4 작업별 허용목록', () => {
  it('OFF 면 undefined (→ claude-cli 가 dangerously 폴백, 무회귀)', () => {
    expect(allowedToolsFor('test-fix', false)).toBeUndefined();
    expect(allowedToolsFor('conflict-resolve', false)).toBeUndefined();
    expect(allowedToolsFor('review-fix', false)).toBeUndefined();
  });

  it('test-fix — 코드편집 + 테스트실행에 필요한 최소 도구', () => {
    const tools = allowedToolsFor('test-fix', true)!;
    expect(tools).toEqual(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash']);
    // WebFetch·Task·MCP 등 자동화에 불필요한 도구는 포함 안 함(의도).
    expect(tools).not.toContain('WebFetch');
    expect(tools).not.toContain('WebSearch');
    expect(tools).not.toContain('Task');
  });

  it('conflict-resolve — 파일 편집만 필요(Bash 없음 — git 은 호출자 외부)', () => {
    const tools = allowedToolsFor('conflict-resolve', true)!;
    expect(tools).toEqual(['Read', 'Edit', 'Write', 'Grep', 'Glob']);
    expect(tools).not.toContain('Bash');
  });

  it('review-fix — 코드 편집 + 테스트 재실행', () => {
    expect(allowedToolsFor('review-fix', true)).toEqual([
      'Read',
      'Edit',
      'Write',
      'Grep',
      'Glob',
      'Bash',
    ]);
  });
});
