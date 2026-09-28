# CTWA Lead Quality → Meta Conversions API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the Click-to-WhatsApp ad click ID on inbound messages, let staff tag conversations Qualified / Site visit / Won, and deliver each tag to Meta's Conversions API for Business Messaging through an outbox, with an in-app per-ad report.

**Architecture:** The Cloud API webhook stores a `ctwa_attributions` row per ad click and denormalizes the latest ad onto `conversations`. All tags funnel into one SQL function `enqueue_conversion()` that writes an idempotent `conversion_events` outbox row; Won is enqueued by a trigger on `deals` so every "mark won" path counts. An in-process poller (plus an immediate kick after tagging) claims due rows atomically and POSTs them to Meta with retry/backoff.

**Tech Stack:** Next.js 16 (App Router, `after()` from `next/server`), Supabase Postgres + RLS, supabase-js, Vitest, next-intl (en + ar), shadcn-style components on `@base-ui/react`, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-28-ctwa-conversions-design.md`

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before using a Next.js API you haven't used in this repo (AGENTS.md).
- `ctwa_clid` is never logged, never returned to the browser, never rendered.
- Meta payload fields exactly: `event_name`, `event_time` (unix seconds of tag time), `event_id`, `action_source: "business_messaging"`, `messaging_channel: "whatsapp"`, `user_data.whatsapp_business_account_id`, `user_data.ctwa_clid` (unhashed); `custom_data: { currency: "QAR", value }` on Purchase only; `test_event_code` only when `META_TEST_EVENT_CODE` is set.
- Stage → event: `qualified`→`QualifiedLead`, `site_visit`→`LeadSubmitted`, `won`→`Purchase`.
- `event_id` = `{conversation_id}:{stage}`, unique. A `sent` row is never re-sent.
- Max 5 attempts; backoff after attempt n: 1m, 5m, 30m, 2h, 12h.
- Nothing is sent unless `META_CAPI_ENABLED=true` and `META_DATASET_ID`, `META_WABA_ID`, `META_CAPI_ACCESS_TOKEN`, `GRAPH_API_VERSION` are all set.
- Tagging: agent and above. Report page: admin and above. Viewers cannot tag.
- Won value is required and > 0 (inbox Won dialog and pipeline "Mark won").
- Every new UI string goes in both `messages/en.json` and `messages/ar.json` (parity test enforces it).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push unless the user asks.

## Deviations from the spec (decided while planning)

- Instead of a `conversation_ad_sources` view, the webhook denormalizes the latest ad onto `conversations` (`ad_source_id`, `ad_headline`, `ad_clicked_at`). The inbox already loads `conversations.*`, so the badge needs no extra query or view relationship. `ctwa_attributions` has RLS enabled with **no** client policies (service role only).
- Inbox Won on a conversation with no linked deal returns 409 ("create one in Pipelines first") instead of auto-creating a deal. Migration 041 already creates a deal for every new conversation, so this is rare.
- `conversion_events` gains `last_attempt_at` (for the failed-sends table).
- A tag that is undone **before** it is sent is not sent (claim skips `undone_at IS NOT NULL`); re-tagging clears `undone_at` and it sends.

## Review Focus

1. **Meta redelivers the same ad message** (slow ack) → still exactly one attribution row. Pinned in Task 2 (upsert with `ignoreDuplicates` on `conversation_id,message_id`) and by the webhook's existing duplicate-message guard running first.
2. **Won tagged in the inbox on a deal that is already won** (e.g. marked won in Pipelines earlier) → no second Purchase; the tag just shows as won. Pinned in Task 1 SQL check #3 and Task 4 test "won on an already-won deal still returns ok and enqueues idempotently".
3. **Agent tags a conversation they can't see** (not assigned to them) → 404, nothing enqueued. Pinned in Task 4 tests for POST and DELETE.
4. **Value typed as text, `"abc"`, `0`, negative, or missing on Won** → 400, deal untouched. Pinned in Task 4.
5. **Flag on but token/dataset missing, or Meta unreachable/timeout** → rows stay `pending` (config missing) or become `failed` with the error and a scheduled retry (network). Pinned in Task 3 (`readCapiConfig` returns null; fetch rejection → failed).

---

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/065_ctwa_conversions.sql` (create) | Tables, conversation ad columns, RLS, `enqueue_conversion`, deals Won trigger, `claim_conversion_events` |
| `src/lib/conversions/stages.ts` (create) | Client-safe stage constants/types, row type |
| `src/lib/conversions/attribution.ts` (+test) (create) | Detect ad referral, store attribution, denormalize onto conversation |
| `src/lib/conversions/meta-capi.ts` (+test) (create) | Env config, payload builder, HTTP POST to Meta |
| `src/lib/conversions/sender.ts` (+test) (create) | Claim → send → mark sent/failed with backoff |
| `src/lib/conversions/poller.ts` (create) | Single-flight kick + 60 s interval |
| `src/lib/conversions/report.ts` (+test) (create) | Pure per-ad aggregation + CSV |
| `src/app/api/whatsapp/webhook/route.ts` (modify) | `referral` type + call `recordCtwaAttribution` |
| `src/instrumentation.ts` (modify) | Start poller |
| `src/app/api/conversions/route.ts` (+test) (create) | POST tag |
| `src/app/api/conversions/[id]/route.ts` (+test) (create) | DELETE = undo |
| `src/app/api/conversions/report/route.ts` (+test) (create) | GET report + failed sends |
| `src/types/index.ts` (modify) | `Conversation` ad fields |
| `src/components/inbox/conversion-stages.tsx` (create) | Badge + stage chips + dialogs |
| `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx` (modify) | Wire badge/chips |
| `src/components/pipelines/deal-form.tsx` (modify) | Won requires value > 0 |
| `src/app/(dashboard)/ad-conversions/page.tsx`, `src/components/conversions/ad-conversions-report.tsx` (create), `src/components/layout/sidebar.tsx` (modify) | Report page + nav |
| `messages/en.json`, `messages/ar.json` | Strings |
| `.env.local.example`, `.env.production.example`, `docker-compose.yml` | New env vars |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/065_ctwa_conversions.sql`

**Interfaces:**
- Produces (SQL): tables `ctwa_attributions`, `conversion_events`; columns `conversations.ad_source_id TEXT`, `ad_headline TEXT`, `ad_clicked_at TIMESTAMPTZ`; `enqueue_conversion(p_conversation_id uuid, p_stage text, p_value numeric, p_currency text, p_deal_id uuid, p_user_id uuid) returns void`; `claim_conversion_events(p_limit int) returns setof conversion_events`; trigger `deals_enqueue_won`.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- 065_ctwa_conversions.sql
--
-- Click-to-WhatsApp lead quality → Meta Conversions API for Business
-- Messaging. See docs/superpowers/specs/2026-09-28-ctwa-conversions-design.md.
--
-- 1. ctwa_attributions -- one row per ad click captured by the Cloud API
--    webhook (messages[].referral). Holds ctwa_clid, a personal
--    identifier: RLS on with NO client policies -> service role only.
-- 2. conversations.ad_* -- latest ad for the conversation, denormalized
--    so the inbox can badge ad-sourced chats without touching clids.
-- 3. conversion_events -- outbox, one row per (conversation, stage).
--    event_id is unique; Meta does not dedupe business-messaging events,
--    so this row is the only double-count protection.
-- 4. enqueue_conversion() -- single write path for tags.
-- 5. deals_enqueue_won -- a deal becoming won (from ANY path: inbox,
--    pipeline board, public API) enqueues Purchase (+ QualifiedLead).
-- 6. claim_conversion_events() -- atomic claim for the sender.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ad_source_id TEXT,
  ADD COLUMN IF NOT EXISTS ad_headline TEXT,
  ADD COLUMN IF NOT EXISTS ad_clicked_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ctwa_attributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_wa_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  ctwa_clid TEXT NOT NULL,
  ad_id TEXT,
  headline TEXT,
  source_url TEXT,
  raw_referral JSONB NOT NULL,
  clicked_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ctwa_attributions_conversation_message_key UNIQUE (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ctwa_attributions_conversation_clicked
  ON ctwa_attributions (conversation_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ctwa_attributions_account_clicked
  ON ctwa_attributions (account_id, clicked_at);

ALTER TABLE ctwa_attributions ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: only the service role reads/writes clids.

CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  attribution_id UUID REFERENCES ctwa_attributions(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('qualified', 'site_visit', 'won')),
  meta_event_name TEXT NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  value NUMERIC(12,2),
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped_no_clid')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  meta_response JSONB,
  tagged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tagged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  undone_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversion_events_due
  ON conversion_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_conversion_events_conversation
  ON conversion_events (conversation_id);

ALTER TABLE conversion_events ENABLE ROW LEVEL SECURITY;
-- Read-only for members who can see the conversation (the EXISTS runs
-- under the caller's conversations RLS, so an agent only sees events on
-- conversations assigned to them -- migration 037). No write policies:
-- writes go through enqueue_conversion() / service-role routes.
DROP POLICY IF EXISTS conversion_events_select ON conversion_events;
CREATE POLICY conversion_events_select ON conversion_events FOR SELECT USING (
  is_account_member(account_id)
  AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversion_events.conversation_id)
);

CREATE OR REPLACE FUNCTION public.enqueue_conversion(
  p_conversation_id UUID,
  p_stage TEXT,
  p_value NUMERIC,
  p_currency TEXT,
  p_deal_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_attribution_id UUID;
BEGIN
  IF p_stage NOT IN ('qualified', 'site_visit', 'won') THEN
    RAISE EXCEPTION 'invalid conversion stage: %', p_stage;
  END IF;

  SELECT account_id INTO v_account_id FROM conversations WHERE id = p_conversation_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  -- Won implies Qualified (stages need not be sequential).
  IF p_stage = 'won' THEN
    PERFORM public.enqueue_conversion(p_conversation_id, 'qualified', NULL, NULL, NULL, p_user_id);
  END IF;

  SELECT id INTO v_attribution_id
  FROM ctwa_attributions
  WHERE conversation_id = p_conversation_id
  ORDER BY clicked_at DESC
  LIMIT 1;

  INSERT INTO conversion_events (
    account_id, conversation_id, attribution_id, deal_id, stage, meta_event_name,
    event_id, value, currency, status, tagged_by, tagged_at
  ) VALUES (
    v_account_id,
    p_conversation_id,
    v_attribution_id,
    p_deal_id,
    p_stage,
    CASE p_stage
      WHEN 'qualified' THEN 'QualifiedLead'
      WHEN 'site_visit' THEN 'LeadSubmitted'
      ELSE 'Purchase'
    END,
    p_conversation_id::TEXT || ':' || p_stage,
    CASE WHEN p_stage = 'won' THEN p_value END,
    CASE WHEN p_stage = 'won' THEN COALESCE(p_currency, 'QAR') END,
    CASE WHEN v_attribution_id IS NULL THEN 'skipped_no_clid' ELSE 'pending' END,
    p_user_id,
    NOW()
  )
  -- Re-tagging after an undo restores the tag; it never re-sends.
  ON CONFLICT (event_id) DO UPDATE SET undone_at = NULL;
END;
$$;

ALTER FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_conversion(UUID, TEXT, NUMERIC, TEXT, UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_won_conversion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id UUID;
BEGIN
  IF NEW.status IS DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'won' THEN
    RETURN NEW;
  END IF;

  v_conversation_id := NEW.conversation_id;
  IF v_conversation_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE contact_id = NEW.contact_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  IF v_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM public.enqueue_conversion(
    v_conversation_id, 'won', NEW.value, NEW.currency, NEW.id, auth.uid()
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to enqueue Won conversion for deal %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enqueue_won_conversion() OWNER TO postgres;

DROP TRIGGER IF EXISTS deals_enqueue_won ON deals;
CREATE TRIGGER deals_enqueue_won
AFTER INSERT OR UPDATE OF status ON deals
FOR EACH ROW EXECUTE FUNCTION public.enqueue_won_conversion();

CREATE OR REPLACE FUNCTION public.claim_conversion_events(p_limit INTEGER)
RETURNS SETOF conversion_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A row left in 'sending' past its lease (process crashed mid-send)
  -- with no attempts left becomes 'failed' so an admin sees it.
  UPDATE conversion_events
  SET status = 'failed', last_error = COALESCE(last_error, 'Interrupted while sending')
  WHERE status = 'sending' AND next_attempt_at <= NOW() AND attempts >= 5;

  -- Claiming sets a 10-minute lease via next_attempt_at, so a crashed
  -- 'sending' row becomes claimable again once the lease expires.
  RETURN QUERY
  UPDATE conversion_events
  SET status = 'sending',
      attempts = attempts + 1,
      last_attempt_at = NOW(),
      next_attempt_at = NOW() + INTERVAL '10 minutes'
  WHERE id IN (
    SELECT id FROM conversion_events
    WHERE status IN ('pending', 'failed', 'sending')
      AND next_attempt_at <= NOW()
      AND attempts < 5
      AND undone_at IS NULL
    ORDER BY next_attempt_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

ALTER FUNCTION public.claim_conversion_events(INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_conversion_events(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversion_events(INTEGER) TO service_role;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP: `list_projects` to find the HTH project, then `apply_migration` with name `065_ctwa_conversions` and the SQL above. Expected: success, no errors.

- [ ] **Step 3: Verify behavior with rolled-back SQL checks**

Run via `execute_sql` (the final `RAISE EXCEPTION` rolls everything back and reports the result). Pick a real conversation that has a deal:

```sql
DO $$
DECLARE
  v_conv UUID; v_deal UUID; v_count INT; v_status TEXT; v_names TEXT;
