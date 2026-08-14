# Quotations module

Date: 2026-08-14

## Problem

Quotations today are produced by hand — Word/Excel, mailed as a PDF, filed
nowhere the rest of the business can see. That has three concrete costs
already visible in the paper trail: reference numbers collide across staff
(`HT 03-25-02502`, `HT-2025-RSD-2501`, `HT-2023-AL-014` — three formats in
four documents), address/name/founding-year details drift between documents
because there is no single source of truth to type from, and a quotation
sent from someone's laptop is invisible to everyone else — no shared record
of what was quoted, to whom, for how much, or whether it converted.

Meanwhile wacrm already has almost everything a quotations feature needs:
account-scoped multi-user auth, a `contacts` table, a `deals` pipeline with
its own value/stage/assignment, Supabase Storage, and a working WhatsApp
send integration (`sendMediaMessage`). This spec adds quotations as a new
module inside wacrm rather than a separate tool, so it inherits all of that
instead of rebuilding it.

## Goals

- Any of several staff, on desktop or phone, can create a quotation with
  calculated totals (including per-line and order-level discounts) and
  generate a PDF that is visually identical to the approved branded
  template — not an approximation.
- Quotations are a shared, searchable record: reference numbers are
  collision-proof, and every quotation is visible to whoever should see it
  (assignment-based, mirroring how `deals` already works).
- A quotation can exist standalone (no CRM contact or deal required) and
  optionally be linked to a contact and/or a deal at creation or later.
- Line items are a flexible tree: a product can carry any number of
  accessory/customization sub-items, each independently priced and
  discountable, not a single flat description field.
- A shared `catalog_items` list (products, parts, accessories, materials)
  grows organically as staff quote — typing a new item offers to save it
  for reuse — and is designed so a future inventory system (stock, cost,
  supplier) is an additive migration onto this same table, not a rebuild.
- Sending a quotation reuses the existing WhatsApp send path
  (`sendMediaMessage`) with a human confirming before it goes out.

## Non-goals

- Full inventory (stock counts, cost tracking, purchase orders, suppliers).
  `catalog_items` is deliberately shaped so this can be added later without
  restructuring, but none of it is built now.
- Fully automatic WhatsApp sending. The rep always confirms before send —
  see Architecture → WhatsApp send.
- Multi-currency conversion. Quotations use the account's existing
  `default_currency` (021), same as deals — no FX logic.
- VAT/tax line items. Not currently applicable; `Products/HTH_PRE_QUALIFICATION.pdf`
  and the commercial registration have blank tax fields today (see
  `04_Website/Company Essential/Brand Voice/WhatsApp_Reply_Library.md`,
  "يحتاج تأكيد" section) — out of scope until that's resolved.
- Reconciling `catalog_items` with the existing `ai_products` table. They
  serve different consumers (this module vs. the AI reply bot) and stay
  independent for now; `ai_products` is not modified by this spec.
- Approval workflows for new catalog entries. Any agent can add one; only
  admins can edit/archive — no "pending review" state in v1.

## Architecture

### Data model

Four new tables. Nothing existing changes shape — notably, unlike the
`order_info` precedent (044), this needs **no new columns on `deals`**:
the relationship points outward from the new `quotations` table instead.

