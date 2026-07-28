import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/translate  (agent+)
 *
 * Body: { text, target_language }
 * Returns: { translation }
 *
 * A one-off, non-conversational call — bypasses buildSystemPrompt's
 * CRM-reply boilerplate (handoff/field-collection sentinels, pricing
 * rules) entirely, since generateReply only needs a plain systemPrompt
 * + messages. Works whenever *any* provider key is configured
 * (`requireActive: false`, same escape hatch the Playground uses) —
 * translation is a utility distinct from the auto-reply "AI enabled"
 * toggle, so an account can use it without turning auto-reply on.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-translate:${userId}`, RATE_LIMITS.aiTranslate)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const accountLimit = checkRateLimit(
      `ai-translate-acct:${accountId}`,
      RATE_LIMITS.aiTranslateAccount,
    )
    if (!accountLimit.success) return rateLimitResponse(accountLimit)

    const body = await request.json().catch(() => null)
    const text = body && typeof body.text === 'string' ? body.text.trim() : ''
    const targetLanguage =
      body && typeof body.target_language === 'string' ? body.target_language.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (!targetLanguage) {
      return NextResponse.json({ error: 'target_language is required' }, { status: 400 })
    }

    const config = await loadAiConfig(supabase, accountId, { requireActive: false }).catch(
      (err) => {
        console.error('[ai/translate] loadAiConfig error:', err)
        throw new AiError('Stored API key could not be decrypted.', {
          code: 'key_decrypt_failed',
          status: 400,
        })
      },
    )
    if (!config) {
      return NextResponse.json(
        {
          error: 'AI is not set up. Add a provider key in Settings → AI Assistant.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const systemPrompt = `Translate the user's message to ${targetLanguage}. Output ONLY the translation, with no explanation, quotes, or preamble.`
    const { text: translation, usage } = await generateReply({
      config,
      systemPrompt,
      messages: [{ role: 'user', content: text }],
    })

    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId: null,
        mode: 'translate',
        provider: config.provider,
        model: config.model,
        usage,
      })
    } catch (logErr) {
      console.error('[ai/translate] usage log skipped:', logErr)
    }

    return NextResponse.json({ translation })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