BEGIN
  SELECT d.conversation_id, d.id INTO v_conv, v_deal
  FROM deals d WHERE d.conversation_id IS NOT NULL AND d.status <> 'won' LIMIT 1;

  -- 1: organic tag -> skipped_no_clid
  PERFORM enqueue_conversion(v_conv, 'site_visit', NULL, NULL, NULL, NULL);
  SELECT status INTO v_status FROM conversion_events WHERE event_id = v_conv || ':site_visit';
  IF v_status <> 'skipped_no_clid' THEN RAISE EXCEPTION 'check1 failed: %', v_status; END IF;

  -- 2: attribution present + deal won via trigger -> qualified + won pending
  DELETE FROM conversion_events WHERE conversation_id = v_conv;
  INSERT INTO ctwa_attributions (account_id, conversation_id, contact_wa_id, message_id, ctwa_clid, ad_id, raw_referral, clicked_at)
  SELECT account_id, id, '97400000000', 'wamid.TEST', 'CLID_TEST', 'AD1', '{}'::jsonb, NOW() FROM conversations WHERE id = v_conv;
  UPDATE deals SET value = 1000, status = 'won' WHERE id = v_deal;
  SELECT count(*), string_agg(meta_event_name || '/' || status, ',' ORDER BY stage)
    INTO v_count, v_names FROM conversion_events WHERE conversation_id = v_conv;
  IF v_count <> 2 THEN RAISE EXCEPTION 'check2 failed: % %', v_count, v_names; END IF;

  -- 3: re-enqueue won + reopen/re-win -> still 2 rows
  PERFORM enqueue_conversion(v_conv, 'won', 1000, 'QAR', v_deal, NULL);
  UPDATE deals SET status = 'open' WHERE id = v_deal;
  UPDATE deals SET status = 'won' WHERE id = v_deal;
  SELECT count(*) INTO v_count FROM conversion_events WHERE conversation_id = v_conv;
  IF v_count <> 2 THEN RAISE EXCEPTION 'check3 failed: %', v_count; END IF;

  -- 4: claim returns both, marks sending, attempts=1
  SELECT count(*) INTO v_count FROM claim_conversion_events(10) WHERE conversation_id = v_conv;
  IF v_count <> 2 THEN RAISE EXCEPTION 'check4 failed: %', v_count; END IF;
  SELECT count(*) INTO v_count FROM claim_conversion_events(10) WHERE conversation_id = v_conv;
  IF v_count <> 0 THEN RAISE EXCEPTION 'check5 failed (double claim): %', v_count; END IF;

  RAISE EXCEPTION 'ALL CHECKS PASSED: %', v_names;
END $$;
```

Expected: error text `ALL CHECKS PASSED: QualifiedLead/pending,Purchase/pending` (the exception is the rollback). Any `checkN failed` → fix the migration, re-apply, re-run.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/065_ctwa_conversions.sql
git commit -m "Add CTWA attribution + conversion outbox schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Capture the ad click in the webhook

**Files:**
- Create: `src/lib/conversions/stages.ts`
- Create: `src/lib/conversions/attribution.ts`
- Test: `src/lib/conversions/attribution.test.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts` (the `WhatsAppMessage` interface ~line 43, and `processMessage()` right after the duplicate-message guard ~line 628)

**Interfaces:**
- Produces: `WhatsAppReferral` type; `isAdReferral(r): r is WhatsAppReferral & { ctwa_clid: string }`; `recordCtwaAttribution(db: SupabaseClient, input: RecordAttributionInput): Promise<boolean>`; from `stages.ts`: `CONVERSION_STAGES`, `ConversionStage`, `ConversionStatus`, `isConversionStage`, `ConversionEventRow`.

- [ ] **Step 1: Create `stages.ts`** (no test needed — constants/types only)

```ts
// Client-safe constants/types for CTWA conversion tagging. No server
// imports here: the inbox UI and the report page import this module.

export const CONVERSION_STAGES = ['qualified', 'site_visit', 'won'] as const
export type ConversionStage = (typeof CONVERSION_STAGES)[number]

export type ConversionStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped_no_clid'

export function isConversionStage(value: unknown): value is ConversionStage {
  return typeof value === 'string' && (CONVERSION_STAGES as readonly string[]).includes(value)
}

/** A `conversion_events` row as returned by PostgREST. */
export interface ConversionEventRow {
  id: string
  account_id: string
  conversation_id: string
  attribution_id: string | null
  deal_id: string | null
  stage: ConversionStage
  meta_event_name: string
  event_id: string
  value: number | string | null
  currency: string | null
  status: ConversionStatus
  attempts: number
  next_attempt_at: string
  last_attempt_at: string | null
  last_error: string | null
  meta_response: Record<string, unknown> | null
  tagged_by: string | null
  tagged_at: string
  sent_at: string | null
  undone_at: string | null
}
```

- [ ] **Step 2: Write the failing test** `src/lib/conversions/attribution.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAdReferral, recordCtwaAttribution } from './attribution'

type Call = { table: string; op: string; payload?: unknown; args: unknown[] }

function makeDb(opts: { upsertError?: { message: string } } = {}) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [] }
      calls.push(call)
      const builder = {
        upsert(payload: unknown, options: unknown) {
          call.op = 'upsert'
          call.payload = payload
          call.args.push(options)
          return Promise.resolve({ error: opts.upsertError ?? null })
        },
        update(payload: unknown) {
          call.op = 'update'
          call.payload = payload
          return builder
        },
        eq(col: string, val: unknown) {
          call.args.push(['eq', col, val])
          return builder
        },
        or(expr: string) {
          call.args.push(['or', expr])
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  }
  return { db: db as unknown as SupabaseClient, calls }
}

const adReferral = {
  source_type: 'ad',
  source_id: '120240600103070767',
  source_url: 'https://fb.me/x',
  headline: 'Garage doors',
  body: 'Tap to chat',
  ctwa_clid: 'ARAkLkA8rmlFeiCkt',
}

const input = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactWaId: '97455512345',
  messageId: 'wamid.1',
  timestamp: '1759050000',
  referral: adReferral,
}

describe('isAdReferral', () => {
  it('accepts an ad referral with a click id', () => {
    expect(isAdReferral(adReferral)).toBe(true)
  })
  it('rejects missing, non-ad, and clid-less referrals', () => {
    expect(isAdReferral(undefined)).toBe(false)
    expect(isAdReferral({ ...adReferral, source_type: 'post' })).toBe(false)
    expect(isAdReferral({ ...adReferral, ctwa_clid: '' })).toBe(false)
    expect(isAdReferral({ ...adReferral, ctwa_clid: undefined })).toBe(false)
  })
})

