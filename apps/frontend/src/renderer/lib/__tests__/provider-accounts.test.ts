import { describe, expect, it } from 'vitest';
import type { ProviderAccount } from '../../../shared/types/provider-account';
import {
  getProviderModelLabels,
  getProviderThinkingOptions,
  normalizeThinkingLevelForProvider,
} from '../provider-accounts';

function createProviderAccount(
  provider: ProviderAccount['provider']
): ProviderAccount {
  return {
    id: `${provider}-account`,
    provider,
    name: `${provider} account`,
    authType: 'oauth',
    billingModel: 'subscription',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('provider-accounts thinking helpers', () => {
  it('exposes Extra High only for OpenAI Codex accounts', () => {
    const openAIOptions = getProviderThinkingOptions(createProviderAccount('openai'));
    const anthropicOptions = getProviderThinkingOptions(createProviderAccount('anthropic'));

    expect(openAIOptions.some((option) => option.value === 'xhigh')).toBe(true);
    expect(anthropicOptions.some((option) => option.value === 'xhigh')).toBe(false);
  });

  it('normalizes xhigh back to high for non-openai providers', () => {
    const anthropicAccount = createProviderAccount('anthropic');
    const openAIAccount = createProviderAccount('openai');

    expect(normalizeThinkingLevelForProvider('xhigh', anthropicAccount)).toBe('high');
    expect(normalizeThinkingLevelForProvider('xhigh', openAIAccount)).toBe('xhigh');
  });

  it('returns Kimi model labels for a Kimi provider account', () => {
    const kimiAccount = createProviderAccount('kimi');
    const labels = getProviderModelLabels(kimiAccount, []);
    expect(labels?.opus).toBe('Kimi K2.7');
    expect(labels?.sonnet).toBe('Kimi K2.6');
    expect(labels?.haiku).toBe('Kimi K2.5');
  });
});
