// 전역 단일 row 설정 — id=1 강제. 첫 호출 시 자동 insert (lazy init).
// AI off 토글이 즉시 sync.ts · clustering 흐름에 반영되도록 매 호출마다 DB 읽음.
// 단일 row 라 비용 무시 가능.

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { appSettings, type AppSettingsRow } from '@/db/schema';

const SETTINGS_ID = 1;

export function getSettings(): AppSettingsRow {
  const row = db.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ID)).get();
  if (row) return row;
  // lazy init — 첫 호출 시 default 값으로 row 생성.
  return db.insert(appSettings).values({ id: SETTINGS_ID, aiEnabled: true }).returning().get();
}

export function setAiEnabled(enabled: boolean): AppSettingsRow {
  // upsert — settings 행이 없으면 먼저 생성.
  getSettings();
  return db
    .update(appSettings)
    .set({ aiEnabled: enabled, updatedAt: new Date() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .returning()
    .get();
}

// Phase 16 — 위임 세션 worktree 격리 토글.
export function setAgentWorktreeEnabled(enabled: boolean): AppSettingsRow {
  getSettings();
  return db
    .update(appSettings)
    .set({ agentWorktreeEnabled: enabled, updatedAt: new Date() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .returning()
    .get();
}

// Headroom 통합 — headless 자동화 spawn 을 `headroom wrap claude` 로 감쌀지(토큰 절감).
// 기본 OFF — settings 토글로 켬. 미설치 머신은 켜도 fallback(원본 claude) + warning.
export function setHeadroomEnabled(enabled: boolean): AppSettingsRow {
  getSettings();
  return db
    .update(appSettings)
    .set({ headroomEnabled: enabled, updatedAt: new Date() })
    .where(eq(appSettings.id, SETTINGS_ID))
    .returning()
    .get();
}
