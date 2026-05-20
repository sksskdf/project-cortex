import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

// Anthropic 클라이언트 lazy + 메모이즈. 테스트 주입은 setAnthropic.
let _client: Anthropic | null = null;

export function setAnthropic(instance: Anthropic | null) {
  _client = instance;
}

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: env.anthropicApiKey() });
  return _client;
}

// claude-api 스킬 mandate — Opus 4.7 디폴트. 비용 검토는 ROADMAP Decision Log.
export const PRE_REVIEW_MODEL = 'claude-opus-4-7';

// Phase 4.5b — Haiku 1차 분류용. Opus 대비 토큰 가격 약 1/4 + 빠름.
// 단순한 PR (위험 플래그 없음 + 자신감 높음) 은 이 모델 응답으로 종료.
export const PRE_REVIEW_TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
