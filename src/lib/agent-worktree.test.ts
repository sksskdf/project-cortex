// agent-worktree 의 git worktree 동작은 실제 git 으로 검증(샌드박스에 git 존재 — claude 만 부재).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAgentWorktree,
  isGitRepo,
  removeAgentWorktree,
  worktreeBranchFor,
  worktreePathFor,
} from './agent-worktree';

let dir: string;
let repo: string;

function g(args: string[], cwd = repo): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-wt-'));
  repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  g(['config', 'commit.gpgsign', 'false']); // 샌드박스 전역 서명 설정 무시.
  g(['config', 'tag.gpgsign', 'false']);
  writeFileSync(join(repo, 'f.txt'), 'hi');
  g(['add', '.']);
  g(['commit', '-q', '--no-gpg-sign', '-m', 'init']);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agent-worktree', () => {
  it('worktreePathFor 는 형제 .cortex-worktrees 아래 결정적 경로', () => {
    const p = worktreePathFor('/x/repo', 'abc');
    expect(p).toBe(join('/x', '.cortex-worktrees', 'repo-abc'));
  });

  it('createAgentWorktree 가 전용 브랜치로 worktree 생성, 재호출 시 재사용', () => {
    const wt = createAgentWorktree(repo, 's1');
    expect(wt).toBe(worktreePathFor(repo, 's1'));
    expect(existsSync(wt!)).toBe(true);
    // 전용 브랜치가 생겼고 worktree 목록에 포함.
    expect(g(['branch', '--list', worktreeBranchFor('s1')])).toContain('cortex/session-s1');
    const list = g(['worktree', 'list']);
    expect(list).toContain(wt!);
    // 멱등 — 이미 있으면 같은 경로 반환(에러 없이).
    expect(createAgentWorktree(repo, 's1')).toBe(wt);
  });

  it('removeAgentWorktree 가 worktree + 브랜치를 정리', () => {
    const wt = createAgentWorktree(repo, 's2')!;
    expect(existsSync(wt)).toBe(true);
    removeAgentWorktree(repo, 's2');
    expect(existsSync(wt)).toBe(false);
    expect(g(['branch', '--list', worktreeBranchFor('s2')]).trim()).toBe('');
  });

  it('removeAgentWorktree 는 worktree 없으면 no-op (OFF 모드 안전)', () => {
    expect(() => removeAgentWorktree(repo, 'never')).not.toThrow();
  });

  it('비-git 경로는 isGitRepo=false, createAgentWorktree=null', () => {
    const plain = join(dir, 'plain');
    execFileSync('mkdir', ['-p', plain]);
    expect(isGitRepo(plain)).toBe(false);
    expect(createAgentWorktree(plain, 's')).toBeNull();
  });
});
