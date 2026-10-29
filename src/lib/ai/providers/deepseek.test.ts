import { afterEach, expect, it, vi } from 'vitest';
import { generateDeepseek } from './deepseek';
import { MAX_OUTPUT_TOKENS } from '../defaults';
const args = {
  apiKey: 'test-deepseek-key',
  model: 'deepseek-flash',
  systemPrompt: 'Answer the customer using supplied evidence.',
  messages: [{ role: 'user' as const, content: 'وش الفرق؟' }],
  timeoutMs: 1000,
};
afterEach(() => vi.unstubAllGlobals());
it.each(['deepseek-flash', 'deepseek-v4-pro'])(
  'normalizes %s text/usage and keeps reasoning out of customer replies',
  async (model) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content: 'المصمت يحجب الرؤية.',
                reasoning_content: 'Private reasoning',
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
        })
      );
    vi.stubGlobal('fetch', fetch);
    const reply = await generateDeepseek({ ...args, model });
    expect(reply).toEqual({
      text: 'المصمت يحجب الرؤية.',
      usage: { promptTokens: 10, completionTokens: 7, totalTokens: 17 },
    });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer test-deepseek-key');
    expect(JSON.parse(request.body)).toMatchObject({
      model,
      thinking: { type: 'disabled' },
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: args.systemPrompt },
        ...args.messages,
      ],
    });
  }
);
it('does not substitute reasoning for an empty answer', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({
          choices: [
            {
              message: { content: '', reasoning_content: 'Not customer text' },
            },
          ],
        })
      )
  );
  await expect(generateDeepseek(args)).rejects.toMatchObject({
    code: 'empty_response',
  });
});
it('uses the shared error contract for invalid credentials', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { message: 'Invalid API key' } },
          { status: 401 }
        )
      )
  );
  await expect(generateDeepseek(args)).rejects.toMatchObject({
    code: 'invalid_key',
    status: 401,
  });
});
