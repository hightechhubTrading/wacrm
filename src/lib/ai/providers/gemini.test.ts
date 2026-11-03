import { afterEach, expect, it, vi } from 'vitest';
import { generateGemini } from './gemini';
const args = {
  apiKey: 'test',
  systemPrompt: 'Help the customer.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  timeoutMs: 1000,
};
afterEach(() => vi.unstubAllGlobals());
it.each([
  ['gemini-3.8-flash', 'low', 4096],
  ['gemini-3.5-flash-lite', 'minimal', 4096],
  ['custom-model', undefined, 1024],
])(
  'keeps reasoning within the supported settings and answer budget for %s',
  async (model, effort, budget) => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          { message: { content: 'Hello!', reasoning_content: 'private' } },
        ],
      })
    );
    vi.stubGlobal('fetch', fetch);
    const result = await generateGemini({ ...args, model: model as string });
    expect(result.text).toBe('Hello!');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(budget);
    expect(body.reasoning_effort).toBe(effort);
  }
);
it('does not substitute reasoning for an empty visible answer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: '', reasoning_content: 'private' } }],
      })
    )
  );
  await expect(
    generateGemini({ ...args, model: 'gemini-3.8-flash' })
  ).rejects.toMatchObject({ code: 'empty_response' });
});
