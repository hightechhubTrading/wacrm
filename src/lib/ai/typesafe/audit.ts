import type { SupabaseClient } from '@supabase/supabase-js';
import { QUESTION_VERSION } from './policy';
import type { JevMode } from './client';

export interface JevAuditContext {
  accountId: string;
  conversationId?: string | null;
  triggerMessageId?: string | null;
  workflow: 'auto_reply' | 'draft' | 'playground' | 'assistance';
  db?: SupabaseClient;
  snapshot?: { messageIds: string[]; configurationHash: string };
}

export async function logJevCheck(
  ctx: JevAuditContext,
  check: {
    mode: JevMode;
    layer: 'input' | 'output';
    outcome: 'allow' | 'handoff' | 'filtered' | 'unavailable';
    model?: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    judgments?: object;
  }
): Promise<void> {
  const record = {
    account_id: ctx.accountId,
    conversation_id: ctx.conversationId ?? null,
    trigger_message_id: ctx.triggerMessageId ?? null,
    workflow: ctx.workflow,
    question_version: QUESTION_VERSION,
    mode: check.mode,
    layer: check.layer,
    outcome: check.outcome,
    model: check.model ?? null,
    latency_ms: check.latencyMs,
    input_tokens: check.inputTokens ?? null,
    output_tokens: check.outputTokens ?? null,
    judgments: {
      ...(check.judgments ?? {}),
      ...(ctx.snapshot ? { inputSnapshot: ctx.snapshot } : {}),
    },
  };
  // No messages, generated text, field values, provider keys or error bodies.
  // Structured logs remain available before migration 068 has been applied.
  console.info('[jev check]', record);
  if (!ctx.db) return;
  try {
    const { error } = await ctx.db.from('ai_judgment_log').insert(record);
    if (error) console.warn('[jev check] audit storage unavailable');
  } catch {
    console.warn('[jev check] audit storage unavailable');
  }
}
