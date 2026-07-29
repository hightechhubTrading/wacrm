# Per-Agent WAHA Conversation Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a conversation is assigned to an agent who has both a WAHA session (`profiles.waha_session_name`) and a phone number (`profiles.phone`) configured, route that conversation's outbound sends and inbound messages through the agent's own WhatsApp number instead of the shared Meta number — so clients who want to call can call that agent directly — while keeping every message in one unified conversation thread, with zero AI/automation involvement.

**Architecture:** Reuses existing per-agent WAHA infrastructure (`waha_config` account-level server config, `profiles.waha_session_name` — both already power the deal-notification feature in `src/lib/pipelines/notify.ts`) rather than introducing new tables. Adds one column (`profiles.waha_webhook_secret`) and one column (`messages.channel`). A new channel-resolution helper decides Meta vs WAHA at send time; a new WAHA-specific webhook route handles inbound, sharing the same find-or-create contact/conversation logic the Meta webhook uses today (extracted into a shared module) so both channels land in one thread. Automation (AI auto-reply, Flows) is excluded from WAHA-routed conversations by construction — the new webhook route simply never calls those functions.

**Tech Stack:** Next.js App Router API routes, Supabase (Postgres + RLS + SECURITY DEFINER RPCs), TypeScript, Vitest.

## Global Constraints

- No AI auto-reply, no Flows, no bot logic of any kind touches WAHA-routed conversations (spec non-goal).
- No call logging / call visibility in the CRM (spec non-goal).
- No in-app QR pairing UI — admin pairs the WAHA session externally, same as today (spec non-goal).
- No retroactive conversation handoff between numbers (spec non-goal).
- No changes to `waha_config` (group notifications) or `contacts/tag-events.ts` (spec non-goal).
- **Scope trim from the spec, called out explicitly:** this plan ships **text messages only** over the WAHA path. The spec mentioned plain media (image/video/document/audio) as in-scope, but WAHA's exact per-media-kind endpoint contracts aren't verifiable from this codebase (the only existing WAHA send code, `sendWahaGroupText`, only covers text) and guessing at payload shapes risks shipping broken code. Media-over-WAHA is a fast-follow, not part of this plan. Flag this to the user before starting Task 5.
- Templates and interactive buttons/lists are never available on the WAHA path (Business-API-only features, not a choice).
- `conversations.assigned_agent_id` stores `profiles.user_id` (confirmed via `message-thread.tsx`'s `handleAssignChange`), NOT `profiles.id` — every lookup in this plan joins on `user_id`.

---

## Task 1: Migration — `waha_webhook_secret`, `messages.channel`, and the combined RPC

**Files:**
- Create: `supabase/migrations/053_agent_waha_conversation_channels.sql`

**Interfaces:**
- Produces: column `profiles.waha_webhook_secret TEXT` (encrypted at rest, same scheme as `waha_config.api_key`); column `messages.channel TEXT NOT NULL DEFAULT 'meta' CHECK (channel IN ('meta','waha'))`; RPC `public.set_member_waha_channel(p_user_id UUID, p_session_name TEXT, p_phone TEXT, p_new_webhook_secret TEXT) RETURNS VOID`, replacing `public.set_member_waha_session(UUID, TEXT)` (dropped — nothing else calls it, confirmed by grep).

This migration has no application code to unit-test; verification is running it against the local/dev Supabase instance and checking the resulting schema.

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 053_agent_waha_conversation_channels.sql
--
-- Extends the existing per-agent WAHA infrastructure (migration 045's
-- profiles.waha_session_name, migration 052's profiles.phone) so a
-- conversation assigned to an agent with BOTH fields set can route
-- through that agent's own WhatsApp number for real 1:1 customer
-- conversations, not just deal-notification posts.
--
-- No new table — see docs/superpowers/specs/2026-07-29-agent-waha-
-- channels-design.md for why. Only new storage: an encrypted webhook
-- secret per agent, and a channel tag on messages.
--
-- set_member_waha_channel replaces set_member_waha_session: same
-- SECURITY DEFINER shape (admin+ caller, target must share the
-- caller's account, self-targeting allowed), but sets session_name +
-- phone + webhook_secret in one call so the admin UI can save both
-- fields together. The old RPC is dropped; nothing else calls it
-- (grep confirmed only 045's own definition and the members PATCH
-- route referenced it, and the route is updated in this same change).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS waha_webhook_secret TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'meta'
  CHECK (channel IN ('meta', 'waha'));

DROP FUNCTION IF EXISTS public.set_member_waha_session(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.set_member_waha_channel(
  p_user_id UUID,
  p_session_name TEXT,
  p_phone TEXT,
  p_new_webhook_secret TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_session TEXT := NULLIF(TRIM(p_session_name), '');
BEGIN
  -- Caller must be authenticated.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Target must be in the caller's account.
  SELECT account_id INTO v_target_account_id
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id IS DISTINCT FROM v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE profiles
  SET waha_session_name = v_session,
      phone = NULLIF(TRIM(p_phone), ''),
      -- Clearing the session invalidates any existing webhook secret
      -- immediately, so a disconnected agent's old webhook URL stops
      -- authenticating. A fresh secret (passed by the caller, which
      -- generates it in Node — see the PATCH route) is only stored
      -- when explicitly provided; otherwise the existing secret is
      -- left untouched so re-saving the phone number alone doesn't
      -- invalidate an already-working webhook.
      waha_webhook_secret = CASE
        WHEN v_session IS NULL THEN NULL
        WHEN p_new_webhook_secret IS NOT NULL THEN p_new_webhook_secret
        ELSE waha_webhook_secret
      END
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_waha_channel(UUID, TEXT, TEXT, TEXT) TO authenticated;
```

- [ ] **Step 2: Apply the migration locally and verify the schema**

Run: `supabase db push` (or however this project applies local migrations — check `package.json` / README for the exact command used by the other 52 migrations before assuming `supabase db push`).

Verify:
```sql
\d profiles       -- waha_webhook_secret column present
\d messages       -- channel column present, CHECK constraint present
\df set_member_waha_channel   -- function present
\df set_member_waha_session   -- should return NOTHING (dropped)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/053_agent_waha_conversation_channels.sql
git commit -m "Add waha_webhook_secret, messages.channel, and set_member_waha_channel RPC"
```

---

## Task 2: Extract shared find-or-create helpers from the Meta webhook

**Files:**
- Create: `src/lib/contacts/find-or-create.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts` (remove the two private functions, import from the new module instead)
- Test: `src/lib/contacts/find-or-create.test.ts`

**Interfaces:**
- Consumes: `findExistingContact(db, accountId, phone)` and `isUniqueViolation(error)` from `@/lib/contacts/dedupe` (unchanged, already exported).
- Produces: `findOrCreateContact(db: SupabaseClient, accountId: string, configOwnerUserId: string, phone: string, name: string): Promise<{ contact: ContactRow; wasCreated: boolean } | null>` and `findOrCreateConversation(db: SupabaseClient, accountId: string, configOwnerUserId: string, contactId: string): Promise<{ conversation: ConversationRow; created: boolean } | null>`. Task 6 (the new WAHA webhook) consumes both by these exact names/signatures.

This is a pure refactor — same logic, same behavior, just relocated and parameterized with an explicit `db` argument (the file-private versions call a locally-scoped `supabaseAdmin()` directly; the shared version takes it as a parameter, matching the convention already used by `findExistingContact`).

- [ ] **Step 1: Write the new shared module**

```typescript
// src/lib/contacts/find-or-create.ts
//
// Find-or-create for contacts and conversations, shared by every
// inbound-message path (the Meta webhook, and the WAHA webhook added
// in a later task) so a contact/conversation created by one channel
// is indistinguishable from one created by another — this is what
// keeps a contact's Meta and WAHA messages in a single unified
// thread instead of forking a conversation per channel.
//
// Extracted from src/app/api/whatsapp/webhook/route.ts (issue: WAHA
// per-agent conversation channels) — same logic, parameterized with
// an explicit `db` client instead of a file-local supabaseAdmin().

import type { SupabaseClient } from '@supabase/supabase-js';
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConversationRow = any;

export interface ContactOutcome {
  contact: ContactRow;
  /** True when this call created the row. */
  wasCreated: boolean;
}

export interface ConversationOutcome {
  conversation: ConversationRow;
  created: boolean;
}

export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(db, accountId, phone);

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(db, accountId, phone);
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error('Error creating contact:', createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

export async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<ConversationOutcome | null> {
  const { data: existingRows, error: findError } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (findError) {
    console.error('Error finding conversation:', findError);
    return null;
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false };
  }

  const { data: newConv, error: createError } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false };
      }
    }
    console.error('Error creating conversation:', createError);
    return null;
  }

  return { conversation: newConv, created: true };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/lib/contacts/find-or-create.test.ts
import { describe, it, expect, vi } from 'vitest';
import { findOrCreateContact, findOrCreateConversation } from './find-or-create';

function makeDb(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      calls.push({ table });
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        like: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(overrides[`${table}.limit`] ?? { data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          calls.push({ table, insert: row });
          return builder;
        },
        update: () => builder,
        single: () => Promise.resolve(overrides[`${table}.single`] ?? { data: null, error: null }),
      };
      return builder;
    },
  };
  return { db: db as unknown as import('@supabase/supabase-js').SupabaseClient, calls };
}

