import { generateResilientReply } from '@/lib/ai/resilient-generation';
import { turnBrief } from '@/lib/ai/conversation-behavior';
import { listProductsForPrompt } from '@/lib/ai/media-library';
import { knowledgeQuery } from '@/lib/ai/query';
import { loadConversationMemory, memoryPrompt } from '@/lib/ai/memory';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { generateReply } from '@/lib/ai/generate';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { logAiUsage } from '@/lib/ai/usage';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { AiError } from '@/lib/ai/types';
import { assessSalesInput, verifySalesOutput } from '@/lib/ai/typesafe/sales';

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft } — a suggested reply for the agent to edit + send.
 *
 * Uses the account's configured provider/key (BYO). Read-only: it never
 * sends or stores anything, just hands text back to the composer.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent');

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft);
    if (!userLimit.success) return rateLimitResponse(userLimit);
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(
      `ai-draft-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const body = await request.json().catch(() => null);
    const conversationId =
      body && typeof body.conversation_id === 'string'
        ? body.conversation_id
        : '';
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      );
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr);
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 }
      );
    }
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      // Decrypt failure — surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err);
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      });
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'AI assistant is not set up. Enable it in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const messages = await buildConversationContext(supabase, conversationId);
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 }
      );
    }

    if (
      [...messages].reverse().find((m) => m.role === 'user')
        ?.attachmentState === 'unavailable'
    ) {
      throw new AiError('This attachment needs a team member to review.', {
        code: 'ai_human_review',
        status: 422,
      });
    }
    const jevContext = {
      accountId,
      conversationId,
      workflow: 'draft' as const,
    };
    const memory = await loadConversationMemory(
      supabase,
      accountId,
      conversationId,
      messages
    );
    const input = await assessSalesInput(
      jevContext,
      messages,
      memory,
      config.behaviorV2Enabled
    );
    if (input.handoff) {
      throw new AiError(
        'This request needs a team member to review and reply.',
        {
          code: 'ai_human_review',
          status: 422,
        }
      );
    }

    // Ground the draft in the account's knowledge base (best-effort —
    // returns [] when there's no KB or retrieval fails).
    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      knowledgeQuery(messages, config.behaviorV2Enabled)
    );

    const products = await listProductsForPrompt(supabase, accountId);
    const baseSystemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      companyFacts: config.companyFacts,
      behaviorV2Enabled: config.behaviorV2Enabled,
      mode: 'draft',
      knowledge,
      media: products,
    });

    const groundedSystemPrompt = `${baseSystemPrompt}\n\n${memoryPrompt(memory)}`;
    const systemPrompt = input.guidance
      ? `${groundedSystemPrompt}\n\nSales communication guidance:\n${input.guidance}`
      : groundedSystemPrompt;
    const salesEvidence: import('@/lib/ai/typesafe/sales').SalesEvidence = {
      intent: input.intent,
      messages,
      knowledge,
      products,
      collectFields: [],
      businessContext: config.behaviorV2Enabled
        ? (config.companyFacts ?? null)
        : (config.companyFacts ?? config.systemPrompt),
      behaviorV2Enabled: config.behaviorV2Enabled,
      memory,
      emotion: input.emotion,
    };
    const generated = await generateResilientReply(
      {
        config,
        systemPrompt:
          systemPrompt +
          (config.behaviorV2Enabled ? '\n' + turnBrief(messages) : ''),
        messages,
      },
      salesEvidence
    );
    const { usage } = generated;

    // Record spend on the account's BYO key. Best-effort + via the
    // service role (the log has no `authenticated` INSERT policy). This
    // must not fail or delay the draft the agent is waiting on, so:
    //  - the whole thing is wrapped (constructing the admin client throws
    //    if the service-role key is unset — that must not 500 the draft);
    //  - it's fire-and-forget (`void`), not awaited, so the response
    //    isn't held for a DB round-trip.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      });
    } catch (logErr) {
      console.error('[ai/draft] usage log skipped:', logErr);
    }

    const verified = await verifySalesOutput(
      jevContext,
      salesEvidence,
      generated,
      generated.providerUnavailable
        ? undefined
        : async (guidance) => {
            const revised = await generateReply({
              config,
              systemPrompt: `${systemPrompt}\n\nReply recovery:\n${guidance}`,
              messages,
            });
            try {
              void logAiUsage(supabaseAdmin(), {
                accountId,
                conversationId,
                mode: 'draft',
                provider: config.provider,
                model: config.model,
                usage: revised.usage,
              });
            } catch {
              // Usage accounting must not prevent a verified draft.
            }
            return revised;
          }
    );
    if (verified.handoff) {
      throw new AiError(
        'The suggested reply needs human review. Please write a reply using confirmed business details.',
        {
          code: 'ai_human_review',
          status: 422,
        }
      );
    }
    if (verified.reviewRequired)
      return NextResponse.json(
        {
          error: 'The draft needs review before sending.',
          code: 'reply_needs_review',
        },
        { status: 503 }
      );
    return NextResponse.json({ draft: verified.text });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return toErrorResponse(err);
  }
}
