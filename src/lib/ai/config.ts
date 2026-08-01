import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig, AiProvider } from './types'

interface AiConfigRow {
  provider: AiProvider
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  last_key_error: string | null
  last_key_error_at: string | null
  transcribe_voice_messages: boolean
  after_hours_takeover_enabled: boolean
  image_analysis_provider: 'openai' | 'gemini' | null
  image_analysis_api_key: string | null
  image_analysis_enabled: boolean
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, last_key_error, last_key_error_at, transcribe_voice_messages, after_hours_takeover_enabled, image_analysis_provider, image_analysis_api_key, image_analysis_enabled'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  // Same reasoning as the embeddings key: a corrupt/undecryptable
  // image-analysis key should disable that feature, not take down
  // draft/auto-reply.
  let imageAnalysisApiKey: string | null = null
  if (row.image_analysis_api_key) {
    try {
      imageAnalysisApiKey = decrypt(row.image_analysis_api_key)
    } catch {
      console.error(
        `[ai config] image-analysis key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; image analysis is disabled until it is re-entered.`,
      )
      imageAnalysisApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    lastKeyError: row.last_key_error,
    lastKeyErrorAt: row.last_key_error_at,
    transcribeVoiceMessages: row.transcribe_voice_messages,
    afterHoursTakeoverEnabled: row.after_hours_takeover_enabled,
    imageAnalysisProvider: row.image_analysis_provider,
    imageAnalysisApiKey,
    imageAnalysisEnabled: row.image_analysis_enabled,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}

/**
 * Load + decrypt just the image-analysis key/provider, independent of
 * `is_active` — mirrors `loadEmbeddingsKey`. Used by the webhook so a
 * photo gets described whenever the feature is configured, even if the
 * assistant's master switch is currently off.
 */
export async function loadImageAnalysisKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ provider: 'openai' | 'gemini' | null; key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('image_analysis_provider, image_analysis_api_key, image_analysis_enabled')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.image_analysis_enabled || !data.image_analysis_api_key) {
    return { provider: null, key: null, corrupt: false }
  }
  try {
    return {
      provider: data.image_analysis_provider,
      key: decrypt(data.image_analysis_api_key),
      corrupt: false,
    }
  } catch {
    console.error(
      `[ai config] image-analysis key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { provider: null, key: null, corrupt: true }
  }
}