describe('findOrCreateContact', () => {
  it('creates a new contact when none exists', async () => {
    const { db } = makeDb({
      'contacts.limit': { data: [], error: null }, // findExistingContact's .like() query
      'contacts.single': {
        data: { id: 'contact-1', phone: '+15551234567', name: 'Jane' },
        error: null,
      },
    });

    const result = await findOrCreateContact(
      db,
      'acct-1',
      'owner-1',
      '+15551234567',
      'Jane',
    );

    expect(result).not.toBeNull();
    expect(result!.wasCreated).toBe(true);
    expect(result!.contact.id).toBe('contact-1');
  });
});

describe('findOrCreateConversation', () => {
  it('creates a new conversation when none exists', async () => {
    const { db } = makeDb({
      'conversations.limit': { data: [], error: null },
      'conversations.single': {
        data: { id: 'conv-1', contact_id: 'contact-1' },
        error: null,
      },
    });

    const result = await findOrCreateConversation(db, 'acct-1', 'owner-1', 'contact-1');

    expect(result).not.toBeNull();
    expect(result!.created).toBe(true);
    expect(result!.conversation.id).toBe('conv-1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/contacts/find-or-create.test.ts`
Expected: FAIL — `Cannot find module './find-or-create'` (file doesn't exist as a test target yet if you wrote the test first; if you wrote the module in Step 1 already, this step instead confirms the mock wiring is right by intentionally breaking one assertion, then fixing it in Step 4). Since Step 1 already wrote the real implementation, run the test now expecting a PASS instead — if so, skip ahead; if the mock's `.like()`/`.limit()` chain doesn't match what `findExistingContact` (in `dedupe.ts`) actually calls, this is where that mismatch surfaces. Adjust the mock's chain (not the implementation) until it passes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/contacts/find-or-create.test.ts`
Expected: PASS

- [ ] **Step 5: Update the Meta webhook to use the shared module**

In `src/app/api/whatsapp/webhook/route.ts`:
1. Delete the private `findOrCreateContact` and `findOrCreateConversation` functions (lines ~1044–1183, including the `ContactRow`/`ContactOutcome` local types).
2. Add to the import block at the top:
```typescript
import { findOrCreateContact, findOrCreateConversation } from '@/lib/contacts/find-or-create'
```
3. Every existing call site in this file already calls `findOrCreateContact(accountId, configOwnerUserId, phone, name)` and `findOrCreateConversation(accountId, configOwnerUserId, contactId)` — update each call site to pass the file's local `supabaseAdmin()` as the first argument, e.g. `findOrCreateContact(supabaseAdmin(), accountId, configOwnerUserId, phone, name)`.

- [ ] **Step 6: Run the existing webhook test suite to confirm no regression**

Run: `npx vitest run src/app/api/whatsapp/webhook`
Expected: PASS (same pass count as before this change — this step must not change webhook behavior, only where the code lives)

- [ ] **Step 7: Commit**

```bash
git add src/lib/contacts/find-or-create.ts src/lib/contacts/find-or-create.test.ts src/app/api/whatsapp/webhook/route.ts
git commit -m "Extract find-or-create contact/conversation helpers into a shared module"
```

---

## Task 3: Individual-chat WAHA text send

**Files:**
- Modify: `src/lib/notifications/waha-client.ts`
- Test: `src/lib/notifications/waha-client.test.ts`

**Interfaces:**
- Produces: `sendWahaIndividualText(args: { baseUrl: string; apiKey: string; session: string; toPhone: string; text: string; timeoutMs?: number }): Promise<{ ok: true; messageId?: string } | never>` — **throws** `WahaSendError` on any failure (network, non-2xx, timeout). This is the opposite failure mode from `sendWahaGroupText` (which never throws) — Task 5 relies on the throw to surface a clear error to the agent instead of silently dropping a customer reply.
- Consumes: nothing new (same `fetch`-based approach as `sendWahaGroupText` in the same file).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/lib/notifications/waha-client.test.ts, alongside the existing describe block

import { sendWahaIndividualText, WahaSendError } from './waha-client'

describe('sendWahaIndividualText', () => {
  const args = {
    baseUrl: 'https://waha.example.com',
    apiKey: 'secret-key',
    session: 'sarah-agent',
    toPhone: '+15551234567',
    text: 'Hi, this is Sarah!',
  }

  it('posts to /api/sendText with an individual @c.us chatId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWahaIndividualText(args)

    expect(result.ok).toBe(true)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://waha.example.com/api/sendText')
    expect(opts.headers['X-Api-Key']).toBe('secret-key')
    expect(JSON.parse(opts.body)).toEqual({
      session: 'sarah-agent',
      chatId: '15551234567@c.us',
      text: 'Hi, this is Sarah!',
    })
  })

  it('throws WahaSendError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve('session not connected'),
      } as unknown as Response),
    )

    await expect(sendWahaIndividualText(args)).rejects.toThrow(WahaSendError)
    await expect(sendWahaIndividualText(args)).rejects.toThrow(/422/)
  })

  it('throws WahaSendError on a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')))

    await expect(sendWahaIndividualText(args)).rejects.toThrow(WahaSendError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/waha-client.test.ts`
Expected: FAIL with "sendWahaIndividualText is not a function" / "WahaSendError is not exported"

- [ ] **Step 3: Write the implementation**

Add to `src/lib/notifications/waha-client.ts`, below the existing `sendWahaGroupText`:

```typescript
/**
 * Thrown by `sendWahaIndividualText` on any failure. Unlike
 * `sendWahaGroupText` (deliberately fire-and-forget — a best-effort
 * internal notification must never block a deal move), this is the
 * PRIMARY customer channel for a WAHA-routed conversation, so a
 * failure must surface to the caller rather than vanish silently.
 */
export class WahaSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WahaSendError';
  }
}

export interface SendWahaIndividualTextArgs {
  baseUrl: string;
  apiKey: string;
  session: string;
  /** Any phone format; digits are extracted and used as the WhatsApp
   *  individual-chat id (`<digits>@c.us`). */
  toPhone: string;
  text: string;
  timeoutMs?: number;
}

export interface SendWahaIndividualTextResult {
  ok: true;
}

/**
 * Send a plain-text message to an individual WhatsApp chat (as
 * opposed to `sendWahaGroupText`'s group `chatId`), from the given
 * agent's own WAHA `session`. Throws `WahaSendError` on any failure —
 * see the class doc above for why this differs from the group-text
 * helper's never-throws contract.
 */
export async function sendWahaIndividualText(
  args: SendWahaIndividualTextArgs,
): Promise<SendWahaIndividualTextResult> {
  const { baseUrl, apiKey, session, toPhone, text, timeoutMs } = args;

  const digits = toPhone.replace(/\D/g, '');
  const chatId = `${digits}@c.us`;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/sendText`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ session, chatId, text }),
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    throw new WahaSendError(`WAHA request failed: ${message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new WahaSendError(
      `WAHA returned ${res.status}${body ? `: ${body.slice(0, 300)}` : ''}`,
    );
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/waha-client.test.ts`
Expected: PASS (all tests, including the pre-existing `sendWahaGroupText` ones)

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/waha-client.ts src/lib/notifications/waha-client.test.ts
git commit -m "Add sendWahaIndividualText for per-agent 1:1 conversation sends"
```

---

## Task 4: Channel-resolution helper

**Files:**
- Create: `src/lib/whatsapp/resolve-agent-channel.ts`
- Test: `src/lib/whatsapp/resolve-agent-channel.test.ts`

**Interfaces:**
- Produces: `resolveAgentWahaChannel(db: SupabaseClient, accountId: string, assignedAgentUserId: string | null): Promise<AgentWahaChannel | null>` where `AgentWahaChannel = { baseUrl: string; apiKey: string; session: string; agentPhone: string }` (`apiKey` already decrypted). Task 5 and Task 6 both consume this exact function/shape.
- Consumes: `decrypt` from `@/lib/whatsapp/encryption` (existing).

Resolution rule: returns non-null only when (a) `assignedAgentUserId` is set, (b) that profile has both `waha_session_name` and `phone` non-empty, AND (c) the account's `waha_config` row exists, is active, and has `base_url`/`api_key`. Any missing piece → `null` (caller falls back to Meta).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/whatsapp/resolve-agent-channel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveAgentWahaChannel } from './resolve-agent-channel';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace('enc:', ''),
}));

function makeDb(rows: { profile?: unknown; wahaConfig?: unknown }) {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () =>
          Promise.resolve(
            table === 'profiles'
              ? { data: rows.profile ?? null, error: null }
              : { data: rows.wahaConfig ?? null, error: null },
          ),
      };
      return builder;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('resolveAgentWahaChannel', () => {
  it('returns null when no agent is assigned', async () => {
    const db = makeDb({});
    expect(await resolveAgentWahaChannel(db, 'acct-1', null)).toBeNull();
  });

  it('returns null when the assigned agent has no session or phone', async () => {
    const db = makeDb({ profile: { waha_session_name: null, phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when the agent has a session but no phone', async () => {
    const db = makeDb({ profile: { waha_session_name: 'sarah-agent', phone: null } });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns null when waha_config is missing or inactive', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: 'enc:key', is_active: false },
    });
    expect(await resolveAgentWahaChannel(db, 'acct-1', 'user-1')).toBeNull();
  });

  it('returns the resolved channel when everything is configured', async () => {
    const db = makeDb({
      profile: { waha_session_name: 'sarah-agent', phone: '+15551234567' },
      wahaConfig: { base_url: 'https://waha.example.com', api_key: 'enc:key', is_active: true },
    });
    const result = await resolveAgentWahaChannel(db, 'acct-1', 'user-1');
    expect(result).toEqual({
      baseUrl: 'https://waha.example.com',
      apiKey: 'key',
      session: 'sarah-agent',
      agentPhone: '+15551234567',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/whatsapp/resolve-agent-channel.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/whatsapp/resolve-agent-channel.ts
//
// Decides whether a conversation's messages should route through its
// assigned agent's own WAHA session instead of the account's shared
// Meta number. Both send-message.ts (outbound) and the WAHA inbound
// webhook (Task 6) use this to agree on the same resolution rule.

import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';

export interface AgentWahaChannel {
  baseUrl: string;
  apiKey: string;
  session: string;
  agentPhone: string;
}

/**
 * Resolves to the agent's WAHA channel only when EVERY piece is in
 * place: an assigned agent, that agent's `waha_session_name` AND
 * `phone` both set, and the account's `waha_config` active with a
 * base_url/api_key. Any gap falls back to `null` — callers then use
 * the account's normal Meta path, unchanged.
 */
export async function resolveAgentWahaChannel(
  db: SupabaseClient,
  accountId: string,
  assignedAgentUserId: string | null,
): Promise<AgentWahaChannel | null> {
  if (!assignedAgentUserId) return null;

  const { data: profile } = await db
    .from('profiles')
    .select('waha_session_name, phone')
    .eq('account_id', accountId)
    .eq('user_id', assignedAgentUserId)
    .maybeSingle();

  const session = profile?.waha_session_name?.trim();
  const agentPhone = profile?.phone?.trim();
  if (!session || !agentPhone) return null;

  const { data: config } = await db
    .from('waha_config')
    .select('base_url, api_key, is_active')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!config || !config.is_active || !config.base_url || !config.api_key) {
    return null;
  }

  return {
    baseUrl: config.base_url,
    apiKey: decrypt(config.api_key),
    session,
    agentPhone,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/whatsapp/resolve-agent-channel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/resolve-agent-channel.ts src/lib/whatsapp/resolve-agent-channel.test.ts
git commit -m "Add resolveAgentWahaChannel channel-resolution helper"
```

---

## Task 5: Route outbound sends through the resolved channel

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Test: `src/lib/whatsapp/send-message.test.ts` (existing file — add new cases)

**Interfaces:**
- Consumes: `resolveAgentWahaChannel` (Task 4), `sendWahaIndividualText`/`WahaSendError` (Task 3).
- Produces: no new exports — `sendMessageToConversation`'s behavior gains a branch; its existing signature and `SendMessageResult` shape are unchanged.

Before writing code: this task only sends **text**. If `messageType !== 'text'` and the resolved channel is WAHA, throw a clear `SendMessageError('waha_unsupported_type', ...)` rather than silently falling back to Meta (falling back would send from the wrong number without the agent realizing it) or attempting an unverified media call (see the Global Constraints scope trim).

- [ ] **Step 1: Write the failing test**

```typescript
// Add to src/lib/whatsapp/send-message.test.ts — check the existing file's
// mock-building helper first and reuse it rather than re-deriving a new
// mock shape; the sketch below shows the shape of the case to add,
// adjust variable/helper names to match whatever the existing file
// already uses for its Supabase mock and vi.mock('@/lib/notifications/waha-client', ...).

vi.mock('@/lib/notifications/waha-client', () => ({
  sendWahaIndividualText: vi.fn(),
  WahaSendError: class WahaSendError extends Error {},
}));

it('routes to WAHA when the conversation is assigned to an agent with a connected channel', async () => {
  const { sendWahaIndividualText } = await import('@/lib/notifications/waha-client');
  (sendWahaIndividualText as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

  // Arrange the Supabase mock so:
  //   conversations row has assigned_agent_id: 'agent-user-1'
  //   profiles row for agent-user-1 has waha_session_name + phone set
  //   waha_config row is_active with base_url/api_key
  // (fill in using this file's existing mock-building conventions)

  const result = await sendMessageToConversation(db, 'acct-1', {
    conversationId: 'conv-1',
    messageType: 'text',
    contentText: 'Hi, this is Sarah!',
  });

  expect(sendWahaIndividualText).toHaveBeenCalledWith(
    expect.objectContaining({ session: 'sarah-agent', toPhone: expect.any(String) }),
  );
  expect(result.messageId).toBeDefined();
  // Assert the persisted messages.insert call included channel: 'waha'
});

it('rejects a non-text message type when routed to WAHA', async () => {
  // Same WAHA-resolved conversation setup as above.
  await expect(
    sendMessageToConversation(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'template',
      templateName: 'some_template',
    }),
  ).rejects.toThrow(/not supported/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: FAIL — current code always goes through the Meta path, so `sendWahaIndividualText` is never called

- [ ] **Step 3: Implement the branch**

In `src/lib/whatsapp/send-message.ts`:

1. Add imports:
```typescript
import { resolveAgentWahaChannel } from '@/lib/whatsapp/resolve-agent-channel';
import { sendWahaIndividualText, WahaSendError } from '@/lib/notifications/waha-client';
```

2. Immediately after the existing conversation+contact load (right after the `if (convError || !conversation)` block, before the `whatsapp_config` load), insert:
```typescript
  const wahaChannel = await resolveAgentWahaChannel(
    db,
    accountId,
    conversation.assigned_agent_id ?? null,
  );

  if (wahaChannel) {
    if (messageType !== 'text') {
      throw new SendMessageError(
        'waha_unsupported_type',
        `This conversation is routed through ${wahaChannel.agentPhone}'s WhatsApp number, which only supports plain text messages (no ${messageType}).`,
        400,
      );
    }

    let waMessageId = '';
    try {
      await sendWahaIndividualText({
        baseUrl: wahaChannel.baseUrl,
        apiKey: wahaChannel.apiKey,
        session: wahaChannel.session,
        toPhone: sanitizedPhone,
        text: contentText!,
      });
    } catch (err) {
      if (err instanceof WahaSendError) {
        throw new SendMessageError(
          'waha_error',
          `Failed to send from ${wahaChannel.agentPhone}'s WhatsApp — reconnect the agent's session in Settings → Members, or reassign the conversation. (${err.message})`,
          502,
        );
      }
      throw err;
    }

    const { data: messageRecord, error: msgError } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: contentText,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
        channel: 'waha',
      })
      .select()
      .single();

    if (msgError) {
      throw new SendMessageError(
        'db_error',
        `Message sent via WAHA but failed to save to DB: ${msgError.message}`,
        500,
      );
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
  }
```

Note `sanitizedPhone` is computed a few lines below this insertion point in the current file (from `contact.phone`) — move that computation (and its `isValidE164` check) above this new block so it's available here too; the Meta path below already needs it unchanged.

3. Every `messages.insert(...)` call in the existing Meta path (there's one, further down) needs `channel: 'meta'` added explicitly — the column defaults to `'meta'` so this isn't strictly required for correctness, but add it anyway so the field is never ambiguous by omission at a call site a future reader might copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: PASS, including every pre-existing test in the file (the Meta path must be completely unaffected for conversations with no resolved WAHA channel)

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.test.ts
git commit -m "Route outbound text sends through the assigned agent's WAHA channel when connected"
```

---

## Task 6: Inbound WAHA webhook

**Files:**
- Create: `src/app/api/waha/webhook/[accountId]/[sessionName]/route.ts`
- Test: `src/app/api/waha/webhook/[accountId]/[sessionName]/route.test.ts`

**Interfaces:**
- Consumes: `findOrCreateContact`, `findOrCreateConversation` (Task 2); `decrypt` from `@/lib/whatsapp/encryption`; `supabaseAdmin` from `@/lib/flows/admin-client`.
- Produces: `POST` handler at this route. No other module imports from this file.

WAHA's inbound webhook payload shape (per its published API — verify against the actual deployed WAHA version during the manual end-to-end pass in Task 9, since this is the one piece of this plan not directly verifiable from code already in this repo):
```json
{
  "event": "message",
  "session": "sarah-agent",
  "payload": {
    "id": "true_123@c.us_ABCDEF",
    "timestamp": 1699999999,
    "from": "15551234567@c.us",
    "fromMe": false,
    "body": "Hello",
    "hasMedia": false
  }
}
```
This handler only processes `event === "message"` with `fromMe === false` — everything else (status updates, `fromMe: true` echoes of the agent's own sends, group messages) is ignored.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/waha/webhook/[accountId]/[sessionName]/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const messageInserts: Record<string, unknown>[] = [];
const conversationUpdates: Record<string, unknown>[] = [];

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => {
          if (table === 'profiles') {
            return Promise.resolve({
              data: {
                user_id: 'agent-user-1',
                waha_webhook_secret: 'enc:correct-secret',
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        like: () => builder,
        order: () => builder,
        limit: () =>
          table === 'contacts'
            ? Promise.resolve({ data: [], error: null })
            : Promise.resolve({ data: [], error: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') messageInserts.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data:
                    table === 'contacts'
                      ? { id: 'contact-1', phone: '+15551234567', name: '+15551234567' }
                      : table === 'conversations'
                        ? { id: 'conv-1', contact_id: 'contact-1' }
                        : { id: 'msg-1' },
                  error: null,
                }),
            }),
          };
        },
        update: (patch: Record<string, unknown>) => {
          if (table === 'conversations') conversationUpdates.push(patch);
          return builder;
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace('enc:', ''),
}));

import { POST } from './route';

beforeEach(() => {
  messageInserts.length = 0;
  conversationUpdates.length = 0;
});

function makeRequest(secret: string, body: unknown) {
  return new Request(
    `http://localhost/api/waha/webhook/acct-1/sarah-agent?secret=${secret}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

describe('POST /api/waha/webhook/[accountId]/[sessionName]', () => {
  it('rejects a request with the wrong secret', async () => {
    const res = await POST(makeRequest('wrong-secret', {}), {
      params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }),
    });
    expect(res.status).toBe(404);
    expect(messageInserts).toHaveLength(0);
  });

  it('inserts a customer message with channel=waha for an inbound text event', async () => {
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: {
          id: 'true_15551234567@c.us_ABC',
          timestamp: 1699999999,
          from: '15551234567@c.us',
          fromMe: false,
          body: 'Hello!',
          hasMedia: false,
        },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );

    expect(res.status).toBe(200);
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      sender_type: 'customer',
      channel: 'waha',
      content_text: 'Hello!',
    });
    expect(conversationUpdates).toHaveLength(1);
  });

  it('ignores an echo of the agent\'s own outbound message (fromMe: true)', async () => {
    const res = await POST(
      makeRequest('correct-secret', {
        event: 'message',
        session: 'sarah-agent',
        payload: { id: 'x', timestamp: 1699999999, from: '15551234567@c.us', fromMe: true, body: 'hi' },
      }),
      { params: Promise.resolve({ accountId: 'acct-1', sessionName: 'sarah-agent' }) },
    );
    expect(res.status).toBe(200);
    expect(messageInserts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/waha/webhook/[accountId]/[sessionName]/route.test.ts"`
Expected: FAIL — route module doesn't exist yet

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/waha/webhook/[accountId]/[sessionName]/route.ts
//
// Inbound webhook for an agent's own WAHA session — the counterpart
// to the Meta webhook, but for real 1:1 customer conversations routed
// through a specific agent's number (see docs/superpowers/specs/
// 2026-07-29-agent-waha-channels-design.md).
//
// Deliberately narrow: text messages only, no read receipts, no
// reactions, no status events (those stay Meta-only). And crucially,
// this handler never imports runAutomationsForTrigger,
// dispatchInboundToFlows, or dispatchInboundToAiReply — WAHA-routed
// conversations get zero bot involvement BY CONSTRUCTION, not by a
// conditional flag.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  findOrCreateContact,
  findOrCreateConversation,
} from '@/lib/contacts/find-or-create';

interface WahaWebhookPayload {
  event?: string;
  session?: string;
  payload?: {
    id?: string;
    timestamp?: number;
    from?: string;
    fromMe?: boolean;
    body?: string;
    hasMedia?: boolean;
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ accountId: string; sessionName: string }> },
) {
  const { accountId, sessionName } = await params;
  const secret = new URL(request.url).searchParams.get('secret');

  if (!secret) {
    return NextResponse.json({ error: 'Missing secret' }, { status: 404 });
  }

  const db = supabaseAdmin();

  const { data: agentProfile, error: profileError } = await db
    .from('profiles')
    .select('user_id, waha_webhook_secret')
    .eq('account_id', accountId)
    .eq('waha_session_name', sessionName)
    .maybeSingle();

  if (profileError || !agentProfile || !agentProfile.waha_webhook_secret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let expectedSecret: string;
  try {
    expectedSecret = decrypt(agentProfile.waha_webhook_secret);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as WahaWebhookPayload | null;
  if (!body || body.event !== 'message' || !body.payload) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const { payload } = body;
  if (payload.fromMe) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  const fromDigits = (payload.from ?? '').replace(/\D/g, '');
  if (!fromDigits) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }
  const phone = `+${fromDigits}`;

  const contactOutcome = await findOrCreateContact(
    db,
    accountId,
    agentProfile.user_id,
    phone,
    phone,
  );
  if (!contactOutcome) {
    return NextResponse.json({ error: 'Failed to resolve contact' }, { status: 500 });
  }

  const conversationOutcome = await findOrCreateConversation(
    db,
    accountId,
    agentProfile.user_id,
    contactOutcome.contact.id,
  );
  if (!conversationOutcome) {
    return NextResponse.json({ error: 'Failed to resolve conversation' }, { status: 500 });
  }

  const contentText = payload.body ?? (payload.hasMedia ? '[media]' : '');

  const { error: msgError } = await db.from('messages').insert({
    conversation_id: conversationOutcome.conversation.id,
    sender_type: 'customer',
    content_type: 'text',
    content_text: contentText,
    message_id: payload.id ?? null,
    status: 'delivered',
    channel: 'waha',
    created_at: payload.timestamp
      ? new Date(payload.timestamp * 1000).toISOString()
      : new Date().toISOString(),
  });

  if (msgError) {
    console.error('[waha webhook] error inserting message:', msgError);
    return NextResponse.json({ error: 'Failed to store message' }, { status: 500 });
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText,
      last_message_at: new Date().toISOString(),
      unread_count: (conversationOutcome.conversation.unread_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationOutcome.conversation.id);

  return NextResponse.json({ status: 'received' }, { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/waha/webhook/[accountId]/[sessionName]/route.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/waha/webhook/[accountId]/[sessionName]/route.ts" "src/app/api/waha/webhook/[accountId]/[sessionName]/route.test.ts"
git commit -m "Add inbound WAHA webhook for per-agent conversation channels"
```

---

## Task 7: Extend the members API (phone + webhook secret)

**Files:**
- Modify: `src/app/api/account/members/route.ts`
- Modify: `src/app/api/account/members/[userId]/route.ts`
- Test: check for existing test files for these two routes (`route.test.ts` alongside each) and add cases there; if none exist, this task doesn't need to invent a suite from scratch — verify manually via Step 4 below instead of adding a first-ever test file for routes that currently have none (don't introduce an inconsistent testing precedent as a side effect of this task).

**Interfaces:**
- Produces: `GET /api/account/members` response now includes `phone: string | null` per member (same admin+-only visibility tier as `waha_session_name`). `PATCH /api/account/members/[userId]` now accepts `phone` alongside `role`/`waha_session_name`, and when a session is newly connected (webhook secret didn't exist before, does now), the response includes `webhook_url: string` — shown once.

- [ ] **Step 1: Check for existing route tests**

Run: `find "src/app/api/account/members" -name "*.test.ts"`
If files exist, read them to match their mocking conventions before writing new cases in Step 6. If none exist, proceed straight to implementation (Steps 2–5) and verify manually (Step 7).

- [ ] **Step 2: Update the GET route**

In `src/app/api/account/members/route.ts`:

1. Add `phone` to the `ProfileRow` interface and the `.select(...)` string:
```typescript
interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  waha_session_name: string | null;
  phone: string | null;
}
```
```typescript
.select(
  "user_id, full_name, email, avatar_url, account_role, created_at, waha_session_name, phone",
)
```
2. Add `phone` to the mapped `AccountMember`, same visibility gate as `waha_session_name`:
```typescript
waha_session_name: canSeeEmails ? row.waha_session_name : null,
phone: canSeeEmails ? row.phone : null,
```

- [ ] **Step 3: Update the PATCH route**

In `src/app/api/account/members/[userId]/route.ts`:

1. Add imports:
```typescript
import crypto from "crypto";
import { encrypt } from "@/lib/whatsapp/encryption";
```
2. Replace the body-type union and the `wahaProvided` block:
```typescript
    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; waha_session_name?: unknown; phone?: unknown }
      | null;

    const roleProvided = body !== null && "role" in body;
    const wahaProvided = body !== null && "waha_session_name" in body;
    const phoneProvided = body !== null && "phone" in body;
```
3. Replace the existing `if (wahaProvided) { ... }` block entirely with:
```typescript
    let webhookUrlForResponse: string | null = null;

    if (wahaProvided || phoneProvided) {
      let sessionRaw: unknown;
      let phoneRaw: unknown;

      if (wahaProvided) {
        sessionRaw = body!.waha_session_name;
        if (sessionRaw !== null && typeof sessionRaw !== "string") {
          return NextResponse.json(
            { error: "'waha_session_name' must be a string or null" },
            { status: 400 },
          );
        }
      }
      if (phoneProvided) {
        phoneRaw = body!.phone;
        if (phoneRaw !== null && typeof phoneRaw !== "string") {
          return NextResponse.json(
            { error: "'phone' must be a string or null" },
            { status: 400 },
          );
        }
      }

      const { data: current, error: currentError } = await ctx.supabase
        .from("profiles")
        .select("waha_session_name, phone, waha_webhook_secret")
        .eq("user_id", userId)
        .maybeSingle();

      if (currentError || !current) {
        return NextResponse.json({ error: "Target user not found" }, { status: 404 });
      }

      const finalSession = wahaProvided
        ? typeof sessionRaw === "string"
          ? sessionRaw.trim().slice(0, 100)
          : ""
        : (current.waha_session_name ?? "");
      const finalPhone = phoneProvided
        ? typeof phoneRaw === "string"
          ? phoneRaw.trim().slice(0, 32)
          : ""
        : (current.phone ?? "");

      let newSecretPlain: string | null = null;
      let newSecretEncrypted: string | null = null;
      if (finalSession && !current.waha_webhook_secret) {
        newSecretPlain = crypto.randomBytes(24).toString("hex");
        newSecretEncrypted = encrypt(newSecretPlain);
      }

      const { error } = await ctx.supabase.rpc("set_member_waha_channel", {
        p_user_id: userId,
        p_session_name: finalSession,
        p_phone: finalPhone,
        p_new_webhook_secret: newSecretEncrypted,
      });

      if (error) return rpcErrorToResponse(error);

      if (newSecretPlain && finalSession) {
        const base = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "") ?? "";
        webhookUrlForResponse = `${base}/api/waha/webhook/${ctx.account.id}/${encodeURIComponent(finalSession)}?secret=${newSecretPlain}`;
      }
    }
```
4. Update the final success response to include the URL when present:
```typescript
    return NextResponse.json({
      ok: true,
      ...(webhookUrlForResponse ? { webhook_url: webhookUrlForResponse } : {}),
    });
```
5. Update the doc comment at the top of the file (currently says "change a member's role and/or WAHA session name") to also mention phone, and update the RPC-name reference from `set_member_waha_session` to `set_member_waha_channel`.

- [ ] **Step 4: Manually verify against a local dev server**

Run the dev server (`npm run dev` or however this project runs locally), sign in as an admin, and:
1. `GET /api/account/members` — confirm the response now includes a `phone` field per member.
2. `PATCH /api/account/members/<some-user-id>` with `{"waha_session_name": "test-session", "phone": "+15551234567"}` — confirm `200` with a `webhook_url` in the response.
3. Repeat the same PATCH — confirm `webhook_url` is **absent** the second time (secret only generated once, not regenerated on every save).
4. `PATCH` with `{"waha_session_name": null}` — confirm success, then check the `profiles` row directly (`select waha_webhook_secret from profiles where user_id = ...`) to confirm the secret was cleared.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/account/members/route.ts "src/app/api/account/members/[userId]/route.ts"
git commit -m "Extend members API with phone + WAHA webhook secret generation"
```

---

## Task 8: Type updates

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `AccountMember.phone: string | null`; `Message.channel: 'meta' | 'waha'`.

- [ ] **Step 1: Add `phone` to `AccountMember`**

```typescript
export interface AccountMember {
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  role: AccountRole;
  joined_at: string;
  /** Same admin+-only visibility tier as `email` — see `waha_session_name`
   *  on `Profile` for what this drives (migration 045). */
  waha_session_name: string | null;
  /** The agent's own number (`profiles.phone`, migration 052) — needed
   *  alongside `waha_session_name` to route a conversation through this
   *  agent's WAHA channel (migration 053). Same visibility tier. */
  phone: string | null;
}
```

- [ ] **Step 2: Add `channel` to `Message`**

```typescript
export interface Message {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id?: string;
  content_type: ContentType;
  content_text?: string;
  media_url?: string;
  template_name?: string;
  message_id?: string;
  status: MessageStatus;
  created_at: string;
  reply_to_message_id?: string;
  /** Which line this message went out/came in on (migration 053).
   *  Defaults to 'meta'; 'waha' when routed through an assigned
   *  agent's own connected WhatsApp number. */
  channel: 'meta' | 'waha';
  interactive_reply_id?: string;
  // ...rest of the interface unchanged
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. If any call site constructs a `Message` object literal without `channel` (e.g. in a test fixture), add `channel: 'meta'` there.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "Add phone to AccountMember and channel to Message types"
```

---

## Task 9: Members-tab UI — phone number + webhook URL

**Files:**
- Modify: `src/components/settings/members-tab.tsx`

**Interfaces:**
- Consumes: `PATCH /api/account/members/[userId]` (Task 7) — now also send `phone` and read `webhook_url` from the response.

- [ ] **Step 1: Add `phone` to the local `Member` type and fetch**

Find the `Member` interface in this file (referenced at line ~90 for `waha_session_name`) and add:
```typescript
phone: string | null;
```
Confirm the member-fetching code (`GET /api/account/members`) already returns it after Task 7 — no fetch-logic change needed, just the type.

- [ ] **Step 2: Add a phone input next to the session-name input**

Find the existing session-name `Input` block (~line 476–487, inside `{canManageMembers && (...)}`). Add a sibling `Input` right after it:

```tsx
{canManageMembers && (
  <Input
    key={`${member.user_id}-waha-phone-${member.phone ?? ''}`}
    defaultValue={member.phone ?? ''}
    placeholder={t('wahaPhonePlaceholder')}
    disabled={isBusy}
    onBlur={(e) => handleWahaPhoneChange(member, e.target.value)}
    className="w-32 bg-muted border-border text-foreground text-xs"
  />
)}
```

- [ ] **Step 3: Add the `handleWahaPhoneChange` handler**

Find the existing `handleWahaSessionChange` function in this file and add a sibling right after it, following the exact same optimistic-update-then-revert-on-error pattern (reuse that function's structure — same `pendingMemberAction`, same toast-on-error, same PATCH call — just swapping the field name and adding the webhook-URL toast):

```typescript
const handleWahaPhoneChange = useCallback(
  async (member: Member, rawValue: string) => {
    const nextValue = rawValue.trim() || null;
    if ((member.phone ?? null) === nextValue) return;

    const previousValue = member.phone;
    setPendingMemberAction(member.user_id);
    setMembers((prev) =>
      prev.map((m) => (m.user_id === member.user_id ? { ...m, phone: nextValue } : m)),
    );

    try {
      const res = await fetch(`/api/account/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: nextValue }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      if (payload.webhook_url) {
        toast.success(t('wahaWebhookUrlReady'), {
          description: payload.webhook_url,
          duration: 15000,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      toast.error(`${t('wahaPhoneUpdateFailed')}: ${reason}`);
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === member.user_id ? { ...m, phone: previousValue } : m,
        ),
      );
    } finally {
      setPendingMemberAction(null);
    }
  },
  [t],
);
```

Adjust to match this file's exact existing `handleWahaSessionChange` implementation once you have it open — the sketch above assumes the same `setMembers`/`setPendingMemberAction`/`toast` calls that function already uses; copy its exact revert-on-error structure rather than reinventing it.

- [ ] **Step 4: Add translation keys**

Find this component's translation namespace (`useTranslations` call at the top of the file) and the corresponding message file(s) under wherever `wahaSessionPlaceholder` is currently defined (search the i18n message JSON files for `"wahaSessionPlaceholder"` to find the right file/locale). Add sibling keys: `wahaPhonePlaceholder`, `wahaWebhookUrlReady`, `wahaPhoneUpdateFailed`, with reasonable English copy (e.g. "Agent's phone" / "Webhook URL ready — copy it into this session's WAHA webhook config:" / "Failed to update phone").

- [ ] **Step 5: Manually verify in the browser**

Run the dev server, open Settings → Members as an admin, set a session name + phone for a test member, confirm the "webhook URL ready" toast appears with a URL matching `/api/waha/webhook/<accountId>/<session>?secret=...`, and confirm reloading the page shows the persisted phone value.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/members-tab.tsx
git commit -m "Add phone number input and webhook URL reveal to the members tab"
```

(If translation files were touched, add them to this commit too.)

---

## Task 10: Composer — hide template/interactive on WAHA-routed conversations

**Files:**
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-thread.tsx`

**Interfaces:**
- Consumes: nothing new at the type level — `message-thread.tsx` already fetches `profiles` with `.select("*")`, which already includes `waha_session_name` and `phone` (no query change needed).
- Produces: `MessageComposerProps` gains `channel: 'meta' | 'waha'`.

- [ ] **Step 1: Compute the active channel in `message-thread.tsx`**

Near the existing `assignedAgentId`/`currentAssignee` computation (~line 865–869), add:
```typescript
const activeChannel: 'meta' | 'waha' =
  currentAssignee?.waha_session_name && currentAssignee?.phone ? 'waha' : 'meta';
```

- [ ] **Step 2: Pass it to `MessageComposer` and show a badge**

Update the `<MessageComposer>` call (~line 1154):
```tsx
<MessageComposer
  conversationId={conversation.id}
  sessionExpired={activeChannel === 'waha' ? false : sessionInfo.expired}
  channel={activeChannel}
  onSend={handleSend}
  onSendMedia={handleSendMedia}
  onSendInteractive={handleSendInteractive}
  onOpenTemplates={handleOpenTemplates}
  replyTo={replyTo}
  onClearReply={() => setReplyTo(null)}
/>
```
(`sessionExpired` forced to `false` on the WAHA path — the 24h Meta session-window concept doesn't apply to a personal WhatsApp account, and `sessionExpired` is what disables text input in the composer.)

Add a small badge in the thread header — find where `assignLabel`/the assignee is rendered in the header JSX (~line 993–1004, the "Assign dropdown") and add, just before or after that dropdown:
```tsx
{activeChannel === 'waha' && currentAssignee && (
  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]">
    via {currentAssignee.full_name}&rsquo;s WhatsApp
  </Badge>
)}
```
(`Badge` is already imported in this file at line 33.)

- [ ] **Step 3: Add the `channel` prop and gate the UI in `message-composer.tsx`**

In `MessageComposerProps` (~line 113):
```typescript
interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  channel: 'meta' | 'waha';
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (payload: InteractiveMessagePayload, replyToId?: string) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}
```
Destructure `channel` in the function signature (~line 135–144).

Gate the session-expired banner's template button (~line 587–601) — wrap the whole `{sessionExpired && (...)}` block condition to also require `channel !== 'waha'` (it already will never fire since `sessionExpired` is forced `false` from the caller, but making the intent explicit here avoids relying on caller discipline):
```tsx
{sessionExpired && channel !== 'waha' && (
```

Remove the "Interactive message" item from the "+" menu (~line 727–730) when on WAHA — wrap it:
```tsx
{channel !== 'waha' && (
  <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
    <MessageSquareDashed className="mr-2 h-4 w-4" />
    {t("interactiveMessage")}
  </DropdownMenuItem>
)}
```
(Quick replies, the sibling item, stays available on both channels.)

Hide the standalone template `GatedButton` (~line 738–748):
```tsx
{channel !== 'waha' && (
  <GatedButton
    variant="ghost"
    size="sm"
    canAct={!readOnly}
    gateReason="send messages"
    title={readOnly ? undefined : t("sendTemplate")}
    className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
    onClick={onOpenTemplates}
  >
    <LayoutTemplate className="h-4 w-4" />
  </GatedButton>
)}
```

- [ ] **Step 4: Add a connected-channel indicator to the assign dropdown**

Spec requirement (UI summary): the assignment dropdown should hint which agents have a connected WAHA channel, so whoever assigns knows what'll happen. In the `profiles.map((p) => { ... })` block inside the assign `DropdownMenuContent` (~line 1014–1042), add a small icon after the name span when that profile has both fields set:

```tsx
<span className="flex-1">
  {p.full_name}
  {p.user_id === user?.id ? t("me") : ""}
</span>
{p.waha_session_name && p.phone && (
  <Phone className="ml-1 h-3 w-3 text-emerald-400" aria-label={t('hasWahaChannel')} />
)}
{isSelected && <Check className="ml-2 h-3 w-3" />}
```

Add `Phone` to the `lucide-react` import list at the top of the file (~line 20–30). Add the `hasWahaChannel` translation key alongside the others added in Task 9, Step 4 (e.g. "Has a connected WhatsApp number").

- [ ] **Step 5: Manually verify in the browser**

Run the dev server, open a conversation, assign it to an agent with no WAHA channel connected — confirm template/interactive buttons are visible as before, and that agent has no phone icon in the assign dropdown. Assign it to an agent with both `waha_session_name` and `phone` set (from Task 9's manual test) — confirm the phone icon appears in the dropdown for that agent, the badge appears in the thread header once assigned, and both the template/interactive buttons disappear while plain text sending still works.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/message-thread.tsx src/components/inbox/message-composer.tsx
git commit -m "Hide template/interactive controls and show channel indicators for WAHA-routed conversations"
```

---

## Task 11: End-to-end manual verification

Not a code task — the closing checklist before calling this done. Requires a real WAHA server with a session already paired to a real (or disposable test) WhatsApp number.

- [ ] Register that session against a test agent profile via Settings → Members (Task 9's UI); copy the revealed webhook URL into that session's webhook configuration on the WAHA server.
- [ ] From a second phone, message the connected test number. Confirm the message appears in the CRM inbox, in the same conversation thread as that contact's prior Meta history (if any).
- [ ] Assign that conversation to the test agent in the CRM (if not already assigned) and reply from the CRM composer. Confirm the reply arrives on the second phone as a message from the test agent's WhatsApp number, not the main business number.
- [ ] Confirm no AI-drafted reply, no Flow step, and no automation fired for this conversation (check the account's automation/Flow logs for the contact — there should be none tied to this exchange).
- [ ] Confirm the template and interactive-message buttons are hidden in the composer for this conversation, and reappear when a different, non-WAHA conversation is opened.
- [ ] Reassign the conversation to an agent with no WAHA channel connected; confirm the next reply goes out via the main Meta number again (fallback works).
