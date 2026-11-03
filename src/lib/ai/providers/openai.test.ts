import { afterEach, expect, it, vi } from 'vitest';
import { generateOpenAi } from './openai';
const args = {
  apiKey: 'test',
  systemPrompt: 'Help the customer.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
  timeoutMs: 1000,
};
afterEach(() => vi.unstubAllGlobals());
it.each([
  ['gpt-6.1-terra', 'none', 1024],
  ['gpt-6-luna', 'none', 1024],
  ['gpt-6.1-sol', 'low', 4096],
  ['gpt-5.4', undefined, 1024],
  ['custom-model', undefined, 1024],
])(
  'uses supported reasoning/budget for %s without exposing private reasoning',
  async (model, effort, budget) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            { message: { content: 'Hello!', reasoning_content: 'private' } },
          ],
        })
      );
    vi.stubGlobal('fetch', fetch);
    const result = await generateOpenAi({ ...args, model: model as string });
    expect(result.text).toBe('Hello!');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.max_completion_tokens).toBe(budget);
    expect(body.reasoning_effort).toBe(effort);
  }
);
it('does not send reasoning as an answer when the visible answer is empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [{ message: { content: '', reasoning_content: 'private' } }],
        })
      )
  );
  await expect(
    generateOpenAi({ ...args, model: 'gpt-6.1-sol' })
  ).rejects.toMatchObject({ code: 'empty_response' });
});