describe('recordCtwaAttribution', () => {
  it('stores the attribution idempotently and badges the conversation', async () => {
    const { db, calls } = makeDb()
    await expect(recordCtwaAttribution(db, input)).resolves.toBe(true)

    const upsert = calls.find((c) => c.table === 'ctwa_attributions')!
    expect(upsert.op).toBe('upsert')
    expect(upsert.payload).toEqual({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      contact_wa_id: '97455512345',
      message_id: 'wamid.1',
      ctwa_clid: 'ARAkLkA8rmlFeiCkt',
      ad_id: '120240600103070767',
      headline: 'Garage doors',
      source_url: 'https://fb.me/x',
      raw_referral: adReferral,
      clicked_at: '2025-09-28T09:00:00.000Z',
    })
    expect(upsert.args[0]).toEqual({ onConflict: 'conversation_id,message_id', ignoreDuplicates: true })

    const update = calls.find((c) => c.table === 'conversations')!
    expect(update.payload).toEqual({
      ad_source_id: '120240600103070767',
      ad_headline: 'Garage doors',
      ad_clicked_at: '2025-09-28T09:00:00.000Z',
    })
    expect(update.args).toContainEqual(['eq', 'id', 'conv-1'])
    // Only move the badge forward -- an older click never overwrites a newer one.
    expect(update.args).toContainEqual([
      'or',
      'ad_clicked_at.is.null,ad_clicked_at.lte.2025-09-28T09:00:00.000Z',
    ])
  })

  it('does nothing for a message without an ad referral', async () => {
    const { db, calls } = makeDb()
    await expect(recordCtwaAttribution(db, { ...input, referral: undefined })).resolves.toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('never throws and never logs the click id when the insert fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, calls } = makeDb({ upsertError: { message: 'boom' } })
    await expect(recordCtwaAttribution(db, input)).resolves.toBe(false)
    expect(calls.some((c) => c.table === 'conversations')).toBe(false)
    const logged = JSON.stringify(spy.mock.calls)
    expect(logged).not.toContain('ARAkLkA8rmlFeiCkt')
    spy.mockRestore()
  })

  it('falls back to now for an unparseable timestamp', async () => {
    const { db, calls } = makeDb()
    await recordCtwaAttribution(db, { ...input, timestamp: 'nope' })
    const upsert = calls.find((c) => c.table === 'ctwa_attributions')!
    expect(typeof (upsert.payload as { clicked_at: string }).clicked_at).toBe('string')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/conversions/attribution.test.ts`
Expected: FAIL — cannot resolve `./attribution`.

- [ ] **Step 4: Implement `src/lib/conversions/attribution.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * `messages[].referral` on a Cloud API inbound message. Present (usually
 * only on the first message) when the customer arrived by tapping a
 * Click-to-WhatsApp ad. `ctwa_clid` is a personal identifier: store it,
 * never log it, never send it to the browser.
 */
export interface WhatsAppReferral {
  source_type?: string
  source_id?: string
  source_url?: string
  headline?: string
  body?: string
  ctwa_clid?: string
  [key: string]: unknown
}

export interface RecordAttributionInput {
  accountId: string
  conversationId: string
  /** `messages[].from` */
  contactWaId: string
  /** wamid -- makes the insert idempotent across Meta's webhook retries. */
  messageId: string
  /** Message `timestamp` (unix seconds, as a string). */
  timestamp: string
  referral: WhatsAppReferral | undefined
}

export function isAdReferral(
  referral: WhatsAppReferral | undefined,
): referral is WhatsAppReferral & { ctwa_clid: string } {
  return (
    !!referral &&
    referral.source_type === 'ad' &&
    typeof referral.ctwa_clid === 'string' &&
    referral.ctwa_clid.length > 0
  )
}

/**
 * Store a CTWA attribution row and move the conversation's ad badge to
 * this click. Returns true when an ad referral was stored. Never throws:
 * a failure here must not block processing the customer's message.
 */
export async function recordCtwaAttribution(
  db: SupabaseClient,
  input: RecordAttributionInput,
): Promise<boolean> {
  const { referral } = input
  if (!isAdReferral(referral)) return false

  const ms = Number(input.timestamp) * 1000
  const clickedAt = new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString()

  try {
    const { error } = await db.from('ctwa_attributions').upsert(
      {
        account_id: input.accountId,
        conversation_id: input.conversationId,
        contact_wa_id: input.contactWaId,
        message_id: input.messageId,
        ctwa_clid: referral.ctwa_clid,
        ad_id: referral.source_id ?? null,
        headline: referral.headline ?? null,
        source_url: referral.source_url ?? null,
        raw_referral: referral,
        clicked_at: clickedAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    if (error) {
      console.error('[ctwa] failed to store attribution for conversation', input.conversationId, error.message)
      return false
    }

    const { error: convError } = await db
      .from('conversations')
      .update({
        ad_source_id: referral.source_id ?? null,
        ad_headline: referral.headline ?? null,
        ad_clicked_at: clickedAt,
      })
      .eq('id', input.conversationId)
      .or(`ad_clicked_at.is.null,ad_clicked_at.lte.${clickedAt}`)
    if (convError) {
      console.error('[ctwa] failed to badge conversation', input.conversationId, convError.message)
    }
    return true
  } catch (err) {
    console.error(
      '[ctwa] attribution error for conversation',
      input.conversationId,
      err instanceof Error ? err.message : 'unknown error',
    )
    return false
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/conversions/attribution.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire into the webhook**

In `src/app/api/whatsapp/webhook/route.ts`:

Add the import next to the other `@/lib` imports:

```ts
import { recordCtwaAttribution, type WhatsAppReferral } from '@/lib/conversions/attribution'
```

Add to `interface WhatsAppMessage`, after `context?: { id: string }`:

```ts
  /**
   * Present when the customer arrived by tapping a Click-to-WhatsApp ad
   * (normally only on the first message after the click). Carries the
   * `ctwa_clid` we report conversions against -- see
   * src/lib/conversions/attribution.ts.
   */
  referral?: WhatsAppReferral
```

In `processMessage()`, immediately after the closing `}` of the `if (message.type !== 'reaction') { ... duplicate guard ... }` block and before the `// Emit conversation.created ...` comment, insert:

```ts
  // Capture the CTWA ad click (if any) before anything else can bail
  // out -- the referral only arrives on this one message and can't be
  // recovered later. Runs after the duplicate guard so a Meta retry
  // doesn't even attempt a second insert. Never throws.
  if (message.referral) {
    await recordCtwaAttribution(supabaseAdmin(), {
      accountId,
      conversationId: conversation.id,
      contactWaId: message.from,
      messageId: message.id,
      timestamp: message.timestamp,
      referral: message.referral,
    })
  }
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/conversions/stages.ts src/lib/conversions/attribution.ts src/lib/conversions/attribution.test.ts src/app/api/whatsapp/webhook/route.ts
git commit -m "Capture Click-to-WhatsApp ad referrals from the Cloud API webhook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Meta CAPI client, outbox sender, poller, env config

**Files:**
- Create: `src/lib/conversions/meta-capi.ts`, `src/lib/conversions/meta-capi.test.ts`
- Create: `src/lib/conversions/sender.ts`, `src/lib/conversions/sender.test.ts`
- Create: `src/lib/conversions/poller.ts`
- Modify: `src/instrumentation.ts`, `.env.local.example`, `.env.production.example`, `docker-compose.yml`

**Interfaces:**
- Consumes: `ConversionEventRow` (Task 2); SQL `claim_conversion_events` (Task 1); `supabaseAdmin()` from `@/lib/automations/admin-client`.
- Produces: `readCapiConfig(env): CapiConfig | null`; `buildCapiPayload(event, ctwaClid, cfg)`; `postCapiEvent(payload, cfg, fetchImpl): Promise<CapiResult>`; `BACKOFF_MS`; `nextAttemptAt(attempts, now): string`; `runConversionSender(deps?): Promise<{ sent: number; failed: number }>`; `kickConversionSender(): Promise<unknown>`; `startConversionPoller(intervalMs?): void`.

- [ ] **Step 1: Write the failing test** `src/lib/conversions/meta-capi.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import { buildCapiPayload, postCapiEvent, readCapiConfig, type CapiConfig } from './meta-capi'

const env = {
  META_CAPI_ENABLED: 'true',
  META_DATASET_ID: 'ds-1',
  META_WABA_ID: 'waba-1',
  META_CAPI_ACCESS_TOKEN: 'tok',
  GRAPH_API_VERSION: 'v24.0',
}
const cfg: CapiConfig = { datasetId: 'ds-1', wabaId: 'waba-1', accessToken: 'tok', graphVersion: 'v24.0' }

describe('readCapiConfig', () => {
  it('returns config when enabled and complete', () => {
    expect(readCapiConfig(env)).toEqual(cfg)
  })
  it('includes the test event code only when set', () => {
    expect(readCapiConfig({ ...env, META_TEST_EVENT_CODE: 'TEST123' })?.testEventCode).toBe('TEST123')
  })
  it('returns null when the flag is off or anything is missing', () => {
    expect(readCapiConfig({ ...env, META_CAPI_ENABLED: 'false' })).toBeNull()
    expect(readCapiConfig({ ...env, META_CAPI_ENABLED: undefined })).toBeNull()
    expect(readCapiConfig({ ...env, META_CAPI_ACCESS_TOKEN: '' })).toBeNull()
    expect(readCapiConfig({ ...env, META_DATASET_ID: undefined })).toBeNull()
  })
  it('adds a missing v prefix to the Graph version', () => {
    expect(readCapiConfig({ ...env, GRAPH_API_VERSION: '24.0' })?.graphVersion).toBe('v24.0')
  })
})

describe('buildCapiPayload', () => {
  const base = {
    meta_event_name: 'Purchase',
    event_id: 'conv-1:won',
    tagged_at: '2025-09-28T09:00:00.000Z',
    stage: 'won' as const,
    value: '45000.00',
    currency: 'QAR',
  }

  it('matches the Meta schema exactly for Purchase', () => {
    expect(buildCapiPayload(base, 'ARAkLkA8rmlFeiCkt', cfg)).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1759050000,
          event_id: 'conv-1:won',
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          user_data: { whatsapp_business_account_id: 'waba-1', ctwa_clid: 'ARAkLkA8rmlFeiCkt' },
          custom_data: { currency: 'QAR', value: 45000 },
        },
      ],
    })
  })

  it('omits custom_data for non-Purchase stages and adds test_event_code when configured', () => {
    const payload = buildCapiPayload(
      { ...base, meta_event_name: 'QualifiedLead', event_id: 'conv-1:qualified', stage: 'qualified', value: null, currency: null },
      'clid',
      { ...cfg, testEventCode: 'TEST123' },
    )
    expect(payload.data[0]).not.toHaveProperty('custom_data')
    expect(payload.test_event_code).toBe('TEST123')
  })
})

describe('postCapiEvent', () => {
  const payload = { data: [] }

  it('posts to the dataset events endpoint with a bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'trace' }), { status: 200 }),
    )
    const result = await postCapiEvent(payload, cfg, fetchImpl)
    expect(result).toEqual({ ok: true, response: { events_received: 1, fbtrace_id: 'trace' } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://graph.facebook.com/v24.0/ds-1/events')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual(payload)
  })

  it('returns Meta error message and code on 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid parameter', code: 100, error_subcode: 2804 } }), { status: 400 }),
    )
    await expect(postCapiEvent(payload, cfg, fetchImpl)).resolves.toEqual({
      ok: false,
      error: 'Invalid parameter (code 100/2804)',
    })
  })

  it('returns a network error instead of throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(postCapiEvent(payload, cfg, fetchImpl)).resolves.toEqual({ ok: false, error: 'fetch failed' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/conversions/meta-capi.test.ts`
Expected: FAIL — cannot resolve `./meta-capi`.

- [ ] **Step 3: Implement `src/lib/conversions/meta-capi.ts`**

```ts
import type { ConversionEventRow } from './stages'

/**
 * Conversions API for Business Messaging (WhatsApp). Config comes from
 * env vars; `null` means "don't send" (flag off or incomplete), and the
 * outbox rows simply stay pending until it's configured.
 */
export interface CapiConfig {
  datasetId: string
  wabaId: string
  accessToken: string
  graphVersion: string
  testEventCode?: string
}

type Env = Record<string, string | undefined>

export function readCapiConfig(env: Env = process.env): CapiConfig | null {
  if (env.META_CAPI_ENABLED !== 'true') return null
  const datasetId = env.META_DATASET_ID?.trim()
  const wabaId = env.META_WABA_ID?.trim()
  const accessToken = env.META_CAPI_ACCESS_TOKEN?.trim()
  const rawVersion = env.GRAPH_API_VERSION?.trim()
  if (!datasetId || !wabaId || !accessToken || !rawVersion) return null
  const graphVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
  const testEventCode = env.META_TEST_EVENT_CODE?.trim()
  return { datasetId, wabaId, accessToken, graphVersion, ...(testEventCode ? { testEventCode } : {}) }
}

export interface CapiPayload {
  data: Record<string, unknown>[]
  test_event_code?: string
}

export function buildCapiPayload(
  event: Pick<ConversionEventRow, 'meta_event_name' | 'event_id' | 'tagged_at' | 'stage' | 'value' | 'currency'>,
  ctwaClid: string,
  cfg: CapiConfig,
): CapiPayload {
  const data: Record<string, unknown> = {
    event_name: event.meta_event_name,
    event_time: Math.floor(Date.parse(event.tagged_at) / 1000),
    event_id: event.event_id,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: cfg.wabaId,
      // Sent unhashed, per Meta's business-messaging spec.
      ctwa_clid: ctwaClid,
    },
  }
  if (event.stage === 'won') {
    data.custom_data = { currency: event.currency ?? 'QAR', value: Number(event.value) }
  }
  const payload: CapiPayload = { data: [data] }
  if (cfg.testEventCode) payload.test_event_code = cfg.testEventCode
  return payload
}

export type CapiResult =
  | { ok: true; response: { events_received: unknown; fbtrace_id: unknown } }
  | { ok: false; error: string }

export async function postCapiEvent(
  payload: CapiPayload,
  cfg: CapiConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<CapiResult> {
  const url = `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(cfg.datasetId)}/events`
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.accessToken}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => ({}))) as {
      events_received?: unknown
      fbtrace_id?: unknown
      error?: { message?: string; code?: number; error_subcode?: number }
    }
    if (res.ok) {
      return { ok: true, response: { events_received: body.events_received ?? null, fbtrace_id: body.fbtrace_id ?? null } }
    }
    const err = body.error
    if (!err) return { ok: false, error: `HTTP ${res.status}` }
    const code = `${err.code ?? res.status}${err.error_subcode ? `/${err.error_subcode}` : ''}`
    return { ok: false, error: `${err.message ?? 'Meta API error'} (code ${code})` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/conversions/meta-capi.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test** `src/lib/conversions/sender.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BACKOFF_MS, nextAttemptAt, runConversionSender } from './sender'
