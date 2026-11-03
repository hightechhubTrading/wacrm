import { AiError, type ProviderResult } from '../types';
import { MAX_OUTPUT_TOKENS } from '../defaults';
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

interface GeminiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Call Google's Gemini models via their OpenAI-compatible chat
 * completions endpoint, using the caller's own key. Returns the raw
 * assistant text + token usage (handoff parsing happens in
 * `generateReply`).
 */
export async function generateGemini(
  args: ProviderArgs
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args;

  let res: Response;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        // Gemini 3 cannot disable thinking; 3.8 rejects "minimal".
        // Use supported minimum effort and leave headroom for a visible answer.
        max_tokens: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'].includes(
          model
        )
          ? 4096
          : MAX_OUTPUT_TOKENS,
        ...(['gemini-3.8-flash', 'gemini-3.5-flash-lite'].includes(model)
          ? {
              reasoning_effort:
                model === 'gemini-3.8-flash' ? 'low' : 'minimal',
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw toNetworkError(err);
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res);
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null;
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
    });
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  });
  return { text, usage };
}
