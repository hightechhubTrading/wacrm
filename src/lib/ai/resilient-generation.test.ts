import { beforeEach, expect, it, vi } from 'vitest';
import { generateResilientReply } from './resilient-generation';
import { AiError, type AiConfig, type GenerateResult } from './types';
import type { SalesEvidence } from './typesafe/sales';
const h = vi.hoisted(() => ({ generate: vi.fn(), select: vi.fn() }));
vi.mock('./generate', () => ({ generateReply: h.generate }));
vi.mock('./reply-fallback', () => ({ selectReplyFallback: h.select }));
const reply: GenerateResult = {
  text: 'Which area is the installation in?',
  handoff: false,
  mediaId: null,
  productTagId: null,
  fields: [],
  priority: null,
  priorityReason: null,
  usage: null,
  fallbackId: 'area',
};
const evidence: SalesEvidence = {
  behaviorV2Enabled: true,
  messages: [],
  knowledge: [],
  products: [],
  collectFields: [],
  businessContext: null,
};
const args = (key: string, enabled = true) => ({
  config: {
    provider: 'openai',
    model: 'configured',
    apiKey: key,
    behaviorV2Enabled: enabled,
  } as AiConfig,
  systemPrompt: 'instructions',
  messages: [],
});
beforeEach(() => {
  vi.resetAllMocks();
  h.select.mockResolvedValue(reply);
});
it('uses selected wording during an outage and stops hammering the same provider key', async () => {
  h.generate.mockRejectedValue(
    new AiError('quota exhausted', { code: 'rate_limited', status: 429 })
  );
  expect(
    await generateResilientReply(args('quota-test'), evidence)
  ).toMatchObject({ fallbackId: 'area', providerUnavailable: true });
  await generateResilientReply(args('quota-test'), evidence);
  expect(h.generate).toHaveBeenCalledTimes(1);
  expect(h.select).toHaveBeenCalledTimes(2);
});
it('does not silently approve a reply when no suitable candidate exists', async () => {
  h.generate.mockRejectedValue(new AiError('timeout', { code: 'timeout' }));
  h.select.mockResolvedValue(null);
  await expect(
    generateResilientReply(args('none-test'), evidence)
  ).rejects.toThrow('timeout');
});
it('keeps legacy accounts on the existing generation path', async () => {
  h.generate.mockRejectedValue(new Error('provider error'));
  await expect(
    generateResilientReply(args('legacy', false), evidence)
  ).rejects.toThrow('provider error');
  expect(h.select).not.toHaveBeenCalled();
});