import type { ConversionEventRow } from './stages'

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: vi.fn() }))

const env = {
  META_CAPI_ENABLED: 'true',
  META_DATASET_ID: 'ds-1',
  META_WABA_ID: 'waba-1',
  META_CAPI_ACCESS_TOKEN: 'tok',
  GRAPH_API_VERSION: 'v24.0',
}
const NOW = Date.parse('2026-09-28T10:00:00.000Z')

function row(over: Partial<ConversionEventRow> = {}): ConversionEventRow {
  return {
    id: 'ev-1', account_id: 'acct-1', conversation_id: 'conv-1', attribution_id: 'attr-1', deal_id: null,
    stage: 'qualified', meta_event_name: 'QualifiedLead', event_id: 'conv-1:qualified', value: null, currency: null,
    status: 'sending', attempts: 1, next_attempt_at: '', last_attempt_at: null, last_error: null, meta_response: null,
    tagged_by: null, tagged_at: '2026-09-28T09:59:00.000Z', sent_at: null, undone_at: null, ...over,
  }
}

function makeDb(rows: ConversionEventRow[], clid: string | null = 'CLID') {
  const updates: { id: unknown; patch: Record<string, unknown> }[] = []
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  const db = {
    rpc,
    from(table: string) {
      if (table === 'ctwa_attributions') {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () => Promise.resolve({ data: clid ? { ctwa_clid: clid } : null, error: null }),
        }
        return b
      }
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: unknown) => {
            updates.push({ id, patch })
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
  return { db: db as unknown as SupabaseClient, updates, rpc }
}

const ok = () => new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'tr' }), { status: 200 })

describe('nextAttemptAt', () => {
  it('follows the 1m/5m/30m/2h/12h ladder', () => {
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 43_200_000])
    expect(nextAttemptAt(1, NOW)).toBe(new Date(NOW + 60_000).toISOString())
    expect(nextAttemptAt(5, NOW)).toBe(new Date(NOW + 43_200_000).toISOString())
  })
})