```sql
-- The reusable catalog — products, parts, accessories, materials.
-- Deliberately separate from `ai_products` (057), which stays as-is for
-- the AI reply bot. This table is the seed of a future inventory table:
-- stock_qty/cost_price/supplier/reorder_level get added onto THIS table
-- later, additively, once real inventory is needed.
CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'product', -- free text: product/part/accessory/material/other
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  sku text,
  unit_of_measure text, -- 'piece', 'm', 'set', ...
  default_unit_price numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX catalog_items_account_id_idx ON catalog_items (account_id);
CREATE INDEX catalog_items_name_trgm_idx ON catalog_items USING gin (name gin_trgm_ops); -- autocomplete

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY catalog_items_select ON catalog_items FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY catalog_items_insert ON catalog_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY catalog_items_update ON catalog_items FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

CREATE POLICY catalog_items_delete ON catalog_items FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- Sequential, race-safe reference numbers: HT-YY-CODE-NNN.
CREATE TABLE quotation_product_codes (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code text NOT NULL, -- 'PIV', 'RSD', 'STL', 'UPV', 'GEN', ...
  label text NOT NULL,
  PRIMARY KEY (account_id, code)
);

CREATE TABLE quotation_sequences (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  year text NOT NULL, -- 'YY'
  code text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, year, code)
);

-- Atomic increment — safe under concurrent requests from multiple staff.
CREATE FUNCTION next_quotation_reference(p_account_id uuid, p_code text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_year text := to_char(now(), 'YY');
  v_n integer;
BEGIN
  INSERT INTO quotation_sequences (account_id, year, code, next_number)
  VALUES (p_account_id, v_year, p_code, 2)
  ON CONFLICT (account_id, year, code)
  DO UPDATE SET next_number = quotation_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_n;
  RETURN 'HT-' || v_year || '-' || p_code || '-' || lpad(v_n::text, 3, '0');
END;
$$;


CREATE TABLE quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL, -- mirrors deals.assigned_to
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,   -- optional
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,         -- optional, linkable later
  reference text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')),

  -- Free-text client snapshot — present even with no linked contact.
  client_name text,
  client_phone text,
  client_company text,
  location text,
  project_name text,

  subject text,
  currency text, -- defaults from accounts.default_currency (021) at creation

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  discount_reason text,

  subtotal numeric NOT NULL DEFAULT 0,   -- sum of line totals before order discount
  discount_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,

  valid_until date,
  delivery_terms text,
  payment_terms text,
  warranty_terms text DEFAULT 'One year from handover',

  pdf_storage_path text, -- set after first "Generate PDF"

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, reference)
);

CREATE INDEX quotations_account_id_idx ON quotations (account_id);
CREATE INDEX quotations_assigned_to_idx ON quotations (assigned_to);
CREATE INDEX quotations_contact_id_idx ON quotations (contact_id);
CREATE INDEX quotations_deal_id_idx ON quotations (deal_id);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

-- Mirrors deals_select/update/delete (040) exactly.
CREATE POLICY quotations_select ON quotations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

CREATE POLICY quotations_insert ON quotations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY quotations_update ON quotations FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

CREATE POLICY quotations_delete ON quotations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);


-- A flexible tree: sections (headers, no price), top-level products, and
-- accessory/customization sub-items (parent_item_id set). One level of
-- nesting in the UI for v1 — the schema itself allows more, unused for now.
CREATE TABLE quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, -- denormalized, matches ai_product_media's RLS pattern
  parent_item_id uuid REFERENCES quotation_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL, -- optional catalog link; never live-joined for pricing
  position integer NOT NULL DEFAULT 0,
  item_type text NOT NULL DEFAULT 'line' CHECK (item_type IN ('section', 'line')),
  kind text, -- display-only free text: 'Accessory', 'Customization', null for a plain product

  item_code text, -- 'D01' etc.
  description text,
  description_ar text,
  size_w numeric,
  size_h numeric,
  qty numeric DEFAULT 1,
  unit_price numeric,

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  line_total numeric NOT NULL DEFAULT 0, -- computed at save time, after item-level discount

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quotation_items_quotation_id_idx ON quotation_items (quotation_id);
CREATE INDEX quotation_items_parent_item_id_idx ON quotation_items (parent_item_id);
CREATE INDEX quotation_items_account_id_idx ON quotation_items (account_id);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

-- Item visibility/writes re-check the PARENT quotation's own assigned_to
-- rule via the subquery — not just "does some quotation with this id
-- exist." Without that inner OR clause an agent could edit line items on
-- a quotation assigned to someone else, contradicting quotations_update.
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY quotation_items_write ON quotation_items FOR ALL USING (
  EXISTS (
    SELECT 1 FROM quotations q
    WHERE q.id = quotation_items.quotation_id
      AND (
        is_account_member(q.account_id, 'admin')
        OR (is_account_member(q.account_id, 'agent')
            AND q.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
      )
  )
);
```

Seed `quotation_product_codes` with `PIV` (Pivot Door), `RSD` (Roll-Up
Shutter), `STL` (Steel Door), `UPV` (UPVC), `GEN` (General) — matches the
product lines visible in the reviewed example quotations. Admins can add
more from Settings; no code change needed for a new product line.

### Migration (next free number in `supabase/migrations/`; sequential with
the existing 058)

One migration file containing all of the SQL above, following this repo's
existing convention: a comment block at the top explaining the *why* (this
section, condensed), idempotent `CREATE TABLE IF NOT EXISTS` /
`DROP POLICY IF EXISTS` throughout, RLS enabled and policies attached in
the same file as the table they govern.

### Server-side: totals and bilingual amount-in-words

