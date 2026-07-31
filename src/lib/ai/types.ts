// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'deepseek'

/**
   * Account AI setup, decrypted and ready to use. Produced by
   * `loadAiConfig` -- `apiKey` is the plaintext BYO provider key
   * (stored AES-256-GCM-encrypted at rest).
   */
export interface AiConfig {
    provider: AiProvider
    model: string
    apiKey: string
    systemPrompt: string | null
    isActive: boolean
    autoReplyEnabled: boolean
    autoReplyMaxPerConversation: number
    /** Where auto-reply hands a conversation off when the model bails: an
     * agent's `auth.users.id`, or null to leave it unassigned (drop into
     * the shared queue). */
  handoffAgentId: string | null
    /** Optional OpenAI-compatible key for embeddings. When set, the
     * knowledge base is embedded and semantic retrieval turns on; when
     * null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Set when the last call with this key failed with AiError.code ===
   * 'invalid_key'; cleared on the next successful call or a successful
   * "Test key". Lets auto-reply distinguish a fresh failure (worth a
   * notification) from a already-known one. */
  lastKeyError: string | null
  lastKeyErrorAt: string | null
  /** Transcribe inbound WhatsApp voice notes with Whisper (requires
   * `embeddingsApiKey` — Whisper is OpenAI-only, same key that powers
   * knowledge-base embeddings). */
  transcribeVoiceMessages: boolean
  /** When true, auto-reply keeps replying outside the account's
   * business hours even if a human agent is assigned (who's
   * presumably offline too) — see src/lib/ai/business-hours.ts. Still
   * respects a prior explicit handoff. */
  afterHoursTakeoverEnabled: boolean
  /** Separate, optional credential for describing inbound photos
   * (migration 054) — mirrors `embeddingsApiKey`'s independence from
   * the main provider. Only 'openai'/'gemini' are offered (no
   * Anthropic vision request-building here, no DeepSeek vision model). */
  imageAnalysisProvider: 'openai' | 'gemini' | null
  imageAnalysisApiKey: string | null
  imageAnalysisEnabled: boolean
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
    text: string
    usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
    /** The reply text, with any handoff/media sentinel stripped. */
  text: string
    /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
    /** Media-library item id the model chose to attach, or null when it
     * didn't attach anything (auto-reply mode only -- see MEDIA_SENTINEL_*
     * in defaults.ts). */
  mediaId: string | null
  /** Media-library item id whose linked product tag should be applied
   * to the contact, or null (auto-reply mode only -- see
   * PRODUCT_TAG_SENTINEL_* in defaults.ts). Independent of `mediaId`. */
  productTagId: string | null
  /** Field name/value pairs the model chose to record from the
   * conversation (auto-reply mode only -- see FIELD_SENTINEL_* in
   * defaults.ts), matched to the account's AI-collectible custom
   * fields and applied by the auto-reply dispatcher. Empty when none
   * were emitted this turn. */
  fields: { name: string; value: string }[]
  /** Priority level the model assessed this turn (auto-reply mode
   * only — see PRIORITY_SENTINEL_* in defaults.ts), or null when no
   * marker was emitted (draft mode, or a malformed/missing marker). */
  priority: string | null
  /** Short human-readable reason paired with `priority`, or null. */
  priorityReason: string | null
    /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
    readonly code: string
    readonly status: number
    constructor(message: string, opts: { code?: string; status?: number } = {}) {
          super(message)
          this.name = 'AiError'
          this.code = opts.code ?? 'ai_error'
          this.status = opts.status ?? 502
    }
}
