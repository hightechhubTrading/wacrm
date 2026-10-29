import { createHash } from 'node:crypto';
import { generateReply, type GenerateArgs } from './generate';
import { selectReplyFallback } from './reply-fallback';
import { AiError, type GenerateResult } from './types';
import type { SalesEvidence } from './typesafe/sales';
const unavailable = new Map<string, { until: number; code: string }>();
/** A short circuit avoids hammering a depleted/rate-limited provider. Selected text is still unverified. */
export async function generateResilientReply(
  args: GenerateArgs,
  evidence: SalesEvidence
): Promise<GenerateResult> {
  if (!args.config.behaviorV2Enabled) return generateReply(args);
  const key = createHash('sha256')
    .update(
      args.config.provider +
        '\0' +
        args.config.model +
        '\0' +
        args.config.apiKey
    )
    .digest('hex');
  const circuit = unavailable.get(key);
  try {
    if (circuit && circuit.until > Date.now())
      throw new AiError('Reply provider temporarily unavailable', {
        code: circuit.code,
        status: 503,
      });
    const result = await generateReply(args);
    unavailable.delete(key);
    return result;
  } catch (error) {
    const e = error as { code?: string };
    if (['rate_limited', 'invalid_key', 'timeout'].includes(e.code ?? '')) {
      if (unavailable.size > 1000) unavailable.clear();
      unavailable.set(key, { until: Date.now() + 60000, code: e.code! });
    }
    const fallback = await selectReplyFallback(evidence);
    if (!fallback) throw error;
    return { ...fallback, providerUnavailable: true };
  }
}