A pure function, `computeQuotationTotals(items, orderDiscount)`, walks the
item tree, applies each item's own discount, sums to `subtotal`, applies
the order-level discount, returns `{ subtotal, discount_amount, total }`.
Runs both client-side (live total as a rep edits) and server-side (source
of truth stored on save — never trust the client's arithmetic for what
gets printed).

`amountInWordsBilingual(total, currency)` ports the number-to-words logic
already written and unit-tested for the Sheets prototype directly into
`src/lib/quotations/` — same English cardinal-number logic, same Arabic
gender-agreement handling for 3–10, same three-way "ألف / ألفان / آلاف"
thousands split. That code is correct as written; this is a port, not a
rewrite.

### PDF generation

New dependency: `playwright` (Chromium). `generateQuotationPdf(quotationId)`
loads the quotation + items, renders the same HTML/CSS built and approved
for the branded quotation template (currently at
`04_Website/Company Essential/Stationery/quotation.html`) with the real
data substituted in, screenshots it to PDF via headless Chromium, and
uploads the result to a new `quotation-pdfs` Storage bucket.

`quotation-pdfs` is **public**, matching the existing `chat_media` bucket
(023) — the same constraint applies: WhatsApp's delivery servers need to
fetch the file over an unauthenticated URL for `sendMediaMessage` to work.
Protection is the same as `chat_media` already relies on: writes are
account-scoped RLS, and paths use the quotation's random UUID rather than
anything guessable — `quotation-pdfs/{quotation_id}/rev-{revision}.pdf`.

Generation is an explicit "Generate PDF" action, not automatic on every
edit. First generation writes `revision = 0`. Regenerating after
`status = 'sent'` increments `revision` and writes a new file at the new
revision path, preserving prior revisions rather than overwriting them.

**Deploy step, not just a dependency:** Playwright needs its Chromium
binary installed on the VPS (`npx playwright install chromium --with-deps`)
as part of deploy, in addition to `npm install`. Flagged here so it isn't
missed when this ships — the plan doc must include it as an explicit step.

### WhatsApp send

"Send Quotation" (on the quotation detail page, and from the deal card's
Quotations section if linked) calls `resolveConversationByPhone` for the
quotation's phone number, then `sendMediaMessage` with the PDF's public
storage URL and a pre-filled text containing the reference number. This
lands as a **pending outgoing message in the existing inbox compose box**
— the rep still clicks send there. No auto-send path exists in this spec;
if that's ever wanted, it's a separate, explicit follow-up decision, not a
flag on this feature.

### UI touch points

- New top-level nav item **Quotations** — list, filter by status, search
  by reference/client/company. Detail page: header (reference, status,
  revision), party/project fields, the item tree editor, discount fields,
  totals, Generate PDF, Send via WhatsApp, Link to deal/contact.
- Item tree editor: add a section header, add a top-level product
  (catalog-search-or-type-new, with the "Save to catalog" toggle described
  in Goals), add an accessory/customization under any product row. Live
  totals via `computeQuotationTotals` as the rep types.
- Deal card gains a **Quotations** section, following the exact pattern
  `order-info-dialog.tsx` (044) already established for per-deal data:
  list of linked quotations, "New Quotation" (pre-fills contact/deal),
  "Link existing quotation."
- Settings gains a small **Quotation product codes** table (admin-only
  edit) backing `quotation_product_codes`.

### Tests

- `computeQuotationTotals`: item discounts, order discount, nested
  accessory items, zero/negative-guard cases.
- `numberToWordsEN` / `numberToWordsAR`: the values already verified by
  hand (3600, 19500, 35500, 2000, 11000, 100000) as regression fixtures,
  plus the corrected 3–10-thousands plural case.
- `next_quotation_reference`: concurrent-call test asserting no duplicate
  reference under simulated concurrent inserts.
- RLS: agent sees only assigned quotations; admin sees all; catalog insert
  by agent, catalog edit rejected for non-admin.

## Rollout

Purely additive: four new tables, one new Storage bucket, one new nav
section, one new dependency. No existing table, RLS policy, page, or
component changes shape or behavior — the deal card gains a section, it
doesn't lose or change any existing one. This can be merged and deployed
with the nav entry hidden behind a feature check, tested against real
staff data privately, and switched on only once confirmed — rollback, if
ever needed, is dropping the four new tables and the nav entry, with zero
impact on contacts, pipelines, inbox, or the AI reply bot.
