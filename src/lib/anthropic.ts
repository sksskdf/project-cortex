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

// 현재 사용 모델 — 비용·속도 균형 (Phase 4 검토 결과는 ROADMAP Decision Log에 박제).
export const PRE_REVIEW_MODEL = 'claude-sonnet-4-6';