describe('runConversionSender', () => {
  it('does nothing (no claim, no fetch) when the flag is off', async () => {
    const { db, rpc } = makeDb([row()])
    const fetchImpl = vi.fn()
    await expect(runConversionSender({ db, fetchImpl, env: { ...env, META_CAPI_ENABLED: 'false' } })).resolves.toEqual({ sent: 0, failed: 0 })
    expect(rpc).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('claims due rows and marks a 2xx as sent with Meta response stored', async () => {
    const { db, updates, rpc } = makeDb([row()])
    const fetchImpl = vi.fn().mockResolvedValue(ok())
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 1, failed: 0 })
    expect(rpc).toHaveBeenCalledWith('claim_conversion_events', { p_limit: 20 })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.data[0].user_data.ctwa_clid).toBe('CLID')
    expect(updates).toEqual([
      {
        id: 'ev-1',
        patch: {
          status: 'sent',
          sent_at: new Date(NOW).toISOString(),
          meta_response: { events_received: 1, fbtrace_id: 'tr' },
          last_error: null,
        },
      },
    ])
  })

  it('marks a 4xx as failed with the error and schedules the next retry', async () => {
    const { db, updates } = makeDb([row({ attempts: 2 })])
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Bad clid', code: 100 } }), { status: 400 }),
    )
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 0, failed: 1 })
    expect(updates[0].patch).toEqual({
      status: 'failed',
      last_error: 'Bad clid (code 100)',
      next_attempt_at: new Date(NOW + 300_000).toISOString(),
    })
  })

  it('fails a row whose attribution clid is gone without calling Meta', async () => {
    const { db, updates } = makeDb([row()], null)
    const fetchImpl = vi.fn()
    await runConversionSender({ db, fetchImpl, env, now: () => NOW })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(updates[0].patch.status).toBe('failed')
  })

  it('treats a network rejection as a failed attempt, not a crash', async () => {
    const { db, updates } = makeDb([row()])
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(runConversionSender({ db, fetchImpl, env, now: () => NOW })).resolves.toEqual({ sent: 0, failed: 1 })
    expect(updates[0].patch.last_error).toBe('fetch failed')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/conversions/sender.test.ts`
Expected: FAIL — cannot resolve `./sender`.

- [ ] **Step 7: Implement `src/lib/conversions/sender.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { buildCapiPayload, postCapiEvent, readCapiConfig, type CapiConfig, type CapiResult } from './meta-capi'
import type { ConversionEventRow } from './stages'

/** Delay before the next try, indexed by attempts already made (1-based). */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]

export function nextAttemptAt(attempts: number, now: number = Date.now()): string {
  const idx = Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1
  return new Date(now + BACKOFF_MS[idx]).toISOString()
}

interface SenderDeps {
  db?: SupabaseClient
  fetchImpl?: typeof fetch
  env?: Record<string, string | undefined>
  limit?: number
  now?: () => number
}

/**
 * Outbox sender: claim due `conversion_events` rows (atomic, SKIP
 * LOCKED -- see claim_conversion_events in migration 065), POST each to
 * Meta, and mark it sent or failed. `sent` rows are never claimed, so a
 * row can't be double-counted by Meta (which doesn't dedupe these).
 */
export async function runConversionSender(deps: SenderDeps = {}): Promise<{ sent: number; failed: number }> {
  const cfg = readCapiConfig(deps.env ?? process.env)
  if (!cfg) return { sent: 0, failed: 0 }

  const db = deps.db ?? supabaseAdmin()
  const fetchImpl = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now

  const { data, error } = await db.rpc('claim_conversion_events', { p_limit: deps.limit ?? 20 })
  if (error) {
    console.error('[capi] claim failed:', error.message)
    return { sent: 0, failed: 0 }
  }

  let sent = 0
  let failed = 0
  for (const row of (data ?? []) as ConversionEventRow[]) {
    const result = await sendOne(db, row, cfg, fetchImpl)
    if (result.ok) {
      sent++
      await db
        .from('conversion_events')
        .update({ status: 'sent', sent_at: new Date(now()).toISOString(), meta_response: result.response, last_error: null })
        .eq('id', row.id)
    } else {
      failed++
      console.warn('[capi] send failed for event', row.id, 'attempt', row.attempts, result.error)
      await db
        .from('conversion_events')
        .update({ status: 'failed', last_error: result.error, next_attempt_at: nextAttemptAt(row.attempts, now()) })
        .eq('id', row.id)
    }
  }
  return { sent, failed }
}

async function sendOne(
  db: SupabaseClient,
  row: ConversionEventRow,
  cfg: CapiConfig,
  fetchImpl: typeof fetch,
): Promise<CapiResult> {
  if (!row.attribution_id) return { ok: false, error: 'No ad attribution for this event' }
  const { data } = await db
    .from('ctwa_attributions')
    .select('ctwa_clid')
    .eq('id', row.attribution_id)
    .maybeSingle()
  const clid = (data as { ctwa_clid?: string } | null)?.ctwa_clid
  if (!clid) return { ok: false, error: 'Attribution missing ctwa_clid' }
  return postCapiEvent(buildCapiPayload(row, clid, cfg), cfg, fetchImpl)
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npx vitest run src/lib/conversions/`
Expected: PASS.

- [ ] **Step 9: Create `src/lib/conversions/poller.ts`**

```ts
import { runConversionSender } from './sender'

// Single-flight: the 60 s poller and the post-tag `after()` kick share
// one in-process run. Cross-process safety comes from the SKIP LOCKED
// claim in the database, not from this.
let inFlight: Promise<unknown> | null = null

export function kickConversionSender(): Promise<unknown> {
  if (!inFlight) {
    inFlight = runConversionSender()
      .catch((err) => console.error('[capi] sender run failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        inFlight = null
      })
  }
  return inFlight
}

const POLLER_KEY = '__ctwaConversionPoller'

/** Start the outbox poller once per process (idempotent across HMR). */
export function startConversionPoller(intervalMs = 60_000): void {
  const g = globalThis as typeof globalThis & { [POLLER_KEY]?: ReturnType<typeof setInterval> }
  if (g[POLLER_KEY]) return
  const timer = setInterval(() => void kickConversionSender(), intervalMs)
  timer.unref?.()
  g[POLLER_KEY] = timer
}
```

- [ ] **Step 10: Start the poller from `src/instrumentation.ts`**

Inside the existing `if (process.env.NEXT_RUNTIME === 'nodejs') { ... }` block, after `setDefaultAutoSelectFamily(false)`:

```ts

    // CTWA conversions outbox (migration 065). The app runs as one
    // long-lived container, so an in-process interval replaces a cron;
    // it's a no-op unless META_CAPI_ENABLED=true.
    const { startConversionPoller } = await import('@/lib/conversions/poller')
    startConversionPoller()
```

- [ ] **Step 11: Document the env vars**

Append to `.env.production.example` under the OPTIONAL section:

```bash
# Click-to-WhatsApp lead quality -> Meta Conversions API (migration 065).
# Leave META_CAPI_ENABLED=false until a test event shows up in Events
# Manager. Token: System User with whatsapp_business_management +
# whatsapp_business_manage_events. Dataset: POST /{WABA_ID}/dataset.
# META_CAPI_ENABLED=false
# META_DATASET_ID=
# META_WABA_ID=
# META_CAPI_ACCESS_TOKEN=
# GRAPH_API_VERSION=v24.0
# META_TEST_EVENT_CODE=
```

Append the same block to `.env.local.example`. In `docker-compose.yml`, add under `environment:` after `NEXT_PUBLIC_SITE_URL`:

```yaml
      # CTWA conversions (see .env.production.example). Off by default.
      META_CAPI_ENABLED: "${META_CAPI_ENABLED:-false}"
      META_DATASET_ID: "${META_DATASET_ID:-}"
      META_WABA_ID: "${META_WABA_ID:-}"
      META_CAPI_ACCESS_TOKEN: "${META_CAPI_ACCESS_TOKEN:-}"
      GRAPH_API_VERSION: "${GRAPH_API_VERSION:-}"
      META_TEST_EVENT_CODE: "${META_TEST_EVENT_CODE:-}"
```

- [ ] **Step 12: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add src/lib/conversions/meta-capi.ts src/lib/conversions/meta-capi.test.ts src/lib/conversions/sender.ts src/lib/conversions/sender.test.ts src/lib/conversions/poller.ts src/instrumentation.ts .env.local.example .env.production.example docker-compose.yml
git commit -m "Send queued CTWA conversions to Meta with retry and backoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tag and undo API routes

**Files:**
- Create: `src/app/api/conversions/route.ts`, `src/app/api/conversions/route.test.ts`
- Create: `src/app/api/conversions/[id]/route.ts`, `src/app/api/conversions/[id]/route.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `toErrorResponse` (`@/lib/auth/account`); `supabaseAdmin` (`@/lib/automations/admin-client`); `kickConversionSender` (Task 3); `isConversionStage` (Task 2); SQL `enqueue_conversion` (Task 1).
- Produces: `POST /api/conversions` body `{ conversation_id: string, stage: ConversionStage, value?: number }` → `200 { ok: true }` | 400 | 404 | 409 | 500. `DELETE /api/conversions/:id` → `200 { ok: true }` | 404 | 500.

- [ ] **Step 1: Write the failing test** `src/app/api/conversions/route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  kick: vi.fn(),
  after: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/conversions/poller', () => ({ kickConversionSender: mocks.kick }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}))

import { POST } from './route'

interface ScopedOpts {
  conversation?: { id: string } | null
  deal?: { id: string; status: string } | null
  updatedRows?: { id: string }[]
}

function scopedClient({ conversation = { id: 'conv-1' }, deal = { id: 'deal-1', status: 'open' }, updatedRows = [{ id: 'deal-1' }] }: ScopedOpts = {}) {
  const dealUpdates: unknown[] = []
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {}
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: table === 'conversations' ? conversation : deal, error: null }),
        update: (patch: unknown) => {
          dealUpdates.push(patch)
          return { eq: () => ({ select: () => Promise.resolve({ data: updatedRows, error: null }) }) }
        },
      })
      return b
    },
  }
  return { client, dealUpdates }
}

function req(body: unknown) {
  return new Request('http://localhost/api/conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let scoped: ReturnType<typeof scopedClient>

beforeEach(() => {
  scoped = scopedClient()
  mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1', accountId: 'acct-1', role: 'agent' })
  mocks.rpc.mockResolvedValue({ error: null })
})

describe('POST /api/conversions', () => {
  it('requires at least agent', async () => {
    await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
  })

  it('returns the auth error for viewers', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden'))
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(res.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing conversation id or unknown stage', async () => {
    expect((await POST(req({ stage: 'qualified' }))).status).toBe(400)
    expect((await POST(req({ conversation_id: 'conv-1', stage: 'lead' }))).status).toBe(400)
  })

  it('404s when the caller cannot see the conversation', async () => {
    scoped = scopedClient({ conversation: null })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-9', stage: 'qualified' }))
    expect(res.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('enqueues qualified and kicks the sender after the response', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'qualified' }))
    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_conversion', {
      p_conversation_id: 'conv-1',
      p_stage: 'qualified',
      p_value: null,
      p_currency: null,
      p_deal_id: null,
      p_user_id: 'user-1',
    })
    expect(mocks.after).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, 0, -5, 'abc', ''])('rejects Won with value %p', async (value) => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value }))
    expect(res.status).toBe(400)
    expect(scoped.dealUpdates).toHaveLength(0)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('marks the linked deal won in QAR and enqueues Purchase', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 45000 }))
    expect(res.status).toBe(200)
    expect(scoped.dealUpdates).toEqual([{ value: 45000, currency: 'QAR', status: 'won' }])
    expect(mocks.rpc).toHaveBeenCalledWith('enqueue_conversion', expect.objectContaining({
      p_stage: 'won', p_value: 45000, p_currency: 'QAR', p_deal_id: 'deal-1',
    }))
  })

  it('accepts a numeric string value', async () => {
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: '1200.50' }))
    expect(res.status).toBe(200)
    expect(scoped.dealUpdates).toEqual([{ value: 1200.5, currency: 'QAR', status: 'won' }])
  })

  it('won on an already-won deal still returns ok and enqueues idempotently', async () => {
    scoped = scopedClient({ deal: { id: 'deal-1', status: 'won' } })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('409s when no deal is linked', async () => {
    scoped = scopedClient({ deal: null })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(409)
  })

  it('404s when RLS blocks the deal update (0 rows)', async () => {
    scoped = scopedClient({ updatedRows: [] })
    mocks.requireRole.mockResolvedValue({ supabase: scoped.client, userId: 'user-1' })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'won', value: 100 }))
    expect(res.status).toBe(404)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('500s when enqueue fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'db down' } })
    const res = await POST(req({ conversation_id: 'conv-1', stage: 'site_visit' }))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/api/conversions/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `src/app/api/conversions/route.ts`**

```ts
import { NextResponse, after } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { kickConversionSender } from '@/lib/conversions/poller'
import { isConversionStage } from '@/lib/conversions/stages'

/**
 * POST /api/conversions
 *
 * Body: { conversation_id, stage: 'qualified' | 'site_visit' | 'won', value? }
 *
 * Tags a conversation's lead-quality stage (CTWA conversions, migration
 * 065). Visibility is checked with the caller's RLS-scoped client, so an
 * agent can only tag conversations assigned to them. The outbox row is
 * written by enqueue_conversion() (service role); Meta is only called
 * after the response, by the sender.
 *
 * Won marks the conversation's latest deal won with the value in QAR --
 * the deals trigger enqueues Purchase too, and the explicit enqueue here
 * is idempotent (event_id is unique), so an already-won deal still ends
 * up tagged exactly once.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const body = (await request.json().catch(() => null)) as
      | { conversation_id?: unknown; stage?: unknown; value?: unknown }
      | null
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id.trim() : ''
    const stage = body?.stage
    if (!conversationId || !isConversionStage(stage)) {
      return NextResponse.json({ error: 'conversation_id and a valid stage are required' }, { status: 400 })
    }

    let value: number | null = null
    if (stage === 'won') {
      value = typeof body?.value === 'number' ? body.value : typeof body?.value === 'string' && body.value.trim() ? Number(body.value) : NaN
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: 'value must be a number greater than 0' }, { status: 400 })
      }
    }

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .maybeSingle()
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    let dealId: string | null = null
    if (stage === 'won') {
      const { data: deal } = await ctx.supabase
        .from('deals')
        .select('id, status')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!deal) {
        return NextResponse.json(
          { error: 'No deal is linked to this conversation. Create one in Pipelines first.' },
          { status: 409 },
        )
      }
      const { data: updated, error: updateError } = await ctx.supabase
        .from('deals')
        .update({ value, currency: 'QAR', status: 'won' })
        .eq('id', deal.id)
        .select('id')
      if (updateError) {
        return NextResponse.json({ error: 'Could not update the deal' }, { status: 500 })
      }
      if (!updated || updated.length === 0) {
        return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
      }
      dealId = deal.id
    }

    const { error: enqueueError } = await supabaseAdmin().rpc('enqueue_conversion', {
      p_conversation_id: conversationId,
      p_stage: stage,
      p_value: value,
      p_currency: stage === 'won' ? 'QAR' : null,
      p_deal_id: dealId,
      p_user_id: ctx.userId,
    })
    if (enqueueError) {
      console.error('[conversions] enqueue failed:', enqueueError.message)
      return NextResponse.json({ error: 'Could not save the tag' }, { status: 500 })
    }

    after(() => kickConversionSender())
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/api/conversions/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test** `src/app/api/conversions/[id]/route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), adminUpdate: vi.fn(), adminEq: vi.fn() }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (patch: unknown) => {
        mocks.adminUpdate(patch)
        return { eq: mocks.adminEq }
      },
    }),
  }),
}))

import { DELETE } from './route'

function scoped(row: { id: string } | null) {
  const b: Record<string, unknown> = {}
  Object.assign(b, { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: row, error: null }) })
  return { from: () => b }
}

const params = { params: Promise.resolve({ id: 'ev-1' }) }
const req = () => new Request('http://localhost/api/conversions/ev-1', { method: 'DELETE' })

beforeEach(() => {
  mocks.adminEq.mockResolvedValue({ error: null })
})

describe('DELETE /api/conversions/[id]', () => {
  it('404s when the event is not visible to the caller', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: scoped(null) })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(404)
    expect(mocks.adminUpdate).not.toHaveBeenCalled()
  })

  it('marks the tag undone without deleting it', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: scoped({ id: 'ev-1' }) })
    const res = await DELETE(req(), params)
    expect(res.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('agent')
    expect(mocks.adminUpdate).toHaveBeenCalledWith({ undone_at: expect.any(String) })
    expect(mocks.adminEq).toHaveBeenCalledWith('id', 'ev-1')
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run "src/app/api/conversions/[id]/route.test.ts"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 7: Implement `src/app/api/conversions/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

/**
 * DELETE /api/conversions/[id] -- undo a stage tag in the app.
 *
 * Only sets undone_at: an event already sent to Meta is NOT retracted
 * (the UI says so). A still-unsent row is skipped by the sender while
 * undone. Visibility is checked via the caller's RLS-scoped client
 * (conversion_events_select requires seeing the conversation).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params

    const { data: row } = await ctx.supabase.from('conversion_events').select('id').eq('id', id).maybeSingle()
    if (!row) {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    }

    const { error } = await supabaseAdmin()
      .from('conversion_events')
      .update({ undone_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: 'Could not undo the tag' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 8: Run to verify it passes, then full suite + typecheck**

Run: `npx vitest run src/app/api/conversions && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/conversions
git commit -m "Add API to tag and untag conversation lead stages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Report aggregation + report API

**Files:**
- Create: `src/lib/conversions/report.ts`, `src/lib/conversions/report.test.ts`
- Create: `src/app/api/conversions/report/route.ts`, `src/app/api/conversions/report/route.test.ts`

**Interfaces:**
- Consumes: `ConversionStage` (Task 2).
- Produces: `buildAdReport(attrs: AttributionForReport[], events: EventForReport[]): AdReportRow[]`; `adReportToCsv(rows: AdReportRow[]): string`; `AdReportRow { ad_id; headline; conversations; qualified; site_visit; won; won_value; qualified_rate }`; `FailedSend { id; conversation_id; stage; attempts; last_error; last_attempt_at }`; `GET /api/conversions/report?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ rows: AdReportRow[]; failed: FailedSend[] }`.

- [ ] **Step 1: Write the failing test** `src/lib/conversions/report.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { adReportToCsv, buildAdReport } from './report'

const attrs = [
  { conversation_id: 'c1', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-01T10:00:00+00:00' },
  { conversation_id: 'c2', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-02T10:00:00+00:00' },
  { conversation_id: 'c3', ad_id: 'B', headline: 'Shutters', clicked_at: '2026-09-03T10:00:00+00:00' },
  // c3 clicked A earlier -- latest click (B) wins.
  { conversation_id: 'c3', ad_id: 'A', headline: 'Garage', clicked_at: '2026-08-30T10:00:00+00:00' },
]

const events = [
  { conversation_id: 'c1', stage: 'qualified' as const, value: null, undone_at: null },
  { conversation_id: 'c1', stage: 'won' as const, value: '45000.00', undone_at: null },
  { conversation_id: 'c2', stage: 'qualified' as const, value: null, undone_at: '2026-09-05T00:00:00Z' },
  { conversation_id: 'c3', stage: 'site_visit' as const, value: null, undone_at: null },
  { conversation_id: 'zz', stage: 'qualified' as const, value: null, undone_at: null },
]

describe('buildAdReport', () => {
  it('groups by each conversation\'s latest ad and skips undone tags', () => {
    expect(buildAdReport(attrs, events)).toEqual([
      { ad_id: 'A', headline: 'Garage', conversations: 2, qualified: 1, site_visit: 0, won: 1, won_value: 45000, qualified_rate: 0.5 },
      { ad_id: 'B', headline: 'Shutters', conversations: 1, qualified: 0, site_visit: 1, won: 0, won_value: 0, qualified_rate: 0 },
    ])
  })

  it('returns an empty report for no attributions', () => {
    expect(buildAdReport([], events)).toEqual([])
  })
})

describe('adReportToCsv', () => {
  it('writes a header and escapes commas and quotes', () => {
    const csv = adReportToCsv([
      { ad_id: 'A', headline: 'Doors, "fast"', conversations: 4, qualified: 1, site_visit: 0, won: 1, won_value: 1200.5, qualified_rate: 0.25 },
    ])
    expect(csv).toBe(
      'Ad ID,Headline,Conversations,Qualified,Site visit,Won,Won value (QAR),Qualified rate\n' +
        'A,"Doors, ""fast""",4,1,0,1,1200.50,25.0%\n',
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/conversions/report.test.ts`
Expected: FAIL — cannot resolve `./report`.

- [ ] **Step 3: Implement `src/lib/conversions/report.ts`**

```ts
import type { ConversionStage } from './stages'

// Pure, client-safe per-ad aggregation for the /ad-conversions page.

export interface AttributionForReport {
  conversation_id: string
  ad_id: string | null
  headline: string | null
  clicked_at: string
}

export interface EventForReport {
  conversation_id: string
  stage: ConversionStage
  value: number | string | null
  undone_at: string | null
}

export interface AdReportRow {
  ad_id: string
  headline: string
  conversations: number
  qualified: number
  site_visit: number
  won: number
  won_value: number
  qualified_rate: number
}

export interface FailedSend {
  id: string
  conversation_id: string
  stage: ConversionStage
  attempts: number
  last_error: string | null
  last_attempt_at: string | null
}

/** Each conversation counts once, under its most recent ad click. */
export function buildAdReport(attrs: AttributionForReport[], events: EventForReport[]): AdReportRow[] {
  const latest = new Map<string, AttributionForReport>()
  for (const a of attrs) {
    const current = latest.get(a.conversation_id)
    if (!current || Date.parse(a.clicked_at) > Date.parse(current.clicked_at)) latest.set(a.conversation_id, a)
  }

  const rows = new Map<string, AdReportRow>()
  for (const a of latest.values()) {
    const key = a.ad_id ?? 'unknown'
    const row = rows.get(key) ?? {
      ad_id: key, headline: a.headline ?? '', conversations: 0, qualified: 0, site_visit: 0, won: 0, won_value: 0, qualified_rate: 0,
    }
    row.conversations++
    if (!row.headline && a.headline) row.headline = a.headline
    rows.set(key, row)
  }

  for (const e of events) {
    if (e.undone_at) continue
    const a = latest.get(e.conversation_id)
    if (!a) continue
    const row = rows.get(a.ad_id ?? 'unknown')!
    row[e.stage]++
    if (e.stage === 'won') row.won_value += Number(e.value) || 0
  }

  for (const row of rows.values()) {
    row.qualified_rate = row.conversations ? row.qualified / row.conversations : 0
  }
  return [...rows.values()].sort((x, y) => y.conversations - x.conversations)
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function adReportToCsv(rows: AdReportRow[]): string {
  const header = 'Ad ID,Headline,Conversations,Qualified,Site visit,Won,Won value (QAR),Qualified rate\n'
  const body = rows
    .map((r) =>
      [r.ad_id, r.headline, r.conversations, r.qualified, r.site_visit, r.won, r.won_value.toFixed(2), `${(r.qualified_rate * 100).toFixed(1)}%`]
        .map(csvCell)
        .join(','),
    )
    .map((line) => `${line}\n`)
    .join('')
  return header + body
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/conversions/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test** `src/app/api/conversions/report/route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), selects: [] as string[], filters: [] as unknown[] }))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

const fixtures: Record<string, unknown[]> = {
  ctwa_attributions: [{ conversation_id: 'c1', ad_id: 'A', headline: 'Garage', clicked_at: '2026-09-01T10:00:00+00:00' }],
  conversion_events: [{ conversation_id: 'c1', stage: 'qualified', value: null, undone_at: null }],
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const b: Record<string, unknown> = {}
      const done = Promise.resolve({ data: fixtures[table], error: null })
      Object.assign(b, {
        select: (cols: string) => { mocks.selects.push(`${table}:${cols}`); return b },
        eq: (...a: unknown[]) => { mocks.filters.push([table, 'eq', ...a]); return b },
        gte: (...a: unknown[]) => { mocks.filters.push([table, 'gte', ...a]); return b },
        lte: (...a: unknown[]) => { mocks.filters.push([table, 'lte', ...a]); return b },
        in: () => b,
        order: () => b,
        limit: () => done,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => done.then(res, rej),
      })
      return b
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
  mocks.selects.length = 0
  mocks.filters.length = 0
  mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u', role: 'admin' })
})

describe('GET /api/conversions/report', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden'))
    const res = await GET(new Request('http://localhost/api/conversions/report'))
    expect(res.status).toBe(403)
  })

  it('scopes to the account and date range and never selects the click id', async () => {
    const res = await GET(new Request('http://localhost/api/conversions/report?from=2026-09-01&to=2026-09-30'))
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows[0]).toMatchObject({ ad_id: 'A', conversations: 1, qualified: 1 })
    expect(mocks.selects.join(' ')).not.toContain('ctwa_clid')
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'eq', 'account_id', 'acct-1'])
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'gte', 'clicked_at', '2026-09-01T00:00:00.000Z'])
    expect(mocks.filters).toContainEqual(['ctwa_attributions', 'lte', 'clicked_at', '2026-09-30T23:59:59.999Z'])
  })

  it('400s on a malformed date', async () => {
    const res = await GET(new Request('http://localhost/api/conversions/report?from=yesterday'))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/app/api/conversions/report/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 7: Implement `src/app/api/conversions/report/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  buildAdReport,
  type AttributionForReport,
  type EventForReport,
  type FailedSend,
} from '@/lib/conversions/report'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/conversions/report?from=YYYY-MM-DD&to=YYYY-MM-DD (admin+)
 *
 * Per-ad lead quality for conversations whose ad click falls in the range
 * (UTC days, default: last 30 days), plus the account's failed sends.
 * Uses the service role because ctwa_attributions has no client policies;
 * every query is scoped to ctx.accountId and never selects ctwa_clid.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const url = new URL(request.url)
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    if ((fromParam && !DATE_RE.test(fromParam)) || (toParam && !DATE_RE.test(toParam))) {
      return NextResponse.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 })
    }
    const fromIso = fromParam
      ? `${fromParam}T00:00:00.000Z`
      : new Date(Date.now() - 30 * 86_400_000).toISOString()
    const toIso = toParam ? `${toParam}T23:59:59.999Z` : new Date().toISOString()

    const db = supabaseAdmin()
    const { data: attrs, error: attrError } = await db
      .from('ctwa_attributions')
      .select('conversation_id, ad_id, headline, clicked_at')
      .eq('account_id', ctx.accountId)
      .gte('clicked_at', fromIso)
      .lte('clicked_at', toIso)
    if (attrError) throw attrError

    const conversationIds = [...new Set((attrs ?? []).map((a) => a.conversation_id as string))]
    let events: EventForReport[] = []
    if (conversationIds.length > 0) {
      const { data, error } = await db
        .from('conversion_events')
        .select('conversation_id, stage, value, undone_at')
        .eq('account_id', ctx.accountId)
        .in('conversation_id', conversationIds)
      if (error) throw error
      events = (data ?? []) as EventForReport[]
    }

    const { data: failed, error: failedError } = await db
      .from('conversion_events')
      .select('id, conversation_id, stage, attempts, last_error, last_attempt_at')
      .eq('account_id', ctx.accountId)
      .eq('status', 'failed')
      .order('last_attempt_at', { ascending: false })
      .limit(100)
    if (failedError) throw failedError

    return NextResponse.json({
      rows: buildAdReport((attrs ?? []) as AttributionForReport[], events),
      failed: (failed ?? []) as FailedSend[],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
```

- [ ] **Step 8: Run to verify it passes; full suite + typecheck**

Run: `npx vitest run src/lib/conversions src/app/api/conversions && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/conversions/report.ts src/lib/conversions/report.test.ts src/app/api/conversions/report
git commit -m "Add per-ad lead quality report API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Inbox UI — ad badge and stage chips

**Files:**
- Modify: `src/types/index.ts` (`interface Conversation`, ~line 266)
- Create: `src/components/inbox/conversion-stages.tsx`
- Modify: `src/components/inbox/contact-sidebar.tsx` (props + render above "Active Deals", ~line 270)
- Modify: `src/app/(dashboard)/inbox/page.tsx` (~line 647, pass `conversation`)
- Modify: `src/components/inbox/conversation-list.tsx` (`ConversationItem`, name row)
- Modify: `messages/en.json`, `messages/ar.json`

**Interfaces:**
- Consumes: `POST /api/conversions`, `DELETE /api/conversions/:id` (Task 4); `conversion_events` SELECT RLS (Task 1); `CONVERSION_STAGES`, `ConversionStage`, `ConversionStatus` (Task 2).
- Produces: `<ConversionStages conversation={Conversation} refreshToken?: number />`; `ContactSidebar` gains optional prop `conversation?: Conversation | null`.

- [ ] **Step 1: Add ad fields to `Conversation` in `src/types/index.ts`** (after `contact?: Contact;`)

```ts
  /**
   * Latest Click-to-WhatsApp ad this conversation came from (migration
   * 065), denormalized by the webhook. Null for organic chats. The ad
   * click id itself is never exposed to the client.
   */
  ad_source_id?: string | null;
  ad_headline?: string | null;
  ad_clicked_at?: string | null;
```

- [ ] **Step 2: Add strings.** In `messages/en.json` → `Inbox.sidebar` add:

```json
"leadStage": "Lead stage",
"fromAd": "From ad: {name}",
"notFromAd": "Not from an ad — tracked internally only",
"stageQualified": "Qualified",
"stageSiteVisit": "Site visit / Quote sent",
"stageWon": "Won",
"stageConfirmTitle": "Mark as {stage}?",
"stageConfirmBody": "This is reported to Meta for this ad and can only be sent once.",
"stageConfirmBodyOrganic": "This is recorded in the app only (this chat didn't come from an ad).",
"wonValueLabel": "Deal value (QAR)",
"wonValueInvalid": "Enter a value greater than 0",
"stageConfirm": "Confirm",
"stageCancel": "Cancel",
"stageUndo": "Undo",
"stageUndoTitle": "Remove the {stage} tag?",
"stageUndoBody": "This removes the tag here only. If Meta already received the event, it will not be retracted.",
"toastStageSaved": "Tag saved",
"toastStageFailed": "Couldn't save the tag",
"toastStageUndone": "Tag removed"
```

`Inbox.conversationList` add: `"fromAdBadge": "From ad"`.

In `messages/ar.json` → `Inbox.sidebar`:

```json
"leadStage": "مرحلة العميل",
"fromAd": "من إعلان: {name}",
"notFromAd": "ليست من إعلان — تُتتبَّع داخلياً فقط",
"stageQualified": "مؤهَّل",
"stageSiteVisit": "زيارة موقع / إرسال عرض سعر",
"stageWon": "تم الفوز",
"stageConfirmTitle": "تعيين كـ {stage}؟",
"stageConfirmBody": "سيتم إبلاغ Meta بذلك لهذا الإعلان، ولا يُرسل إلا مرة واحدة.",
"stageConfirmBodyOrganic": "يُسجَّل هذا في التطبيق فقط (هذه المحادثة لم تأتِ من إعلان).",
"wonValueLabel": "قيمة الصفقة (ر.ق)",
"wonValueInvalid": "أدخل قيمة أكبر من 0",
"stageConfirm": "تأكيد",
"stageCancel": "إلغاء",
"stageUndo": "تراجع",
"stageUndoTitle": "إزالة وسم {stage}؟",
"stageUndoBody": "يزيل هذا الوسم هنا فقط. إذا كانت Meta قد استلمت الحدث بالفعل فلن يتم سحبه.",
"toastStageSaved": "تم حفظ الوسم",
"toastStageFailed": "تعذّر حفظ الوسم",
"toastStageUndone": "تمت إزالة الوسم"
```

`Inbox.conversationList` add: `"fromAdBadge": "من إعلان"`.

- [ ] **Step 3: Run the locale parity test**

Run: `npx vitest run messages/locale-parity.test.ts`
Expected: PASS.

- [ ] **Step 4: Create `src/components/inbox/conversion-stages.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Megaphone, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { RequireRole } from "@/components/auth/require-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CONVERSION_STAGES, type ConversionStage } from "@/lib/conversions/stages";
import type { Conversation } from "@/types";

interface StageRow {
  id: string;
  stage: ConversionStage;
  undone_at: string | null;
}

const STAGE_LABEL_KEY: Record<ConversionStage, string> = {
  qualified: "stageQualified",
  site_visit: "stageSiteVisit",
  won: "stageWon",
};

interface Props {
  conversation: Conversation;
  /** Bumped by the inbox when messages land -- refetch (a deal may have
   *  been marked won elsewhere). */
  refreshToken?: number;
}

/**
 * Lead-stage tagging for CTWA conversions (migration 065). Tags are sent
 * to Meta only for ad-sourced chats; organic chats are tracked in-app.
 */
export function ConversionStages({ conversation, refreshToken }: Props) {
  const t = useTranslations("Inbox.sidebar");
  const [rows, setRows] = useState<StageRow[]>([]);
  const [pending, setPending] = useState<ConversionStage | null>(null);
  const [undoing, setUndoing] = useState<StageRow | null>(null);
  const [wonValue, setWonValue] = useState("");
  const [busy, setBusy] = useState(false);

  const fromAd = !!conversation.ad_clicked_at;
  const adName = conversation.ad_headline || conversation.ad_source_id || "";

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("conversion_events")
      .select("id, stage, undone_at")
      .eq("conversation_id", conversation.id);
    setRows((data as StageRow[] | null) ?? []);
  }, [conversation.id]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const active = (stage: ConversionStage) =>
    rows.find((r) => r.stage === stage && !r.undone_at) ?? null;

  const wonNumber = Number(wonValue);
  const wonValid = wonValue.trim() !== "" && Number.isFinite(wonNumber) && wonNumber > 0;

  async function confirmTag() {
    if (!pending) return;
    if (pending === "won" && !wonValid) return;
    setBusy(true);
    const res = await fetch("/api/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversation.id,
        stage: pending,
        ...(pending === "won" ? { value: wonNumber } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? t("toastStageFailed"));
      return;
    }
    toast.success(t("toastStageSaved"));
    setPending(null);
    setWonValue("");
    void load();
  }

  async function confirmUndo() {
    if (!undoing) return;
    setBusy(true);
    const res = await fetch(`/api/conversions/${undoing.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("toastStageFailed"));
      return;
    }
    toast.success(t("toastStageUndone"));
    setUndoing(null);
    void load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Megaphone className="h-3 w-3" />
        {t("leadStage")}
      </div>

      <p className={cn("mt-2 px-1 text-xs", fromAd ? "text-foreground" : "text-muted-foreground")}>
        {fromAd ? t("fromAd", { name: adName }) : t("notFromAd")}
      </p>

      <RequireRole min="agent">
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {CONVERSION_STAGES.map((stage) => {
            const row = active(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => (row ? setUndoing(row) : setPending(stage))}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  row
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {row && <Check className="h-3 w-3" />}
                {t(STAGE_LABEL_KEY[stage])}
              </button>
            );
          })}
        </div>
      </RequireRole>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending && t("stageConfirmTitle", { stage: t(STAGE_LABEL_KEY[pending]) })}
            </DialogTitle>
            <DialogDescription>
              {fromAd ? t("stageConfirmBody") : t("stageConfirmBodyOrganic")}
            </DialogDescription>
          </DialogHeader>
          {pending === "won" && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="won-value">
                {t("wonValueLabel")}
              </label>
              <Input
                id="won-value"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={wonValue}
                onChange={(e) => setWonValue(e.target.value)}
              />
              {wonValue !== "" && !wonValid && (
                <p className="text-xs text-destructive">{t("wonValueInvalid")}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              {t("stageCancel")}
            </Button>
            <Button onClick={confirmTag} disabled={busy || (pending === "won" && !wonValid)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("stageConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={undoing !== null} onOpenChange={(open) => !open && setUndoing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {undoing && t("stageUndoTitle", { stage: t(STAGE_LABEL_KEY[undoing.stage]) })}
            </DialogTitle>
            <DialogDescription>{t("stageUndoBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndoing(null)} disabled={busy}>
              {t("stageCancel")}
            </Button>
            <Button variant="destructive" onClick={confirmUndo} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("stageUndo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Before writing, confirm `Button` supports `variant="outline"` and `variant="destructive"` in `src/components/ui/button.tsx`; if a variant name differs, use the one that file defines.

- [ ] **Step 5: Wire into the sidebar.** In `src/components/inbox/contact-sidebar.tsx`:

Add imports:

```tsx
import { ConversionStages } from "@/components/inbox/conversion-stages";
import type { Conversation } from "@/types";
```

(merge `Conversation` into the existing `import type { Contact, Deal, ContactNote, Tag } from "@/types";`).

Extend `ContactSidebarProps` with:

```tsx
  /** Active conversation -- drives the CTWA lead-stage chips. */
  conversation?: Conversation | null;
```

and destructure it: `export function ContactSidebar({ contact, conversation, refreshToken }: ContactSidebarProps)`.

Immediately before the `{/* Active Deals */}` block, insert:

```tsx
          {conversation && (
            <>
              <ConversionStages conversation={conversation} refreshToken={refreshToken} />
              <div className="my-4 border-t border-border" />
            </>
          )}
```

In `src/app/(dashboard)/inbox/page.tsx` at the `<ContactSidebar` usage (~line 647) add `conversation={activeConversation}`.

- [ ] **Step 6: Badge in the conversation list.** In `src/components/inbox/conversation-list.tsx` add `Megaphone` to the existing `lucide-react` import, and in `ConversationItem` right after the element that renders `displayName` add:

```tsx
          {conversation.ad_clicked_at && (
            <span
              title={conversation.ad_headline || conversation.ad_source_id || t("fromAdBadge")}
              aria-label={t("fromAdBadge")}
              className="inline-flex shrink-0 items-center text-primary"
            >
              <Megaphone className="h-3 w-3" />
            </span>
          )}
```

(Read the name row first and place this inside the same flex row as the name so it sits inline.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: PASS. Then start the app (`npm run dev`), open `/inbox`, pick a conversation: organic shows "Not from an ad — tracked internally only" and three chips; Qualified → confirm → chip turns active; click again → undo dialog shows the retraction note. (Use `execute_sql` to set `ad_clicked_at`/`ad_headline` on a test conversation to see the "From ad" line and list badge; revert afterward.)

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/components/inbox/conversion-stages.tsx src/components/inbox/contact-sidebar.tsx src/components/inbox/conversation-list.tsx "src/app/(dashboard)/inbox/page.tsx" messages/en.json messages/ar.json
git commit -m "Add lead-stage tagging and ad badge to the inbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pipeline "Mark won" requires a value

**Files:**
- Modify: `src/components/pipelines/deal-form.tsx` (`handleStatusChange`, ~line 223)
- Modify: `messages/en.json`, `messages/ar.json` (`Pipelines.form`)

**Interfaces:**
- Consumes: `deals_enqueue_won` trigger (Task 1) — the deal update below is what enqueues Purchase.

- [ ] **Step 1: Add strings.** `messages/en.json` → `Pipelines.form`: `"wonNeedsValue": "Enter the deal value (greater than 0) before marking it won."`. `messages/ar.json` → `Pipelines.form`: `"wonNeedsValue": "أدخل قيمة الصفقة (أكبر من 0) قبل تعيينها كفائزة."`.

- [ ] **Step 2: Replace `handleStatusChange`** with:

```tsx
  async function handleStatusChange(status: DealStatus) {
    if (!deal) return;
    // Marking won reports a Purchase to Meta for ad-sourced chats
    // (migration 065 trigger), so it needs a real value. Save the value
    // typed in the form together with the status change.
    const wonValue = parseFloat(value);
    if (status === "won" && !(wonValue > 0)) {
      toast.error(t("wonNeedsValue"));
      return;
    }
    setStatusAction(status);
    const { error } = await supabase
      .from("deals")
      .update(status === "won" ? { status, value: wonValue } : { status })
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run messages/locale-parity.test.ts`
Expected: PASS. Manually: open a deal with value 0 → "Mark as won" shows the toast and nothing changes; enter 500 → marks won.

- [ ] **Step 4: Commit**

```bash
git add src/components/pipelines/deal-form.tsx messages/en.json messages/ar.json
git commit -m "Require a deal value before marking a deal won

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ad conversions report page

**Files:**
- Create: `src/app/(dashboard)/ad-conversions/page.tsx`
- Create: `src/components/conversions/ad-conversions-report.tsx`
- Modify: `src/components/layout/sidebar.tsx` (`navItems`, ~line 93; `lucide-react` import)
- Modify: `messages/en.json`, `messages/ar.json` (`Sidebar.adConversions`, new `AdConversions` namespace)

**Interfaces:**
- Consumes: `GET /api/conversions/report` (Task 5); `adReportToCsv`, `AdReportRow`, `FailedSend` (Task 5).

- [ ] **Step 1: Add strings.** `messages/en.json`: `Sidebar.adConversions`: `"Ad conversions"`, and top-level:

```json
"AdConversions": {
  "title": "Ad conversions",
  "subtitle": "Lead quality per Click-to-WhatsApp ad, by ad click date.",
  "from": "From",
  "to": "To",
  "exportCsv": "Export CSV",
  "adColumn": "Ad ID / headline",
  "conversations": "Conversations",
  "qualified": "Qualified",
  "siteVisit": "Site visit",
  "won": "Won",
  "wonValue": "Won value (QAR)",
  "qualifiedRate": "Qualified rate",
  "empty": "No ad-sourced conversations in this range.",
  "failedTitle": "Failed sends",
  "failedEmpty": "No failed sends.",
  "stage": "Stage",
  "attempts": "Attempts",
  "lastError": "Last error",
  "lastAttempt": "Last attempt",
  "openConversation": "Open",
  "loadFailed": "Couldn't load the report",
  "adminOnly": "Only admins can view this report."
}
```

`messages/ar.json`: `Sidebar.adConversions`: `"تحويلات الإعلانات"`, and:

```json
"AdConversions": {
  "title": "تحويلات الإعلانات",
  "subtitle": "جودة العملاء لكل إعلان نقر إلى واتساب، حسب تاريخ النقر.",
  "from": "من",
  "to": "إلى",
  "exportCsv": "تصدير CSV",
  "adColumn": "معرّف الإعلان / العنوان",
  "conversations": "المحادثات",
  "qualified": "مؤهَّل",
  "siteVisit": "زيارة موقع",
  "won": "تم الفوز",
  "wonValue": "قيمة الفوز (ر.ق)",
  "qualifiedRate": "نسبة التأهيل",
  "empty": "لا توجد محادثات من إعلانات في هذه الفترة.",
  "failedTitle": "إرسالات فاشلة",
  "failedEmpty": "لا توجد إرسالات فاشلة.",
  "stage": "المرحلة",
  "attempts": "المحاولات",
  "lastError": "آخر خطأ",
  "lastAttempt": "آخر محاولة",
  "openConversation": "فتح",
  "loadFailed": "تعذّر تحميل التقرير",
  "adminOnly": "هذا التقرير متاح للمسؤولين فقط."
}
```

- [ ] **Step 2: Create `src/components/conversions/ad-conversions-report.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format, subDays } from "date-fns";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adReportToCsv, type AdReportRow, type FailedSend } from "@/lib/conversions/report";

const STAGE_KEY = { qualified: "qualified", site_visit: "siteVisit", won: "won" } as const;

export function AdConversionsReport() {
  const t = useTranslations("AdConversions");
  const [from, setFrom] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [rows, setRows] = useState<AdReportRow[]>([]);
  const [failed, setFailed] = useState<FailedSend[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/conversions/report?from=${from}&to=${to}`);
    setLoading(false);
    if (!res.ok) {
      toast.error(t("loadFailed"));
      return;
    }
    const body = (await res.json()) as { rows: AdReportRow[]; failed: FailedSend[] };
    setRows(body.rows);
    setFailed(body.failed);
  }, [from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function exportCsv() {
    const blob = new Blob([adReportToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ad-conversions_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const num = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t("from")}</span>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t("to")}</span>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="me-1 h-4 w-4" />
          {t("exportCsv")}
        </Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("adColumn")}</th>
              <th className="px-3 py-2 text-end">{t("conversations")}</th>
              <th className="px-3 py-2 text-end">{t("qualified")}</th>
              <th className="px-3 py-2 text-end">{t("siteVisit")}</th>
              <th className="px-3 py-2 text-end">{t("won")}</th>
              <th className="px-3 py-2 text-end">{t("wonValue")}</th>
              <th className="px-3 py-2 text-end">{t("qualifiedRate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ad_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.headline || r.ad_id}</div>
                    {r.headline && <div className="text-xs text-muted-foreground">{r.ad_id}</div>}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.conversations)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.qualified)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.site_visit)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.won)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.won_value)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{(r.qualified_rate * 100).toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t("failedTitle")}</h2>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("failedEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t("stage")}</th>
                  <th className="px-3 py-2 text-end">{t("attempts")}</th>
                  <th className="px-3 py-2 text-start">{t("lastError")}</th>
                  <th className="px-3 py-2 text-start">{t("lastAttempt")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-3 py-2">{t(STAGE_KEY[f.stage])}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{f.attempts}</td>
                    <td className="px-3 py-2 text-xs">{f.last_error}</td>
                    <td className="px-3 py-2 text-xs">
                      {f.last_attempt_at ? format(new Date(f.last_attempt_at), "yyyy-MM-dd HH:mm") : "—"}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Link className="text-primary hover:underline" href={`/inbox?conversation=${f.conversation_id}`}>
                        {t("openConversation")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

Before writing the "Open" link, check how `src/app/(dashboard)/inbox/page.tsx` reads a deep-linked conversation (search for `searchParams` / `useSearchParams`) and use that exact query parameter name instead of `conversation` if it differs. If the inbox has no deep link, drop the link column.

- [ ] **Step 3: Create `src/app/(dashboard)/ad-conversions/page.tsx`**

```tsx
"use client";

import { useTranslations } from "next-intl";
import { RequireRole } from "@/components/auth/require-role";
import { AdConversionsReport } from "@/components/conversions/ad-conversions-report";

export default function AdConversionsPage() {
  const t = useTranslations("AdConversions");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <RequireRole min="admin" fallback={<p className="text-sm text-muted-foreground">{t("adminOnly")}</p>}>
        <AdConversionsReport />
      </RequireRole>
    </div>
  );
}
```

- [ ] **Step 4: Add the nav item.** In `src/components/layout/sidebar.tsx` add `Megaphone` to the `lucide-react` import and insert after the pipelines entry:

```tsx
  { href: "/ad-conversions", labelKey: "adConversions", icon: Megaphone },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: PASS. Manually: `/ad-conversions` as admin shows the date filter, empty-state row, "No failed sends"; as an agent shows the admin-only message.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(dashboard)/ad-conversions" src/components/conversions src/components/layout/sidebar.tsx messages/en.json messages/ar.json
git commit -m "Add ad conversions report page with CSV export and failed sends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final verification and hand-off

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `npx vitest run && npm run typecheck && npm run lint && npm run build`
Expected: all PASS; build succeeds.

- [ ] **Step 2: End-to-end check against the database (flag off)**

With `npm run dev` running and `META_CAPI_ENABLED` unset: tag a test conversation Qualified in the inbox, then `execute_sql`:
`select stage, status, undone_at from conversion_events where conversation_id = '<id>';`
Expected: one row `qualified`, `skipped_no_clid` (organic) — no HTTP call. Undo, re-query: `undone_at` set. Clean up test rows afterwards.

- [ ] **Step 3: Report to the user** — summarize what shipped, the Meta-side setup steps (from the spec, section "Meta-side setup"), the live-test procedure (`META_TEST_EVENT_CODE` → tap a live ad → tag Qualified then Won → Events Manager → Test Events → remove the code), and that `git push` / production deploy happen only when the user asks.
