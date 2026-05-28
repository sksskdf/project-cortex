// Phase 8.x — 다중 GitHub App 설정 CRUD + 자격증명 해석.
// 설정 UI 가 호출하는 동기 함수들 + github.ts 의 인증 레이어가 쓰는 resolveAppCredentials.
// localhost 단일 사용자라 private key 평문 저장 (.env 평문과 동일 수준). env 단일 App 은 폴백.

import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { githubApps, type GithubAppRow } from '@/db/schema';
import { env } from './env';

// 목록 표시용 — private key 는 노출하지 않고 보유 여부만. webhook secret 도 마스킹.
export type GithubAppView = {
  id: number;
  name: string;
  appId: string;
  hasPrivateKey: boolean;
  hasWebhookSecret: boolean;
};

function toView(row: GithubAppRow): GithubAppView {
  return {
    id: row.id,
    name: row.name,
    appId: row.appId,
    hasPrivateKey: row.privateKey.length > 0,
    hasWebhookSecret: (row.webhookSecret ?? '').length > 0,
  };
}

export function listGithubApps(): GithubAppView[] {
  return db.select().from(githubApps).orderBy(asc(githubApps.name)).all().map(toView);
}

export type AppCredentials = { appId: string; privateKey: string };

// appConfigId 로 자격증명 해석. null/미발견이면 env 단일 App 으로 폴백.
// env 도 없으면 null (호출측이 에러 처리). github.ts 인증 레이어가 사용.
export function resolveAppCredentials(
  appConfigId: number | null | undefined,
): AppCredentials | null {
  if (appConfigId != null) {
    const row = db.select().from(githubApps).where(eq(githubApps.id, appConfigId)).get();
    if (row) return { appId: row.appId, privateKey: row.privateKey };
  }
  try {
    return { appId: env.githubAppId(), privateKey: env.githubAppPrivateKey() };
  } catch {
    return null;
  }
}

// webhook 서명 검증용 — 등록된 모든 App 의 secret + env secret. 들어온 webhook 이 어느 App
// 것인지 본문 신뢰 전엔 모르므로, 후보 secret 전체로 시도해 하나라도 맞으면 통과.
export function allWebhookSecrets(): string[] {
  const secrets = new Set<string>();
  for (const row of db.select().from(githubApps).all()) {
    if (row.webhookSecret) secrets.add(row.webhookSecret);
  }
  try {
    secrets.add(env.githubWebhookSecret());
  } catch {
    // env secret 없음 — DB secret 만 사용.
  }
  return [...secrets];
}

const SLUG_OK = /^[\w.\- ]{1,64}$/;

export type SaveAppInput = {
  name: string;
  appId: string;
  privateKey: string;
  webhookSecret?: string;
};

export type SaveAppResult =
  | { kind: 'created'; id: number }
  | { kind: 'updated'; id: number }
  | { kind: 'invalid'; reason: string }
  | { kind: 'duplicate-name' };

function validate(input: SaveAppInput): string | null {
  if (!SLUG_OK.test(input.name.trim())) return '이름은 1~64자의 영문/숫자/._- 만 허용됩니다.';
  if (!/^\d+$/.test(input.appId.trim())) return 'App ID 는 숫자여야 합니다.';
  if (input.privateKey.trim().length < 40) return 'private key(PEM)가 올바르지 않습니다.';
  return null;
}

export function createGithubApp(input: SaveAppInput): SaveAppResult {
  const reason = validate(input);
  if (reason) return { kind: 'invalid', reason };
  const name = input.name.trim();
  const existing = db
    .select({ id: githubApps.id })
    .from(githubApps)
    .where(eq(githubApps.name, name))
    .get();
  if (existing) return { kind: 'duplicate-name' };
  const row = db
    .insert(githubApps)
    .values({
      name,
      appId: input.appId.trim(),
      privateKey: input.privateKey.trim(),
      webhookSecret: input.webhookSecret?.trim() || null,
    })
    .returning({ id: githubApps.id })
    .get();
  return { kind: 'created', id: row.id };
}

// 수정 — private key 가 비어있으면 기존 값 유지(재입력 불필요). webhook secret 도 동일.
export function updateGithubApp(
  id: number,
  input: SaveAppInput,
): SaveAppResult | { kind: 'not-found' } {
  const current = db.select().from(githubApps).where(eq(githubApps.id, id)).get();
  if (!current) return { kind: 'not-found' };
  const merged: SaveAppInput = {
    name: input.name,
    appId: input.appId,
    privateKey: input.privateKey.trim() || current.privateKey,
    webhookSecret: input.webhookSecret?.trim() || current.webhookSecret || undefined,
  };
  const reason = validate(merged);
  if (reason) return { kind: 'invalid', reason };
  const name = merged.name.trim();
  const dup = db
    .select({ id: githubApps.id })
    .from(githubApps)
    .where(eq(githubApps.name, name))
    .get();
  if (dup && dup.id !== id) return { kind: 'duplicate-name' };
  db.update(githubApps)
    .set({
      name,
      appId: merged.appId.trim(),
      privateKey: merged.privateKey,
      webhookSecret: merged.webhookSecret?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(githubApps.id, id))
    .run();
  return { kind: 'updated', id };
}

export function deleteGithubApp(id: number): { kind: 'deleted' } | { kind: 'not-found' } {
  const existing = db
    .select({ id: githubApps.id })
    .from(githubApps)
    .where(eq(githubApps.id, id))
    .get();
  if (!existing) return { kind: 'not-found' };
  db.delete(githubApps).where(eq(githubApps.id, id)).run();
  return { kind: 'deleted' };
}

// 모든 App 설정의 인증용 raw 자격증명 (import 가 App 별로 installation 을 나열할 때 사용).
export type AppConfigForAuth = {
  appConfigId: number | null;
  name: string; // UI 그룹 헤더용. env App 은 'env'.
  appId: string;
  privateKey: string;
};

export function listAppConfigsForAuth(): AppConfigForAuth[] {
  const configs: AppConfigForAuth[] = db
    .select()
    .from(githubApps)
    .all()
    .map((r) => ({ appConfigId: r.id, name: r.name, appId: r.appId, privateKey: r.privateKey }));
  // env 단일 App 도 후보에 포함 (DB 에 없을 때 기존 동작 유지). appConfigId=null.
  try {
    configs.push({
      appConfigId: null,
      name: 'env',
      appId: env.githubAppId(),
      privateKey: env.githubAppPrivateKey(),
    });
  } catch {
    // env App 없음.
  }
  // 같은 appId 중복 제거 (DB·env 양쪽 등록 시).
  const seen = new Set<string>();
  return configs.filter((c) => {
    if (seen.has(c.appId)) return false;
    seen.add(c.appId);
    return true;
  });
}

// installation 토큰 발급을 시도할 App 후보 — 명시/매핑된 appConfigId 를 맨 앞에 두고
// 나머지 등록 App(+env)을 폴백으로 붙인다. getOctokitForInstallation 이 순차 시도해
// 그 installation 을 소유한 App 을 찾는다 (appConfigId 가 null/오설정이어도 자가 복구).
export function listAppCandidates(
  explicitAppConfigId: number | null | undefined,
): AppConfigForAuth[] {
  const all = listAppConfigsForAuth();
  if (explicitAppConfigId == null) return all;
  const explicit = all.filter((c) => c.appConfigId === explicitAppConfigId);
  const rest = all.filter((c) => c.appConfigId !== explicitAppConfigId);
  return [...explicit, ...rest];
}
