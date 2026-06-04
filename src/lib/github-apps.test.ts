import { createHmac } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { githubApps, projects } from '@/db/schema';
import {
  allWebhookSecrets,
  createGithubApp,
  deleteGithubApp,
  listAppCandidates,
  listGithubApps,
  resolveAppCredentials,
  updateGithubApp,
} from './github-apps';
import { verifyGithubSignatureAny } from './webhook-verify';

beforeAll(() => {
  migrate(db, { migrationsFolder: 'src/db/migrations' });
});

beforeEach(() => {
  db.delete(projects).run(); // appConfigId FK → githubApps 전에 비움.
  db.delete(githubApps).run();
});

const PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=\n-----END RSA PRIVATE KEY-----';

describe('createGithubApp / validation', () => {
  it('creates a valid app and masks key in list view', () => {
    const r = createGithubApp({ name: 'personal', appId: '123456', privateKey: PEM });
    expect(r.kind).toBe('created');
    const list = listGithubApps();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('personal');
    expect(list[0].appId).toBe('123456');
    expect(list[0].hasPrivateKey).toBe(true);
    expect(list[0].hasWebhookSecret).toBe(false);
    // view 에 private key 원문이 노출되지 않음.
    expect(JSON.stringify(list[0])).not.toContain('PRIVATE KEY');
  });

  it('rejects non-numeric appId and short key', () => {
    expect(createGithubApp({ name: 'x', appId: 'abc', privateKey: PEM }).kind).toBe('invalid');
    expect(createGithubApp({ name: 'x', appId: '1', privateKey: 'short' }).kind).toBe('invalid');
  });

  it('rejects duplicate name', () => {
    createGithubApp({ name: 'dup', appId: '1', privateKey: PEM });
    expect(createGithubApp({ name: 'dup', appId: '2', privateKey: PEM }).kind).toBe(
      'duplicate-name',
    );
  });
});

describe('updateGithubApp', () => {
  it('keeps existing key when privateKey left blank', () => {
    const created = createGithubApp({ name: 'a', appId: '1', privateKey: PEM });
    const id = created.kind === 'created' ? created.id : 0;
    const r = updateGithubApp(id, { name: 'a2', appId: '2', privateKey: '' });
    expect(r.kind).toBe('updated');
    const creds = resolveAppCredentials(id);
    expect(creds?.appId).toBe('2');
    expect(creds?.privateKey).toBe(PEM); // 유지됨
  });

  it('not-found for missing id', () => {
    expect(updateGithubApp(9999, { name: 'a', appId: '1', privateKey: PEM }).kind).toBe(
      'not-found',
    );
  });
});

describe('resolveAppCredentials', () => {
  it('returns the configured app credentials by id', () => {
    const created = createGithubApp({ name: 'a', appId: '777', privateKey: PEM });
    const id = created.kind === 'created' ? created.id : 0;
    expect(resolveAppCredentials(id)?.appId).toBe('777');
  });

  it('falls back to null when id missing and no env app', () => {
    // 테스트 환경엔 GITHUB_APP_ID env 가 없으므로 env 폴백도 null.
    expect(resolveAppCredentials(12345)).toBeNull();
    expect(resolveAppCredentials(null)).toBeNull();
  });
});

describe('allWebhookSecrets + verifyGithubSignatureAny', () => {
  it('verifies a webhook signed with one of the registered secrets', () => {
    createGithubApp({ name: 'a', appId: '1', privateKey: PEM, webhookSecret: 'secret-a' });
    createGithubApp({ name: 'b', appId: '2', privateKey: PEM, webhookSecret: 'secret-b' });

    const secrets = allWebhookSecrets();
    expect(secrets).toContain('secret-a');
    expect(secrets).toContain('secret-b');

    const body = '{"hello":"world"}';
    const sig = 'sha256=' + createHmac('sha256', 'secret-b').update(body, 'utf8').digest('hex');
    expect(verifyGithubSignatureAny(body, sig, secrets)).toBe(true);

    const wrong = 'sha256=' + createHmac('sha256', 'nope').update(body, 'utf8').digest('hex');
    expect(verifyGithubSignatureAny(body, wrong, secrets)).toBe(false);
  });

  it('rejects when there are no candidate secrets', () => {
    expect(verifyGithubSignatureAny('{}', 'sha256=abc', [])).toBe(false);
  });
});

describe('deleteGithubApp', () => {
  it('deletes and reports not-found', () => {
    const created = createGithubApp({ name: 'a', appId: '1', privateKey: PEM });
    const id = created.kind === 'created' ? created.id : 0;
    expect(deleteGithubApp(id).kind).toBe('deleted');
    expect(deleteGithubApp(id).kind).toBe('not-found');
  });

  // 회귀(리뷰 발견): projects.appConfigId 가 참조하는 App 삭제 시 FK throw → import 후 영영
  // 못 지웠다. 트랜잭션 안에서 참조 project 의 appConfigId 를 null 로 하고 삭제해야.
  it('project 가 appConfigId 로 참조해도 FK throw 없이 삭제 + project 는 보존(링크 해제)', () => {
    const created = createGithubApp({ name: 'a', appId: '1', privateKey: PEM });
    const id = created.kind === 'created' ? created.id : 0;
    const proj = db
      .insert(projects)
      .values({ slug: 'acme/web', name: 'web', appConfigId: id })
      .returning({ id: projects.id })
      .get();

    expect(() => deleteGithubApp(id)).not.toThrow();
    expect(deleteGithubApp(id).kind).toBe('not-found'); // 정말 삭제됨
    // project 는 보존되되 appConfigId 만 null.
    const after = db.select().from(projects).where(eq(projects.id, proj.id)).get();
    expect(after).toBeDefined();
    expect(after?.appConfigId).toBeNull();
  });
});

describe('listAppCandidates', () => {
  it('lists all configured apps (env 없을 때 DB 만)', () => {
    createGithubApp({ name: 'a', appId: '1', privateKey: PEM });
    createGithubApp({ name: 'b', appId: '2', privateKey: PEM });
    const all = listAppCandidates(undefined);
    expect(all.map((c) => c.appId).sort()).toEqual(['1', '2']);
  });

  it('puts the explicit appConfigId first (자가 복구 우선순위)', () => {
    createGithubApp({ name: 'a', appId: '1', privateKey: PEM });
    const second = createGithubApp({ name: 'b', appId: '2', privateKey: PEM });
    const id = second.kind === 'created' ? second.id : 0;
    const ordered = listAppCandidates(id);
    expect(ordered[0]?.appConfigId).toBe(id);
    // 나머지 후보도 폴백으로 포함.
    expect(ordered.map((c) => c.appId).sort()).toEqual(['1', '2']);
  });
});
