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
  // Delegate the lookup to findExistingContact rather than a plain
  // `.eq('phone', phone)` — it pre-filters in SQL by the last-8-digit
  // suffix, then applies the strict `phonesMatch` in JS on the small
  // candidate set. That's the same matching rule the manual contact
  // form and CSV import use, so all callers agree on what "same
  // number" means (issue #212), and it's also what keeps this insert
  // aligned with the unique index migration 022 added on contacts.
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
    // Lost a race: a concurrent inbound delivery (or another path)
    // created this contact between our lookup and insert, and the
    // unique index (migration 022) rejected the duplicate. Re-resolve
    // the existing row instead of dropping the message.
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
  // Look for an existing conversation in this account, oldest-first.
  //
  // We deliberately do NOT use `.single()` here. `.single()` errors on
  // *both* 0 rows and >=2 rows, and treating any error as "none found"
  // (as older code did) means that once two conversations exist for a
  // contact — from a race, e.g. a provider retries a delivery or a
  // batch fans out to concurrent runs — every later inbound message
  // errors on the lookup and creates yet another conversation,
  // snowballing into a wall of duplicate chats (issue #363). Do not
  // "simplify" this back to `.single()`.
  //
  // Ordering oldest-first and taking one row makes the lookup resolve
  // to the same canonical survivor a dedup migration would keep, so
  // any pre-existing duplicates converge instead of compounding.
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
    // Lost a race: a concurrent inbound delivery created the
    // conversation between our lookup and insert, and the unique index
    // on (account_id, contact_id) rejected the duplicate. Re-resolve
    // the winning row (same oldest-first query as above) instead of
    // dropping the message — mirrors findOrCreateContact.
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
