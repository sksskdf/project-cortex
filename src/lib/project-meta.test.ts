import { describe, expect, it } from 'vitest';
import { parseProjectYml, parseRoadmapMd } from './project-meta';

describe('parseProjectYml — schema v1', () => {
  it('parses minimal valid file (schema + name + slug)', () => {
    const yml = `schema: 1
name: project-cortex
slug: sksskdf/project-cortex`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.schema).toBe(1);
      expect(r.meta.name).toBe('project-cortex');
      expect(r.meta.slug).toBe('sksskdf/project-cortex');
    }
  });

  it('rejects missing schema field', () => {
    const yml = `name: x\nslug: o/x`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.message).toMatch(/schema/);
  });

  it('rejects schema other than 1', () => {
    const yml = `schema: 2\nname: x\nslug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('error');
  });

  it('rejects missing name', () => {
    const yml = `schema: 1\nslug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('error');
  });

  it('parses nested object (tech / links / automation)', () => {
    const yml = `schema: 1
name: x
slug: o/x
description: one-liner
kind: web-app
domain: code-review
tech:
  language: TypeScript
  framework: Next.js 15
links:
  homepage: https://example.com
  issue_tracker: github
automation:
  auto_merge: true
  ai_review: false`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.description).toBe('one-liner');
      expect(r.meta.kind).toBe('web-app');
      expect(r.meta.tech?.language).toBe('TypeScript');
      expect(r.meta.links?.homepage).toBe('https://example.com');
      expect(r.meta.automation?.auto_merge).toBe(true);
      expect(r.meta.automation?.ai_review).toBe(false);
    }
  });

  it('parses list (owners)', () => {
    const yml = `schema: 1
name: x
slug: o/x
owners:
  - alice
  - bob`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.owners).toEqual(['alice', 'bob']);
    }
  });

  it('ignores # comments + trailing whitespace', () => {
    const yml = `# comment line
schema: 1   # inline comment
name: x
slug: o/x`;
    expect(parseProjectYml(yml).kind).toBe('ok');
  });

  it('handles quoted strings', () => {
    const yml = `schema: 1
name: "with: colon"
slug: 'o/x'`;
    const r = parseProjectYml(yml);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.meta.name).toBe('with: colon');
      expect(r.meta.slug).toBe('o/x');
    }
  });
});

describe('parseRoadmapMd', () => {
  it('parses phase with key + title + items', () => {
    const md = `# Roadmap

## Phase auth — 인증 시스템

- [x] OAuth 연동
- [ ] 2FA 추가`;
    const phases = parseRoadmapMd(md);
    expect(phases).toHaveLength(1);
    expect(phases[0].key).toBe('auth');
    expect(phases[0].title).toBe('인증 시스템');
    expect(phases[0].items).toHaveLength(2);
    expect(phases[0].items[0]).toEqual({ title: 'OAuth 연동', done: true });
    expect(phases[0].items[1]).toEqual({ title: '2FA 추가', done: false });
  });

  it('uses key as title when no em-dash', () => {
    const md = `## Phase launch\n\n- [ ] 결제`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].title).toBe('launch');
  });

  it('captures goal paragraph between heading and first item', () => {
    const md = `## Phase launch — 출시

목표: 결제 + 운영 메트릭 완비.

- [ ] 결제`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].goal).toBe('목표: 결제 + 운영 메트릭 완비.');
  });

  it('handles multiple phases', () => {
    const md = `## Phase a — A
- [x] a1

## Phase b — B
- [ ] b1
- [ ] b2`;
    const phases = parseRoadmapMd(md);
    expect(phases).toHaveLength(2);
    expect(phases[0].key).toBe('a');
    expect(phases[1].key).toBe('b');
    expect(phases[1].items).toHaveLength(2);
  });

  it('skips non-item lines outside heading', () => {
    const md = `random preamble

## Phase x — X
- [x] item1
random tail text
- [ ] item2`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].items).toHaveLength(2);
  });

  it('handles uppercase X in checkbox', () => {
    const md = `## Phase x — X\n- [X] done`;
    const phases = parseRoadmapMd(md);
    expect(phases[0].items[0].done).toBe(true);
  });
});
