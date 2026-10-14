import {
  TypeSafeClient,
  type Questions,
  type SystemOneResult,
} from '@typesafe-ai/sdk';

export type JevMode = 'off' | 'shadow' | 'enforce';

export function jevMode(): JevMode {
  const mode = process.env.TYPESAFE_MODE;
  if (mode === 'off' || mode === 'shadow' || mode === 'enforce') return mode;
  return process.env.TYPESAFE_API_KEY?.trim() ? 'enforce' : 'off';
}

/** Server-side only. Never enable SDK debug logging (it includes request bodies). */
export async function askJev<Q extends Questions>(
  state: object,
  questions: Q
): Promise<SystemOneResult<Q>> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) throw new Error('TypeSafe key is not configured');
  const configured = Number(process.env.TYPESAFE_TIMEOUT_MS);
  const timeout =
    Number.isFinite(configured) && configured >= 250
      ? Math.min(configured, 10000)
      : 5000;
  const client = new TypeSafeClient({
    apiKey: key,
    baseURL: 'https://api.typesafe.ai',
    defaultModel: process.env.TYPESAFE_MODEL || 'jev-latest',
    logLevel: 'off',
    timeout,
    // No retry storm or unbounded backoff inside a webhook's after() lifetime.
    retry: { maxRetries: 0 },
  });
  return client.systemOne({
    state: JSON.parse(JSON.stringify(state)),
    questions,
  });
}

/** New review-derived checks are measured before they control sends. */
export function salesV2Mode(): JevMode {
  const mode = process.env.TYPESAFE_SALES_V2_MODE;
  return mode === 'enforce' || mode === 'off' ? mode : 'shadow';
}

/** Measure the new internal workflow independently of existing reply checks. */
export function salesAssistanceMode(): JevMode {
  const overall = jevMode();
  const mode = process.env.TYPESAFE_SALES_ASSISTANCE_MODE;
  if (overall === 'off' || mode === 'off') return 'off';
  if (overall === 'shadow') return 'shadow';
  return mode === 'enforce' ? 'enforce' : 'shadow';
}
