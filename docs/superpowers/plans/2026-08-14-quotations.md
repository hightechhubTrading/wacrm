# Quotations Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add quotations — creation, flexible line items with accessories/customizations, discounts, a self-growing product/parts catalog, branded PDF generation, and WhatsApp-attach send — as a new module inside wacrm, per `docs/superpowers/specs/2026-08-14-quotations-design.md`.

**Architecture:** Four new Postgres tables (additive only, no existing table changes shape), pure calculation functions with no I/O, Next.js API routes following this repo's existing `src/app/api/pipelines/*` conventions, Playwright for pixel-perfect PDF rendering of the already-approved branded template, and the existing `sendMediaMessage`/`resolveConversationByPhone` WhatsApp functions for send — no new WhatsApp integration code.

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + Storage + RLS), Vitest, Playwright (new dependency), TypeScript.

## Global Constraints

- No existing table, RLS policy, page, or component changes shape or behavior (spec Rollout). The `deals` table gets zero new columns.
- `ai_products` is not touched by this feature (spec Non-goals) — `catalog_items` is a separate table.
- RLS on `quotations` mirrors `deals_select`/`update`/`delete` exactly (migration 040): `is_account_member(account_id, 'admin')` sees/edits all; `is_account_member(account_id, 'agent')` only where `assigned_to` matches the caller's own `profiles.id`.
- No auto-send: "Send Quotation" always lands as a pending message in the existing inbox compose box for a human to confirm (spec Non-goals).
- Currency is the account's existing `default_currency` (migration 021) — no FX conversion.
- Every new file follows this repo's existing per-domain conventions: `src/lib/<domain>/admin-client.ts` for the lazy service-role Supabase client (mirrors `src/lib/flows/admin-client.ts`), Postgres functions called via `db.rpc('fn_name', {...})` (mirrors `src/lib/flows/engine.ts:1108`), tests co-located as `<file>.test.ts` using Vitest + `vi.mock` (mirrors `src/lib/whatsapp/send-message.test.ts`).
- **Deviation from the spec's SQL sketch, decided during planning:** the spec used a `gin_trgm_ops` index on `catalog_items.name` for fuzzy autocomplete. `pg_trgm` is not enabled anywhere in this repo's migration history — rather than introduce a new Postgres extension for a catalog that will realistically hold hundreds, not millions, of rows, Task 1 uses a plain `lower(name)` btree index and `ILIKE` search. Simpler, matches actual scale, nothing new to enable on the database.
- Playwright requires `npx playwright install chromium --with-deps` on the VPS as an explicit deploy step, in addition to `npm install` — called out again in Task 9, not just the spec.

---

### Task 1: Database schema, RLS, and reference-number function

**Files:**
- Create: `supabase/migrations/059_quotations.sql`

**Interfaces:**
- Produces: tables `catalog_items`, `quotation_product_codes`, `quotation_sequences`, `quotations`, `quotation_items`; function `next_quotation_reference(p_account_id uuid, p_code text) RETURNS text`.

This task has no application-code test cycle — it's schema. Verification is applying the migration to a local Supabase instance and checking the objects exist, per this repo's existing migration convention (no other migration in this repo carries a Vitest test either).

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- 059_quotations.sql
--
-- Quotations as a new module: any staff member can create a priced,
-- bilingual quotation — optionally linked to a contact and/or deal,
-- never required to be — with a flexible item tree (sections, top-
-- level products, and accessory/customization sub-items under any
-- product), per-item and per-order discounts, and a self-growing
-- shared catalog of products/parts/accessories that doubles as the
-- seed of a future inventory table.
--
-- No existing table changes shape. Unlike 044's order_info (which
-- added columns to `deals`), this needs nothing on `deals` at all —
-- the relationship points outward from the new `quotations` table.
-- `ai_products` (057) is untouched; it keeps serving the AI reply bot
-- independently of this catalog.
--
-- RLS on `quotations` mirrors deals_select/update/delete (040)
-- exactly: admin sees/edits everything in the account, agent only
-- what's assigned to them via `assigned_to` -> profiles.id.
--
-- See docs/superpowers/specs/2026-08-14-quotations-design.md.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ── Catalog: products, parts, accessories, materials ──────────
-- Seed of a future inventory table -- stock_qty/cost_price/supplier
-- get added onto THIS table later, additively, not a new one.
CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'product',
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  sku text,
  unit_of_measure text,
  default_unit_price numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_items_account_id_idx ON catalog_items (account_id);
-- Plain btree + ILIKE, not pg_trgm (not enabled anywhere in this repo;
-- catalog scale doesn't need fuzzy matching). See plan Global Constraints.
CREATE INDEX IF NOT EXISTS catalog_items_name_lower_idx ON catalog_items (lower(name));

ALTER TABLE catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_items_select ON catalog_items;
CREATE POLICY catalog_items_select ON catalog_items FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS catalog_items_insert ON catalog_items;
CREATE POLICY catalog_items_insert ON catalog_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS catalog_items_update ON catalog_items;
CREATE POLICY catalog_items_update ON catalog_items FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_items_delete ON catalog_items;
CREATE POLICY catalog_items_delete ON catalog_items FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_catalog_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS catalog_items_updated_at ON catalog_items;
CREATE TRIGGER catalog_items_updated_at
  BEFORE UPDATE ON catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_items_updated_at();

-- ── Reference numbering: HT-YY-CODE-NNN, race-safe ─────────────
CREATE TABLE IF NOT EXISTS quotation_product_codes (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (account_id, code)
);

ALTER TABLE quotation_product_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotation_product_codes_select ON quotation_product_codes;
CREATE POLICY quotation_product_codes_select ON quotation_product_codes FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS quotation_product_codes_write ON quotation_product_codes;
CREATE POLICY quotation_product_codes_write ON quotation_product_codes FOR ALL
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS quotation_sequences (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  year text NOT NULL,
  code text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, year, code)
);

ALTER TABLE quotation_sequences ENABLE ROW LEVEL SECURITY;

-- No direct client access -- only next_quotation_reference() (SECURITY
-- DEFINER, below) touches this table. No SELECT/INSERT/UPDATE policy
-- is added on purpose: RLS enabled with zero policies denies all
-- direct client access while the function itself bypasses RLS.

-- Bug caught in Task 1's review, not present when this was first drafted:
-- SECURITY DEFINER + GRANT EXECUTE TO authenticated means ANY authenticated
-- user of ANY account could call this with someone else's account_id and
-- burn/observe that account's sequence counter. The membership check below
-- closes it, mirroring the pattern migration 018's set_member_role already
-- uses for exactly this class of privileged RPC.
CREATE OR REPLACE FUNCTION next_quotation_reference(p_account_id uuid, p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YY');
  v_n integer;
BEGIN
  IF NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO quotation_sequences (account_id, year, code, next_number)
  VALUES (p_account_id, v_year, p_code, 2)
  ON CONFLICT (account_id, year, code)
  DO UPDATE SET next_number = quotation_sequences.next_number + 1
  RETURNING next_number - 1 INTO v_n;
  RETURN 'HT-' || v_year || '-' || p_code || '-' || lpad(v_n::text, 3, '0');
END;
$$;

ALTER FUNCTION next_quotation_reference(uuid, text) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION next_quotation_reference(uuid, text) TO authenticated, service_role;

-- ── Quotations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  reference text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'won', 'lost', 'expired')),

  client_name text,
  client_phone text,
  client_company text,
  location text,
  project_name text,

  subject text,
  currency text,

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  discount_reason text,

  subtotal numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,

  valid_until date,
  delivery_terms text,
  payment_terms text,
  warranty_terms text DEFAULT 'One year from handover',

  pdf_storage_path text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, reference)
);

CREATE INDEX IF NOT EXISTS quotations_account_id_idx ON quotations (account_id);
CREATE INDEX IF NOT EXISTS quotations_assigned_to_idx ON quotations (assigned_to);
CREATE INDEX IF NOT EXISTS quotations_contact_id_idx ON quotations (contact_id);
CREATE INDEX IF NOT EXISTS quotations_deal_id_idx ON quotations (deal_id);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotations_select ON quotations;
CREATE POLICY quotations_select ON quotations FOR SELECT USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

DROP POLICY IF EXISTS quotations_insert ON quotations;
CREATE POLICY quotations_insert ON quotations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS quotations_update ON quotations;
CREATE POLICY quotations_update ON quotations FOR UPDATE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

DROP POLICY IF EXISTS quotations_delete ON quotations;
CREATE POLICY quotations_delete ON quotations FOR DELETE USING (
  is_account_member(account_id, 'admin')
  OR (is_account_member(account_id, 'agent')
      AND assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
);

CREATE OR REPLACE FUNCTION public.update_quotations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_updated_at ON quotations;
CREATE TRIGGER quotations_updated_at
  BEFORE UPDATE ON quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_quotations_updated_at();

-- ── Quotation items: sections, products, accessories/customizations ──
CREATE TABLE IF NOT EXISTS quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  parent_item_id uuid REFERENCES quotation_items(id) ON DELETE CASCADE,
  product_id uuid REFERENCES catalog_items(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  item_type text NOT NULL DEFAULT 'line' CHECK (item_type IN ('section', 'line')),
  kind text,

  item_code text,
  description text,
  description_ar text,
  size_w numeric,
  size_h numeric,
  qty numeric DEFAULT 1,
  unit_price numeric,

  discount_type text CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric,
  line_total numeric NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotation_items_quotation_id_idx ON quotation_items (quotation_id);
CREATE INDEX IF NOT EXISTS quotation_items_parent_item_id_idx ON quotation_items (parent_item_id);
CREATE INDEX IF NOT EXISTS quotation_items_account_id_idx ON quotation_items (account_id);

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

-- Bug caught in Task 1's review: this used to trust quotation_items.account_id
-- directly, a column the client sets on insert with nothing tying it to the
-- item's actual parent quotation. A row whose account_id didn't match its
-- quotation_id's real account would be visible to the wrong tenant. Now
-- derives from the parent exactly like quotation_items_write already did --
-- account_id stays on the row for indexing only, never as a security boundary.
DROP POLICY IF EXISTS quotation_items_select ON quotation_items;
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quotations q
      WHERE q.id = quotation_items.quotation_id
        AND is_account_member(q.account_id)
    )
  );

-- Re-checks the PARENT quotation's own assigned_to rule, not just "does
-- some quotation with this id exist" -- see spec self-review note.
DROP POLICY IF EXISTS quotation_items_write ON quotation_items;
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

-- ── Seed product codes, matching the product lines in the reviewed
-- example quotations (see spec Data model). accountless seed: applied
-- per-account by the app on first use (Task 5), not hardcoded here,
-- since this migration has no account_id to seed against yet.
```

- [ ] **Step 2: Apply locally and verify**

Run: `supabase db reset` (or `supabase migration up` against a local/dev
project, per this repo's existing workflow).

Expected: no errors; `\d quotations`, `\d quotation_items`,
`\d catalog_items` in `psql` show the columns above; `SELECT
next_quotation_reference('<any-existing-account-id>', 'PIV');` run twice
returns `HT-26-PIV-001` then `HT-26-PIV-002`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/059_quotations.sql
git commit -m "feat(quotations): add schema, RLS, and reference-number function"
```

---

### Task 2: Bilingual amount-in-words

**Files:**
- Create: `src/lib/quotations/number-to-words.ts`
- Test: `src/lib/quotations/number-to-words.test.ts`

**Interfaces:**
- Produces: `numberToWordsEN(n: number): string`, `numberToWordsAR(n: number): string`, `amountInWordsBilingual(qar: number): { ar: string; en: string }`.

Port of the logic already written and hand-verified for the Sheets
prototype (spec Architecture → "Server-side: totals and bilingual
amount-in-words") — same algorithm, now with a real test file instead of
one-off `node -e` checks.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { numberToWordsEN, numberToWordsAR, amountInWordsBilingual } from './number-to-words';

describe('numberToWordsEN', () => {
  it('renders thousands and hundreds', () => {
    expect(numberToWordsEN(3600)).toBe('Three Thousand Six Hundred');
    expect(numberToWordsEN(35500)).toBe('Thirty Five Thousand Five Hundred');
  });
  it('renders zero', () => {
    expect(numberToWordsEN(0)).toBe('Zero');
  });
});

describe('numberToWordsAR', () => {
  it('uses the singular form for exactly one thousand', () => {
    expect(numberToWordsAR(1500)).toBe('ألف وخمسمئة');
  });
  it('uses the dual form for exactly two thousand', () => {
    expect(numberToWordsAR(2400)).toBe('ألفان وأربعمئة');
  });
  it('uses the plural form (آلاف) for 3-10 thousand', () => {
    expect(numberToWordsAR(3600)).toBe('ثلاثة آلاف وستمئة');
  });
  it('reverts to the singular form (ألف) above ten thousand', () => {
    expect(numberToWordsAR(19500)).toBe('تسعة عشر ألف وخمسمئة');
    expect(numberToWordsAR(35500)).toBe('خمسة وثلاثون ألف وخمسمئة');
  });
  it('renders a bare hundred-thousand', () => {
    expect(numberToWordsAR(100000)).toBe('مئة ألف');
  });
});

describe('amountInWordsBilingual', () => {
  it('wraps both languages with the currency phrase', () => {
    const { ar, en } = amountInWordsBilingual(3600);
    expect(ar).toBe('فقط ثلاثة آلاف وستمئة ريال قطري لا غير');
    expect(en).toBe('Three Thousand Six Hundred Qatari Riyals only');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/quotations/number-to-words.test.ts`
Expected: FAIL — `Cannot find module './number-to-words'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/quotations/number-to-words.ts
//
// Bilingual amount-in-words for quotation totals. The Arabic side is
// the fiddly part: cardinal numbers 3-10 take the FEMININE form when
// the counted noun (ريال, masculine) is itself masculine — Arabic
// grammar inverts gender agreement for 3-10 specifically — and
// "thousand" has three different words depending on the count: ألف
// (1), ألفان (2), آلاف (3-10, plural), then back to ألف (11+,
// singular again). Verified by hand against real example quotations
// before being written down here — see
// docs/superpowers/specs/2026-08-14-quotations-design.md.

const EN_ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function enChunk(num: number): string {
  let s = '';
  if (num >= 100) {
    s += EN_ONES[Math.floor(num / 100)] + ' Hundred ';
    num %= 100;
  }
  if (num >= 20) {
    s += EN_TENS[Math.floor(num / 10)] + ' ';
    num %= 10;
  }
  if (num > 0) s += EN_ONES[num] + ' ';
  return s.trim();
}

export function numberToWordsEN(n: number): string {
  if (n === 0) return 'Zero';
  let result = '';
  if (n >= 1000000) {
    result += enChunk(Math.floor(n / 1000000)) + ' Million ';
    n %= 1000000;
  }
  if (n >= 1000) {
    result += enChunk(Math.floor(n / 1000)) + ' Thousand ';
    n %= 1000;
  }
  if (n > 0) result += enChunk(n);
  return result.trim();
}

// Feminine forms — used for 3-10 because ريال is grammatically
// masculine and Arabic cardinals 3-10 agree with the OPPOSITE gender.
const AR_ONES_M = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = [
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر',
  'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة',
];

function arChunk(num: number): string {
  const parts: string[] = [];
  if (num >= 100) {
    parts.push(AR_HUNDREDS[Math.floor(num / 100)]);
    num %= 100;
  }
  if (num >= 10 && num < 20) {
    parts.push(AR_TEENS[num - 10]);
    num = 0;
  } else {
    if (num >= 20) {
      parts.push(AR_TENS[Math.floor(num / 10)]);
      num %= 10;
    }
    if (num > 0) parts.push(AR_ONES_M[num]);
  }
  // Arabic reads smallest-unit-first: "ثلاثة وعشرون" = 23.
  return parts.reverse().join(' و');
}

export function numberToWordsAR(n: number): string {
  if (n === 0) return 'صفر';
  const parts: string[] = [];
  if (n >= 1000000) {
    parts.push(arChunk(Math.floor(n / 1000000)) + ' مليون');
    n %= 1000000;
  }
  if (n >= 1000) {
    const th = Math.floor(n / 1000);
    let word: string;
    if (th === 1) word = 'ألف';
    else if (th === 2) word = 'ألفان';
    else if (th <= 10) word = arChunk(th) + ' آلاف';
    else word = arChunk(th) + ' ألف';
    parts.push(word);
    n %= 1000;
  }
  if (n > 0) parts.push(arChunk(n));
  return parts.join(' و');
}

export function amountInWordsBilingual(qar: number): { ar: string; en: string } {
  return {
    ar: `فقط ${numberToWordsAR(qar)} ريال قطري لا غير`,
    en: `${numberToWordsEN(qar)} Qatari Riyals only`,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/quotations/number-to-words.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotations/number-to-words.ts src/lib/quotations/number-to-words.test.ts
git commit -m "feat(quotations): add bilingual amount-in-words"
```

---

### Task 3: Totals calculation (items, nested accessories, discounts)

**Files:**
- Create: `src/lib/quotations/totals.ts`
- Test: `src/lib/quotations/totals.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `type QuotationItemInput`, `type OrderDiscount`, `computeQuotationTotals(items: QuotationItemInput[], orderDiscount?: OrderDiscount): { subtotal: number; discountAmount: number; total: number; itemTotals: Record<string, number> }`. Later tasks (Task 5, UI) import `QuotationItemInput` and `computeQuotationTotals` from this exact path.

Pure function, no I/O — runs identically client-side (live total as a rep
types) and server-side (source of truth on save, per spec: "never trust
the client's arithmetic for what gets printed").

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { computeQuotationTotals, type QuotationItemInput } from './totals';

describe('computeQuotationTotals', () => {
  it('sums flat line items with no discount', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 2400 },
      { id: 'b', itemType: 'line', qty: 2, unitPrice: 500 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.subtotal).toBe(3400);
    expect(result.total).toBe(3400);
    expect(result.itemTotals.a).toBe(2400);
    expect(result.itemTotals.b).toBe(1000);
  });

  it('ignores section headers entirely', () => {
    const items: QuotationItemInput[] = [
      { id: 's', itemType: 'section' },
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 100 },
    ];
    expect(computeQuotationTotals(items).subtotal).toBe(100);
  });

  it('applies a fixed discount to a single line item', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 1000, discountType: 'fixed', discountValue: 150 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.itemTotals.a).toBe(850);
    expect(result.subtotal).toBe(850);
  });

  it('applies a percent discount to a single line item', () => {
    const items: QuotationItemInput[] = [
      { id: 'a', itemType: 'line', qty: 1, unitPrice: 2000, discountType: 'percent', discountValue: 10 },
    ];
    expect(computeQuotationTotals(items).itemTotals.a).toBe(1800);
  });

  it('includes accessory/customization sub-items under a parent product', () => {
    const items: QuotationItemInput[] = [
      { id: 'door', itemType: 'line', qty: 1, unitPrice: 16000 },
      { id: 'lock', itemType: 'line', parentItemId: 'door', kind: 'Accessory', qty: 1, unitPrice: 3000 },
      { id: 'handle', itemType: 'line', parentItemId: 'door', kind: 'Customization', qty: 1, unitPrice: 800 },
    ];
    const result = computeQuotationTotals(items);
    expect(result.subtotal).toBe(19800);
    expect(result.itemTotals.door).toBe(16000);
    expect(result.itemTotals.lock).toBe(3000);
    expect(result.itemTotals.handle).toBe(800);
  });

  it('applies an order-level fixed discount after subtotal', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 3600 }];
    const result = computeQuotationTotals(items, { discountType: 'fixed', discountValue: 600 });
    expect(result.subtotal).toBe(3600);
    expect(result.discountAmount).toBe(600);
    expect(result.total).toBe(3000);
  });

  it('applies an order-level percent discount after subtotal', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 10000 }];
    const result = computeQuotationTotals(items, { discountType: 'percent', discountValue: 15 });
    expect(result.discountAmount).toBe(1500);
    expect(result.total).toBe(8500);
  });

  it('never lets a total go negative', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line', qty: 1, unitPrice: 100 }];
    const result = computeQuotationTotals(items, { discountType: 'fixed', discountValue: 500 });
    expect(result.total).toBe(0);
  });

  it('treats a missing qty as 1 and a missing unitPrice as 0', () => {
    const items: QuotationItemInput[] = [{ id: 'a', itemType: 'line' }];
    expect(computeQuotationTotals(items).subtotal).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/quotations/totals.test.ts`
Expected: FAIL — `Cannot find module './totals'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/quotations/totals.ts
//
// Pure calculation, no I/O — runs identically in the browser (live
// total as a rep edits) and on the server (source of truth on save).
// Section headers (item_type: 'section') never contribute to the
// total. Every other item — top-level product or accessory/
// customization sub-item, distinguished only by parentItemId — is
// summed the same way, per spec: "everything is a quotation_item."

export type DiscountType = 'percent' | 'fixed';

export interface OrderDiscount {
  discountType: DiscountType;
  discountValue: number;
}

export interface QuotationItemInput {
  id: string;
  itemType: 'section' | 'line';
  parentItemId?: string;
  kind?: string;
  qty?: number;
  unitPrice?: number;
  discountType?: DiscountType;
  discountValue?: number;
}

export interface QuotationTotals {
  subtotal: number;
  discountAmount: number;
  total: number;
  itemTotals: Record<string, number>;
}

function applyDiscount(amount: number, type: DiscountType | undefined, value: number | undefined): number {
  if (!type || !value) return amount;
  const discount = type === 'percent' ? amount * (value / 100) : value;
  return Math.max(0, amount - discount);
}

export function computeQuotationTotals(
  items: QuotationItemInput[],
  orderDiscount?: OrderDiscount,
): QuotationTotals {
  const itemTotals: Record<string, number> = {};
  let subtotal = 0;

  for (const item of items) {
    if (item.itemType === 'section') continue;
    const qty = item.qty ?? 1;
    const unitPrice = item.unitPrice ?? 0;
    const lineTotal = applyDiscount(qty * unitPrice, item.discountType, item.discountValue);
    itemTotals[item.id] = lineTotal;
    subtotal += lineTotal;
  }

  const total = orderDiscount
    ? applyDiscount(subtotal, orderDiscount.discountType, orderDiscount.discountValue)
    : subtotal;
  const discountAmount = subtotal - total;

  return { subtotal, discountAmount, total, itemTotals };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/quotations/totals.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quotations/totals.ts src/lib/quotations/totals.test.ts
git commit -m "feat(quotations): add totals calculation with nested items and discounts"
```

---

### Task 4: Reference-number data access + concurrency test

**Files:**
- Create: `src/lib/quotations/admin-client.ts`
- Create: `src/lib/quotations/reference.ts`
- Test: `src/lib/quotations/reference.test.ts`

**Interfaces:**
- Consumes: `next_quotation_reference` Postgres function (Task 1).
- Produces: `getNextQuotationReference(accountId: string, code: string): Promise<string>`.

Mirrors `src/lib/flows/admin-client.ts` exactly, per Global Constraints.

- [ ] **Step 1: Write the admin client (no test needed — it's the exact
  established pattern copied verbatim, same as every other domain's
  `admin-client.ts` in this repo)**

```typescript
// src/lib/quotations/admin-client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy, shared service-role client for quotations. Mirrors
// src/lib/flows/admin-client.ts — same shape so anyone reading either
// file picks up the convention immediately.
let _adminClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
```

- [ ] **Step 2: Write the failing test for the reference wrapper**

```typescript
import { describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ rpc }),
}));

import { getNextQuotationReference } from './reference';

describe('getNextQuotationReference', () => {
  it('calls next_quotation_reference with the account and product code', async () => {
    rpc.mockResolvedValueOnce({ data: 'HT-26-PIV-001', error: null });
    const result = await getNextQuotationReference('acc-1', 'PIV');
    expect(rpc).toHaveBeenCalledWith('next_quotation_reference', {
      p_account_id: 'acc-1',
      p_code: 'PIV',
    });
    expect(result).toBe('HT-26-PIV-001');
  });

  it('throws with the Postgres error message on failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(getNextQuotationReference('acc-1', 'PIV')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/quotations/reference.test.ts`
Expected: FAIL — `Cannot find module './reference'`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/lib/quotations/reference.ts
import { supabaseAdmin } from './admin-client';

export async function getNextQuotationReference(accountId: string, code: string): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc('next_quotation_reference', {
    p_account_id: accountId,
    p_code: code,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/quotations/reference.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Manual concurrency check against a local Supabase instance**

The unit test above proves the wrapper calls the function correctly; it
cannot prove the function is race-safe under real concurrent connections
(mocked `rpc` runs sequentially in-process). Verify the DB-level guarantee
directly once against local Postgres:

```bash
# In psql, two concurrent sessions calling the same (account, code):
# Terminal A and B, run at the same time:
SELECT next_quotation_reference('<test-account-id>', 'PIV');
```

Expected: the two calls return different, sequential values
(`HT-26-PIV-001` and `HT-26-PIV-002`, in either order) — never the same
value twice. This confirms the `INSERT ... ON CONFLICT DO UPDATE ...
RETURNING` pattern in Task 1 is atomic under Postgres's own row-level
locking, which is what actually prevents the collision (not application
code).

- [ ] **Step 7: Commit**

```bash
git add src/lib/quotations/admin-client.ts src/lib/quotations/reference.ts src/lib/quotations/reference.test.ts
git commit -m "feat(quotations): add race-safe reference number data access"
```

---

### Task 5: Quotation CRUD data access

**Revision note (post-review):** this task's original version shipped, was
reviewed, and the review found three real defects — all inherited from
this plan's own reference code, not implementer deviations. This section
is the corrected version; the fixes below are what an implementer should
build. See the ledger for the original review findings.

1. `createQuotation` returned a bare `as unknown as Quotation` cast with
   no snake_case→camelCase mapping — every field except the two that
   happen to be spelled identically (`reference`, `status`) came back
   `undefined` at runtime despite TypeScript believing otherwise. Fixed
   with explicit `mapQuotationRow`/`mapQuotationItemRow` functions that
   every future task returning a quotation to a client must use — see
   the equivalent notes added to Tasks 6, 11, and 12.
2. `saveQuotationItems` did delete-then-insert-then-update as three
   separate `supabase-js` calls with no transaction — an insert failing
   after the delete succeeded left a quotation with zero items but a
   stale non-zero total, with no rollback. Fixed by moving all three
   writes into one atomic Postgres function
   (`supabase/migrations/060_quotation_atomic_save.sql`), called via a
   single `.rpc()`.
3. `QuotationItemInput` (Task 3) is intentionally narrow — it carries
   only what `computeQuotationTotals` needs for arithmetic. But the
   original `saveQuotationItems` read exclusively from that narrow type,
   so no item ever actually got a `description`, `sizeW`/`sizeH`,
   `itemCode`, or catalog `productId` persisted — every saved item would
   show blank text with no dimensions. Fixed with a new
   `QuotationItemToSave` type (`extends QuotationItemInput`) carrying the
   display fields, which is what `saveQuotationItems` now accepts.

**Files:**
- Create: `src/lib/quotations/types.ts`
- Create: `supabase/migrations/060_quotation_atomic_save.sql`
- Create: `src/lib/quotations/crud.ts`
- Test: `src/lib/quotations/crud.test.ts`

**Interfaces:**
- Consumes: `computeQuotationTotals`, `QuotationItemInput` (Task 3); `getNextQuotationReference` (Task 4); `supabaseAdmin` (Task 4).
- Produces: `type Quotation`, `type QuotationItem`, `type QuotationItemToSave`, `mapQuotationRow(row): Quotation`, `mapQuotationItemRow(row): QuotationItem` (Task 6+ API routes and Task 11+ UI import these — **always map a raw Supabase row through these before returning it to a client; never pass a raw row through directly**); `createQuotation(input: CreateQuotationInput): Promise<Quotation>`; `saveQuotationItems(quotationId: string, accountId: string, items: QuotationItemToSave[], orderDiscount?): Promise<void>` (recomputes and writes `subtotal`/`discount_amount`/`total`/`line_total` atomically on every call — server is always the source of truth, per Global Constraints).

- [ ] **Step 1: Write shared types and mappers**

```typescript
// src/lib/quotations/types.ts
export type QuotationStatus = 'draft' | 'sent' | 'won' | 'lost' | 'expired';

export interface Quotation {
  id: string;
  accountId: string;
  reference: string;
  revision: number;
  status: QuotationStatus;
  clientName: string | null;
  clientPhone: string | null;
  clientCompany: string | null;
  location: string | null;
  projectName: string | null;
  subject: string | null;
  currency: string;
  contactId: string | null;
  dealId: string | null;
  assignedTo: string | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  subtotal: number;
  discountAmount: number;
  total: number;
  validUntil: string | null;
  pdfStoragePath: string | null;
}

export interface QuotationItem {
  id: string;
  quotationId: string;
  parentItemId: string | null;
  productId: string | null;
  position: number;
  itemType: 'section' | 'line';
  kind: string | null;
  itemCode: string | null;
  description: string | null;
  descriptionAr: string | null;
  sizeW: number | null;
  sizeH: number | null;
  qty: number | null;
  unitPrice: number | null;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  lineTotal: number;
}

// Postgres/PostgREST returns snake_case columns; the app works in
// camelCase throughout. A bare cast (`row as Quotation`) silently
// produces `undefined` for every field whose name isn't spelled
// identically in both conventions — found in Task 5's review, where
// only `reference`/`status` happened to match and hid the bug from the
// original test. Every quotation row reaching a client MUST go through
// this mapper.
export function mapQuotationRow(row: Record<string, any>): Quotation {
  return {
    id: row.id,
    accountId: row.account_id,
    reference: row.reference,
    revision: row.revision,
    status: row.status,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientCompany: row.client_company,
    location: row.location,
    projectName: row.project_name,
    subject: row.subject,
    currency: row.currency,
    contactId: row.contact_id,
    dealId: row.deal_id,
    assignedTo: row.assigned_to,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    subtotal: row.subtotal,
    discountAmount: row.discount_amount,
    total: row.total,
    validUntil: row.valid_until,
    pdfStoragePath: row.pdf_storage_path,
  };
}

export function mapQuotationItemRow(row: Record<string, any>): QuotationItem {
  return {
    id: row.id,
    quotationId: row.quotation_id,
    parentItemId: row.parent_item_id,
    productId: row.product_id,
    position: row.position,
    itemType: row.item_type,
    kind: row.kind,
    itemCode: row.item_code,
    description: row.description,
    descriptionAr: row.description_ar,
    sizeW: row.size_w,
    sizeH: row.size_h,
    qty: row.qty,
    unitPrice: row.unit_price,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    lineTotal: row.line_total,
  };
}
```

- [ ] **Step 2: Write the atomic-save migration**

```sql
-- ============================================================
-- 060_quotation_atomic_save.sql
--
-- save_quotation_items() wraps delete-existing-items, insert-new-items,
-- and update-quotation-totals in ONE Postgres function, so all three
-- writes commit or roll back together. Fixes a real data-loss window
-- found in Task 5's review: three separate supabase-js calls (no
-- client-side transaction support) meant an insert failing after the
-- delete succeeded left a quotation with zero items but a stale
-- non-zero total, with no recovery path.
--
-- p_items is a jsonb array -- supabase-js's .rpc() accepts a plain JS
-- array/object for a jsonb parameter directly. Each element's own `id`
-- must be a real UUID generated by the CALLER (crypto.randomUUID()
-- client-side -- see the Task 13 fix), not a placeholder string, so a
-- child item's parent_item_id can reference a sibling item in the SAME
-- batch by its real id before either row exists in the table yet.
--
-- Authorization mirrors quotation_items_write (059) exactly: admin, or
-- the quotation's own assigned agent, and nobody else.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION save_quotation_items(
  p_quotation_id uuid,
  p_account_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount_amount numeric,
  p_total numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM quotations q
    WHERE q.id = p_quotation_id
      AND (
        is_account_member(q.account_id, 'admin')
        OR (is_account_member(q.account_id, 'agent')
            AND q.assigned_to = (SELECT id FROM profiles WHERE profiles.user_id = auth.uid()))
      )
  ) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM quotation_items WHERE quotation_id = p_quotation_id;

  INSERT INTO quotation_items (
    id, quotation_id, account_id, parent_item_id, product_id, position,
    item_type, kind, item_code, description, description_ar,
    size_w, size_h, qty, unit_price, discount_type, discount_value, line_total
  )
  SELECT
    (elem->>'id')::uuid,
    p_quotation_id,
    p_account_id,
    NULLIF(elem->>'parent_item_id', '')::uuid,
    NULLIF(elem->>'product_id', '')::uuid,
    (elem->>'position')::integer,
    elem->>'item_type',
    elem->>'kind',
    elem->>'item_code',
    elem->>'description',
    elem->>'description_ar',
    (elem->>'size_w')::numeric,
    (elem->>'size_h')::numeric,
    COALESCE((elem->>'qty')::numeric, 1),
    (elem->>'unit_price')::numeric,
    elem->>'discount_type',
    (elem->>'discount_value')::numeric,
    COALESCE((elem->>'line_total')::numeric, 0)
  FROM jsonb_array_elements(p_items) AS elem;

  UPDATE quotations
  SET subtotal = p_subtotal, discount_amount = p_discount_amount, total = p_total
  WHERE id = p_quotation_id;
END;
$$;

ALTER FUNCTION save_quotation_items(uuid, uuid, jsonb, numeric, numeric, numeric) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION save_quotation_items(uuid, uuid, jsonb, numeric, numeric, numeric) TO authenticated, service_role;
```

Apply and verify per this repo's actual process (hand-run in the Supabase
SQL editor — see Task 1). Verification: call `save_quotation_items` with
a real `quotation_id` you're NOT the assigned agent for (and aren't
admin) — expect `42501 Unauthorized`. Then call it with a valid
quotation and a small items array, and confirm `select * from
quotation_items where quotation_id = '<id>'` shows the rows with
`description`/`size_w`/`size_h` actually populated — the exact fields
the original version silently dropped.

- [ ] **Step 3: Write the failing tests**

```typescript
import { describe, expect, it, vi } from 'vitest';
import type { QuotationItemToSave } from './crud';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ rpc, from }),
}));
vi.mock('./reference', () => ({
  getNextQuotationReference: vi.fn().mockResolvedValue('HT-26-PIV-001'),
}));

import { createQuotation, saveQuotationItems } from './crud';
import { mapQuotationRow, mapQuotationItemRow } from './types';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['insert', 'update', 'select', 'eq', 'delete'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(finalResult);
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

describe('mapQuotationRow', () => {
  it('maps every snake_case column to its camelCase field, not just the ones that happen to match', () => {
    const row = {
      id: 'q-1', account_id: 'acc-1', reference: 'HT-26-PIV-001', revision: 0, status: 'draft',
      client_name: 'Ahmed', client_phone: '+97455509200', client_company: 'Al Sulaiti Villas',
      location: 'Al Waab', project_name: 'Private villa', subject: 'Pivot Door', currency: 'QAR',
      contact_id: null, deal_id: null, assigned_to: 'p-1', discount_type: null, discount_value: null,
      subtotal: 3600, discount_amount: 0, total: 3600, valid_until: '2026-03-01', pdf_storage_path: null,
    };
    const result = mapQuotationRow(row);
    expect(result.accountId).toBe('acc-1');
    expect(result.clientName).toBe('Ahmed');
    expect(result.projectName).toBe('Private villa');
    expect(result.assignedTo).toBe('p-1');
  });
});

describe('mapQuotationItemRow', () => {
  it('maps size and description fields, not just the arithmetic ones', () => {
    const row = {
      id: 'i-1', quotation_id: 'q-1', parent_item_id: null, product_id: null, position: 0,
      item_type: 'line', kind: null, item_code: 'D01', description: 'Pivot door', description_ar: null,
      size_w: 1.74, size_h: 3.86, qty: 1, unit_price: 16000, discount_type: null, discount_value: null,
      line_total: 16000,
    };
    const result = mapQuotationItemRow(row);
    expect(result.description).toBe('Pivot door');
    expect(result.sizeW).toBe(1.74);
    expect(result.sizeH).toBe(3.86);
  });
});

describe('createQuotation', () => {
  it('fetches a reference number, inserts, and returns a fully-mapped Quotation', async () => {
    const inserted = {
      id: 'q-1', reference: 'HT-26-PIV-001', account_id: 'acc-1', status: 'draft',
      client_name: 'Ahmed', subtotal: 0, discount_amount: 0, total: 0,
    };
    from.mockReturnValueOnce(chain({ data: inserted, error: null }));

    const result = await createQuotation({ accountId: 'acc-1', productCode: 'PIV', currency: 'QAR' });

    expect(from).toHaveBeenCalledWith('quotations');
    expect(result.reference).toBe('HT-26-PIV-001');
    expect(result.status).toBe('draft');
    expect(result.accountId).toBe('acc-1'); // the field the original bug silently dropped
    expect(result.clientName).toBe('Ahmed');
  });
});

describe('saveQuotationItems', () => {
  it('recomputes totals server-side and saves atomically via one RPC call, with description/size fields intact', async () => {
    rpc.mockResolvedValueOnce({ error: null });

    const items: QuotationItemToSave[] = [{
      id: 'a1111111-1111-1111-1111-111111111111', itemType: 'line', qty: 1, unitPrice: 3600,
      description: 'Electric roll-up door', sizeW: 3.66, sizeH: 2.6,
    }];
    await saveQuotationItems('q-1', 'acc-1', items);

    expect(rpc).toHaveBeenCalledWith('save_quotation_items', expect.objectContaining({
      p_quotation_id: 'q-1',
      p_account_id: 'acc-1',
      p_subtotal: 3600,
      p_discount_amount: 0,
      p_total: 3600,
    }));
    const call = rpc.mock.calls[0][1];
    expect(call.p_items[0].description).toBe('Electric roll-up door');
    expect(call.p_items[0].size_w).toBe(3.66);
  });

  it('throws with the Postgres error message on failure, e.g. the Unauthorized case', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'Unauthorized' } });
    const items: QuotationItemToSave[] = [{ id: 'a1111111-1111-1111-1111-111111111111', itemType: 'line', qty: 1, unitPrice: 100 }];
    await expect(saveQuotationItems('q-1', 'acc-1', items)).rejects.toThrow('Unauthorized');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/lib/quotations/crud.test.ts`
Expected: FAIL — `Cannot find module './crud'` (and the two `mapQuotation*` tests fail against the not-yet-widened `types.ts` if Step 1 wasn't done first — do Step 1 before this step).

- [ ] **Step 5: Write the implementation**

```typescript
// src/lib/quotations/crud.ts
import { supabaseAdmin } from './admin-client';
import { getNextQuotationReference } from './reference';
import { computeQuotationTotals, type QuotationItemInput, type OrderDiscount } from './totals';
import { mapQuotationRow, type Quotation } from './types';

export interface CreateQuotationInput {
  accountId: string;
  productCode: string;
  currency: string;
  createdBy?: string;
  assignedTo?: string;
  contactId?: string;
  dealId?: string;
  clientName?: string;
  clientPhone?: string;
  clientCompany?: string;
}

// Wider than QuotationItemInput (Task 3), which stays narrow on purpose —
// it only carries what computeQuotationTotals needs for arithmetic. This
// is what actually gets persisted, so it carries the display fields too.
export interface QuotationItemToSave extends QuotationItemInput {
  productId?: string;
  itemCode?: string;
  description?: string;
  descriptionAr?: string;
  sizeW?: number;
  sizeH?: number;
}

export async function createQuotation(input: CreateQuotationInput): Promise<Quotation> {
  const reference = await getNextQuotationReference(input.accountId, input.productCode);

  const { data, error } = await supabaseAdmin()
    .from('quotations')
    .insert({
      account_id: input.accountId,
      reference,
      currency: input.currency,
      created_by: input.createdBy ?? null,
      assigned_to: input.assignedTo ?? null,
      contact_id: input.contactId ?? null,
      deal_id: input.dealId ?? null,
      client_name: input.clientName ?? null,
      client_phone: input.clientPhone ?? null,
      client_company: input.clientCompany ?? null,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapQuotationRow(data);
}

export async function saveQuotationItems(
  quotationId: string,
  accountId: string,
  items: QuotationItemToSave[],
  orderDiscount?: OrderDiscount,
): Promise<void> {
  const totals = computeQuotationTotals(items, orderDiscount);

  const payload = items.map((item, index) => ({
    id: item.id,
    parent_item_id: item.parentItemId ?? null,
    product_id: item.productId ?? null,
    position: index,
    item_type: item.itemType,
    kind: item.kind ?? null,
    item_code: item.itemCode ?? null,
    description: item.description ?? null,
    description_ar: item.descriptionAr ?? null,
    size_w: item.sizeW ?? null,
    size_h: item.sizeH ?? null,
    qty: item.qty ?? 1,
    unit_price: item.unitPrice ?? 0,
    discount_type: item.discountType ?? null,
    discount_value: item.discountValue ?? null,
    line_total: totals.itemTotals[item.id] ?? 0,
  }));

  const { error } = await supabaseAdmin().rpc('save_quotation_items', {
    p_quotation_id: quotationId,
    p_account_id: accountId,
    p_items: payload,
    p_subtotal: totals.subtotal,
    p_discount_amount: totals.discountAmount,
    p_total: totals.total,
  });
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/lib/quotations/crud.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/quotations/types.ts supabase/migrations/060_quotation_atomic_save.sql \
  src/lib/quotations/crud.ts src/lib/quotations/crud.test.ts
git commit -m "feat(quotations): add quotation CRUD with mapped rows and atomic item save"
```

---

### Task 6: Quotations API routes

**Files:**
- Create: `src/app/api/quotations/route.ts`
- Create: `src/app/api/quotations/[id]/route.ts`
- Test: `src/app/api/quotations/route.test.ts`

**Interfaces:**
- Consumes: `createQuotation`, `saveQuotationItems`, `mapQuotationRow`, `mapQuotationItemRow` (Task 5).
- Produces: `POST /api/quotations`, `GET /api/quotations`, `GET /api/quotations/[id]`, `PATCH /api/quotations/[id]`.

**Note (post Task-5-review):** any route that returns a quotation row (or
its items) to the client must run it through `mapQuotationRow`/
`mapQuotationItemRow` first — a raw Supabase row is snake_case and the
client-side `Quotation`/`QuotationItem` types are camelCase. `POST` below
is already correct because `createQuotation` maps internally; `GET` and
`PATCH` do their own raw `.select()` calls and must map explicitly.

Follows the existing route-handler pattern in
`src/app/api/pipelines/deals/[id]/move/route.ts` (Next.js App Router route
handlers, one file per resource).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/quotations/crud', () => ({
  createQuotation: vi.fn().mockResolvedValue({ id: 'q-1', reference: 'HT-26-PIV-001', status: 'draft' }),
}));

import { POST } from './route';

describe('POST /api/quotations', () => {
  it('creates a quotation and returns it', async () => {
    const req = new Request('http://test/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'acc-1', productCode: 'PIV', currency: 'QAR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.reference).toBe('HT-26-PIV-001');
  });

  it('rejects a request with no productCode', async () => {
    const req = new Request('http://test/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'acc-1', currency: 'QAR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/quotations/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/quotations/route.ts
import { NextResponse } from 'next/server';
import { createQuotation } from '@/lib/quotations/crud';

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.productCode) {
    return NextResponse.json({ error: 'productCode is required' }, { status: 400 });
  }
  const quotation = await createQuotation(body);
  return NextResponse.json(quotation, { status: 201 });
}
```

```typescript
// src/app/api/quotations/[id]/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
import { saveQuotationItems } from '@/lib/quotations/crud';
import { mapQuotationRow, mapQuotationItemRow } from '@/lib/quotations/types';

// Shared by GET and PATCH — both return the same shape. Keeping the
// nested-items mapping in one place means a future field added to
// QuotationItem only needs mapQuotationItemRow updated, not every caller.
function mapQuotationWithItems(row: any) {
  const { quotation_items, ...quotationRow } = row;
  return {
    ...mapQuotationRow(quotationRow),
    items: (quotation_items ?? []).map(mapQuotationItemRow),
  };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { data, error } = await supabaseAdmin()
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('id', params.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(mapQuotationWithItems(data));
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  const admin = supabaseAdmin();

  if (body.items) {
    await saveQuotationItems(params.id, body.accountId, body.items, body.orderDiscount);
  }

  const { fields } = body;
  if (fields) {
    const { error } = await admin.from('quotations').update(fields).eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data } = await admin.from('quotations').select('*, quotation_items(*)').eq('id', params.id).single();
  return NextResponse.json(mapQuotationWithItems(data));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/quotations/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quotations/
git commit -m "feat(quotations): add quotation create/read/update API routes"
```

---

### Task 7: Catalog item search + create-on-the-fly API

**Files:**
- Create: `src/app/api/catalog-items/route.ts`
- Test: `src/app/api/catalog-items/route.test.ts`

**Interfaces:**
- Produces: `GET /api/catalog-items?q=<search>` (autocomplete, `ILIKE` search per Global Constraints), `POST /api/catalog-items` (the "save to catalog" action from the item editor).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from 'vitest';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['select', 'ilike', 'insert', 'eq', 'limit'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
  builder.single = vi.fn().mockResolvedValue(finalResult);
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

const from = vi.fn();
vi.mock('@/lib/quotations/admin-client', () => ({
  supabaseAdmin: () => ({ from }),
}));

import { GET, POST } from './route';

describe('GET /api/catalog-items', () => {
  it('searches by name using ILIKE', async () => {
    const searchChain = chain({ data: [{ id: 'c-1', name: 'Electronic Lock' }], error: null });
    from.mockReturnValueOnce(searchChain);
    const req = new Request('http://test/api/catalog-items?q=lock&accountId=acc-1');
    const res = await GET(req);
    expect(searchChain.ilike).toHaveBeenCalledWith('name', '%lock%');
    expect((await res.json())[0].name).toBe('Electronic Lock');
  });
});

describe('POST /api/catalog-items', () => {
  it('creates a new catalog entry', async () => {
    const insertChain = chain({ data: { id: 'c-2', name: 'Custom Handle' }, error: null });
    from.mockReturnValueOnce(insertChain);
    const req = new Request('http://test/api/catalog-items', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'acc-1', name: 'Custom Handle', category: 'accessory' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Custom Handle');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/catalog-items/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/catalog-items/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/quotations/admin-client';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const accountId = url.searchParams.get('accountId');

  let query = supabaseAdmin().from('catalog_items').select('*').eq('account_id', accountId).eq('status', 'active');
  if (q) query = query.ilike('name', `%${q}%`);

  const { data, error } = await query.limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || !body.accountId) {
    return NextResponse.json({ error: 'name and accountId are required' }, { status: 400 });
  }
  const { data, error } = await supabaseAdmin()
    .from('catalog_items')
    .insert({
      account_id: body.accountId,
      created_by: body.createdBy ?? null,
      category: body.category ?? 'product',
      name: body.name,
      name_ar: body.nameAr ?? null,
      description: body.description ?? null,
      description_ar: body.descriptionAr ?? null,
      sku: body.sku ?? null,
      default_unit_price: body.defaultUnitPrice ?? null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/catalog-items/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/catalog-items/
git commit -m "feat(quotations): add catalog search and create-on-the-fly API"
```

---

### Task 8: Branded HTML builder (pure, testable — no Playwright)

**Files:**
- Create: `src/lib/quotations/templates/quotation.html` (vendored copy)
- Create: `src/lib/quotations/build-html.ts`
- Test: `src/lib/quotations/build-html.test.ts`

**Interfaces:**
- Consumes: `Quotation`, `QuotationItem` (Task 5); `amountInWordsBilingual` (Task 2).
- Produces: `buildQuotationHtml(quotation: Quotation, items: QuotationItem[]): string` — the filled HTML string. Kept separate from the Playwright screenshot call (Task 9) specifically so the data-substitution logic is unit-testable without spinning a browser.

**Decided during pre-flight review, before this task started:** the
original draft read the template via a relative path reaching across into
the sibling `04_Website` repo (`../../04_Website/Company Essential/
Stationery/quotation.html`). That only works if both repos happen to sit
in sibling folders at exactly this depth on whatever machine runs it —
true in local dev, not guaranteed on the VPS deploy. This task instead
**vendors a copy** of the approved template into `wacrm` itself, so PDF
generation is self-contained regardless of deployment layout. Tradeoff,
stated plainly: if the source template in `04_Website` changes later,
this copy needs a manual re-sync — the same tradeoff any vendored asset
carries, and worth a one-line reminder in the copy's own header comment.

- [ ] **Step 1: Vendor the template**

```bash
mkdir -p src/lib/quotations/templates
cp "/Volumes/Extreme SSD/Projects/Hitechub Qatar/04_Website/Company Essential/Stationery/quotation.html" \
   src/lib/quotations/templates/quotation.html
```

(Absolute source path, deliberately — a relative path from inside a
worktree under `wacrm/.worktrees/<name>/` is one directory-count mistake
away from silently copying nothing or the wrong file. This command runs
once, by hand, as part of this task; it is not application code, so it
does not need to be portable.)

Add a one-line comment at the top of the copied file (do not otherwise
edit its content — it is the approved design, verbatim):

```html
<!-- Vendored from 04_Website/Company Essential/Stationery/quotation.html.
     If the source template changes, re-copy it here — this file is not
     read from the other repo at runtime. See plan Task 8. -->
```

- [ ] **Step 2: Write the failing tests**

```typescript
import { describe, expect, it } from 'vitest';
import { buildQuotationHtml } from './build-html';
import type { Quotation, QuotationItem } from './types';

const quotation: Quotation = {
  id: 'q-1', accountId: 'acc-1', reference: 'HT-26-RSD-015', revision: 0, status: 'draft',
  clientName: null, clientPhone: null, clientCompany: 'Al Sulaiti Villas', location: null,
  projectName: null, subject: 'Roll Up Shutter', currency: 'QAR', contactId: null, dealId: null,
  assignedTo: null, discountType: null, discountValue: null, subtotal: 3600, discountAmount: 0,
  total: 3600, validUntil: '2026-03-07', pdfStoragePath: null,
};
const items: QuotationItem[] = [{
  id: 'i-1', quotationId: 'q-1', parentItemId: null, productId: null, position: 0, itemType: 'line',
  kind: null, itemCode: 'D01', description: 'Electric roll-up door', descriptionAr: null,
  sizeW: 3.66, sizeH: 2.6, qty: 1, unitPrice: 3600, discountType: null, discountValue: null, lineTotal: 3600,
}];

describe('buildQuotationHtml', () => {
  it('substitutes the reference and total into the template', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).toContain('HT-26-RSD-015');
    expect(html).toContain('Al Sulaiti Villas');
    expect(html).toContain('Electric roll-up door');
  });

  it('includes the bilingual amount in words for the total', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).toContain('Three Thousand Six Hundred Qatari Riyals only');
    expect(html).toContain('ثلاثة آلاف وستمئة ريال قطري فقط لا غير');
  });

  it('does not leave any unfilled template placeholder in the output', () => {
    const html = buildQuotationHtml(quotation, items);
    expect(html).not.toContain('________________');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/quotations/build-html.test.ts`
Expected: FAIL — `Cannot find module './build-html'`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/lib/quotations/build-html.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { amountInWordsBilingual } from './number-to-words';
import type { Quotation, QuotationItem } from './types';

// Vendored, not read from the sibling repo — see Task 8's pre-flight note.
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'quotation.html');

function itemRowHtml(item: QuotationItem): string {
  const size = item.sizeW && item.sizeH ? `${item.sizeW} × ${item.sizeH}` : '—';
  return `
    <tr>
      <td class="code">${item.itemCode ?? ''}</td>
      <td><span class="it">${item.description ?? ''}</span></td>
      <td class="n num">${size}</td>
      <td class="n num">${item.qty ?? 1}</td>
      <td class="n num">${(item.unitPrice ?? 0).toLocaleString()}</td>
      <td class="n num">${item.lineTotal.toLocaleString()}</td>
    </tr>`;
}

export function buildQuotationHtml(quotation: Quotation, items: QuotationItem[]): string {
  let html = readFileSync(TEMPLATE_PATH, 'utf8');
  const words = amountInWordsBilingual(quotation.total);

  html = html.replace('HT-__-___-___', quotation.reference);
  html = html.replace('Supply and installation of ________________', quotation.subject ?? '');
  html = html.replace(/<span class="it">________________<\/span>\s*<span class="spec">________________<\/span>/, '');
  html = html.replace(/________________ Qatari Riyals only/, words.en);
  html = html.replace(/فقط ________________ ريالاً قطرياً لا غير/, words.ar);

  const rows = items
    .filter((i) => i.itemType === 'line' && !i.parentItemId)
    .map(itemRowHtml)
    .join('\n');
  html = html.replace(/<tr>\s*<td class="code">D01<\/td>[\s\S]*?<\/tr>/, rows);

  return html;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/lib/quotations/build-html.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quotations/templates/quotation.html src/lib/quotations/build-html.ts src/lib/quotations/build-html.test.ts
git commit -m "feat(quotations): vendor branded template and add HTML filler"
```

---

### Task 9: PDF generation (Playwright) and storage upload

**Files:**
- Modify: `package.json` (add `playwright` dependency)
- Create: `src/lib/quotations/pdf.ts`
- Create: `supabase/migrations/061_quotation_pdfs_storage.sql`
- Test: `src/lib/quotations/pdf.test.ts`

**Interfaces:**
- Consumes: `buildQuotationHtml` (Task 8).
- Produces: `generateQuotationPdf(quotation: Quotation, items: QuotationItem[]): Promise<{ storagePath: string; publicUrl: string }>`.

**⚠️ Deploy step, not just `npm install`:** after this task's dependency is
added, the VPS deploy process must also run
`npx playwright install chromium --with-deps` — the npm package alone does
not include the browser binary. Add this line to the deploy script/runbook
when this task ships; it is called out here and in the spec so it is not
missed.

- [ ] **Step 1: Add the dependency**

```bash
npm install playwright
```

- [ ] **Step 2: Write the storage bucket migration**

```sql
-- ============================================================
-- 061_quotation_pdfs_storage.sql
--
-- Creates the `quotation-pdfs` bucket. Public, matching `chat_media`
-- (023) exactly and for the same reason: WhatsApp's delivery servers
-- fetch the file URL without authentication when sendMediaMessage
-- attaches it. Protection is the same as chat_media already relies
-- on -- account-scoped write RLS plus unguessable random paths
-- (quotation_id, a uuid, not a sequential id).
--
-- See docs/superpowers/specs/2026-08-14-quotations-design.md,
-- Architecture -> PDF generation.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quotation-pdfs', 'quotation-pdfs', TRUE, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Quotation PDFs are publicly readable" ON storage.objects;
CREATE POLICY "Quotation PDFs are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quotation-pdfs');

-- Path convention: quotation-pdfs/{quotation_id}/rev-{revision}.pdf
-- Write access requires account membership at agent level or above,
-- checked via the quotation the path's first segment names.
DROP POLICY IF EXISTS "Account members can write quotation PDFs" ON storage.objects;
CREATE POLICY "Account members can write quotation PDFs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'quotation-pdfs'
    AND EXISTS (
      SELECT 1 FROM quotations q
      WHERE q.id::text = (storage.foldername(name))[1]
        AND is_account_member(q.account_id, 'agent')
    )
  );
```

- [ ] **Step 3: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';

const upload = vi.fn().mockResolvedValue({ error: null });
const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: 'https://x/quotation-pdfs/q-1/rev-0.pdf' } });
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload, getPublicUrl }) } }),
}));

const screenshotPdf = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
vi.mock('./render', () => ({ renderHtmlToPdf: screenshotPdf }));

vi.mock('./build-html', () => ({ buildQuotationHtml: vi.fn().mockReturnValue('<html></html>') }));

import { generateQuotationPdf } from './pdf';
import type { Quotation, QuotationItem } from './types';

const quotation = { id: 'q-1', revision: 0 } as Quotation;
const items: QuotationItem[] = [];

describe('generateQuotationPdf', () => {
  it('uploads to the quotation-scoped path and returns the public URL', async () => {
    const result = await generateQuotationPdf(quotation, items);
    expect(upload).toHaveBeenCalledWith(
      'q-1/rev-0.pdf',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(result.publicUrl).toBe('https://x/quotation-pdfs/q-1/rev-0.pdf');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/lib/quotations/pdf.test.ts`
Expected: FAIL — `Cannot find module './pdf'`.

- [ ] **Step 5: Write the Playwright render wrapper and the PDF function**

```typescript
// src/lib/quotations/render.ts
//
// Isolated in its own file so pdf.ts's upload/path logic (tested in
// pdf.test.ts, mocked above) never has to actually launch a browser
// in the test suite — only this thin wrapper touches Playwright.
import { chromium } from 'playwright';

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}
```

```typescript
// src/lib/quotations/pdf.ts
import { supabaseAdmin } from './admin-client';
import { buildQuotationHtml } from './build-html';
import { renderHtmlToPdf } from './render';
import type { Quotation, QuotationItem } from './types';

export async function generateQuotationPdf(
  quotation: Quotation,
  items: QuotationItem[],
): Promise<{ storagePath: string; publicUrl: string }> {
  const html = buildQuotationHtml(quotation, items);
  const pdfBuffer = await renderHtmlToPdf(html);

  const storagePath = `${quotation.id}/rev-${quotation.revision}.pdf`;
  const bucket = supabaseAdmin().storage.from('quotation-pdfs');

  const { error } = await bucket.upload(storagePath, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = bucket.getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/lib/quotations/pdf.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 7: Apply the storage migration locally**

Run: `supabase db reset` (or migration up), then verify in the Supabase
dashboard that the `quotation-pdfs` bucket exists and is public.

- [ ] **Step 8: One real end-to-end render, by hand**

The mocked test above proves the upload/path wiring; it does not prove
Playwright can actually render this specific HTML correctly. Once, by
hand: call `generateQuotationPdf` against a real local Supabase instance
with a real quotation, download the resulting PDF, and visually confirm
it matches the approved template — fonts, the gold rule motif, the navy
total band, correct bilingual text direction.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json supabase/migrations/061_quotation_pdfs_storage.sql \
  src/lib/quotations/render.ts src/lib/quotations/pdf.ts src/lib/quotations/pdf.test.ts
git commit -m "feat(quotations): add Playwright PDF generation and storage upload"
```

---

### Task 10: Generate-PDF and Send-via-WhatsApp API routes

**Files:**
- Create: `src/app/api/quotations/[id]/generate-pdf/route.ts`
- Create: `src/app/api/quotations/[id]/send/route.ts`
- Test: `src/app/api/quotations/[id]/send/route.test.ts`

**Interfaces:**
- Consumes: `generateQuotationPdf` (Task 9); `resolveConversationByPhone` (existing, `src/lib/whatsapp/resolve-conversation.ts`).
- Produces: `POST /api/quotations/[id]/generate-pdf`, `POST /api/quotations/[id]/send`.

**Correction made during planning, worth stating plainly:** the spec said
"send reuses `sendMediaMessage`." Reading the actual function (`src/lib/
whatsapp/meta-api.ts:290`) shows it POSTs straight to Meta's API and
dispatches the message immediately — there is no "pending, awaiting
confirmation" state anywhere in this codebase's outbound-message path.
Calling it directly from "Send Quotation" would silently auto-send,
contradicting the explicit "rep confirms before send" decision (and the
spec's own Non-goals). This task does **not** call `sendMediaMessage` or
`sendMessageToConversation` anywhere. Instead, `POST .../send` resolves
the conversation via `resolveConversationByPhone` (confirmed signature:
`(db, accountId, phone, name?)`) and returns a deep link into the
existing inbox at `/inbox?c=<conversationId>` (confirmed pattern, `src/
app/(dashboard)/inbox/page.tsx`) plus the PDF's public URL. The UI (Task
11 wiring) navigates the rep there; they attach and send the PDF through
the inbox's own existing composer — unmodified by this feature, and the
same control they already use for every other attachment today.

- [ ] **Step 1: Write the failing test for send**

```typescript
import { describe, expect, it, vi } from 'vitest';

const resolveConversationByPhone = vi.fn().mockResolvedValue({ id: 'conv-1', accountId: 'acc-1' });
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({ resolveConversationByPhone }));

const from = vi.fn();
vi.mock('@/lib/quotations/admin-client', () => ({
  supabaseAdmin: () => ({ from }),
}));

import { POST } from './route';

describe('POST /api/quotations/[id]/send', () => {
  it('resolves the conversation and returns an inbox deep link, without sending anything itself', async () => {
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve({
              data: {
                id: 'q-1', account_id: 'acc-1', reference: 'HT-26-RSD-015',
                client_name: 'Ahmed', client_phone: '+97455509200', pdf_storage_path: 'q-1/rev-0.pdf',
              },
              error: null,
            }),
        }),
      }),
    });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: { id: 'q-1' } });
    const body = await res.json();

    expect(resolveConversationByPhone).toHaveBeenCalledWith(
      expect.anything(), 'acc-1', '+97455509200', 'Ahmed',
    );
    expect(body.inboxUrl).toBe('/inbox?c=conv-1');
    expect(body.pdfUrl).toContain('q-1/rev-0.pdf');
    expect(res.status).toBe(200);
  });

  it('returns 400 if no PDF has been generated yet', async () => {
    from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { id: 'q-1', pdf_storage_path: null }, error: null }),
        }),
      }),
    });
    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: { id: 'q-1' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/quotations/[id]/send/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementations**

```typescript
// src/app/api/quotations/[id]/generate-pdf/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
import { generateQuotationPdf } from '@/lib/quotations/pdf';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const admin = supabaseAdmin();
  const { data: quotation, error } = await admin
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('id', params.id)
    .single();
  if (error || !quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });

  const revision = quotation.status === 'sent' ? quotation.revision + 1 : quotation.revision;
  const { storagePath, publicUrl } = await generateQuotationPdf(
    { ...quotation, revision },
    quotation.quotation_items,
  );

  await admin.from('quotations').update({ pdf_storage_path: storagePath, revision }).eq('id', params.id);
  return NextResponse.json({ storagePath, publicUrl, revision });
}
```

```typescript
// src/app/api/quotations/[id]/send/route.ts
//
// Deliberately does NOT call sendMediaMessage/sendMessageToConversation —
// see the Task 10 note above. This route only resolves where the PDF
// should be attached; a human always does the actual sending, in the
// existing inbox UI, untouched by this route.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/quotations/admin-client';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const admin = supabaseAdmin();
  const { data: quotation, error } = await admin
    .from('quotations')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !quotation) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
  if (!quotation.pdf_storage_path) {
    return NextResponse.json({ error: 'Generate the PDF before sending' }, { status: 400 });
  }

  const conversation = await resolveConversationByPhone(
    admin, quotation.account_id, quotation.client_phone, quotation.client_name,
  );

  const { data: pdfUrlData } = admin.storage.from('quotation-pdfs').getPublicUrl(quotation.pdf_storage_path);

  return NextResponse.json({
    conversationId: conversation.id,
    inboxUrl: `/inbox?c=${conversation.id}`,
    pdfUrl: pdfUrlData.publicUrl,
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/quotations/[id]/send/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quotations/[id]/generate-pdf/ src/app/api/quotations/[id]/send/
git commit -m "feat(quotations): add generate-PDF route and send-handoff route (resolves conversation only, never sends)"
```

---

### Task 11: Quotations list page and nav entry

**Files:**
- Create: `src/app/(dashboard)/quotations/page.tsx`
- Create: `src/components/quotations/quotation-list.tsx`
- Modify: nav config file that currently lists Contacts/Pipelines/Inbox (locate via `grep -rn "Pipelines" src/components/layout/`, then add a matching entry — the exact file/line depends on the layout component found; add "Quotations" following the identical pattern the existing entries use.)

**Interfaces:**
- Consumes: `GET /api/quotations` (extend Task 6 to support listing — add to that route's `GET` handler as part of this task since it wasn't in the original scope: filter by `status`/search).

- [ ] **Step 1: Extend the quotations GET route to list**

```typescript
// Add to src/app/api/quotations/route.ts, alongside the existing POST:
import { supabaseAdmin } from '@/lib/quotations/admin-client';
import { mapQuotationRow } from '@/lib/quotations/types';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId');
  const status = url.searchParams.get('status');

  let query = supabaseAdmin().from('quotations').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json((data ?? []).map(mapQuotationRow));
}
```

- [ ] **Step 2: Write the list component**

```tsx
// src/components/quotations/quotation-list.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Quotation } from '@/lib/quotations/types';

export function QuotationList({ accountId }: { accountId: string }) {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [status, setStatus] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [productCode, setProductCode] = useState('GEN');

  useEffect(() => {
    const params = new URLSearchParams({ accountId, ...(status ? { status } : {}) });
    fetch(`/api/quotations?${params}`)
      .then((res) => res.json())
      .then(setQuotations);
  }, [accountId, status]);

  // Standalone creation — no deal or contact required, per spec Goals:
  // "a quotation can exist standalone... optionally linked... later."
  // The deal-card entry point (Task 14) is a second, pre-filled path into
  // the same createQuotation call; this is the one with no prerequisites.
  async function createStandalone() {
    setCreating(true);
    const res = await fetch('/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ accountId, productCode, currency: 'QAR' }),
    });
    const created = await res.json();
    window.location.href = `/quotations/${created.id}`;
  }

  return (
    <div>
      <div>
        <select value={productCode} onChange={(e) => setProductCode(e.target.value)}>
          <option value="PIV">Pivot Door</option>
          <option value="RSD">Roll-Up Shutter</option>
          <option value="STL">Steel Door</option>
          <option value="UPV">UPVC</option>
          <option value="GEN">General</option>
        </select>
        <button onClick={createStandalone} disabled={creating}>
          {creating ? 'Creating…' : '+ New Quotation'}
        </button>
      </div>
      <select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="sent">Sent</option>
        <option value="won">Won</option>
        <option value="lost">Lost</option>
      </select>
      <table>
        <thead>
          <tr>
            <th>Reference</th><th>Client</th><th>Status</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          {quotations.map((q) => (
            <tr key={q.id}>
              <td><Link href={`/quotations/${q.id}`}>{q.reference}</Link></td>
              <td>{q.clientCompany ?? q.clientName ?? '—'}</td>
              <td>{q.status}</td>
              <td>{q.total.toLocaleString()} {q.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Write the page**

```tsx
// src/app/(dashboard)/quotations/page.tsx
import { QuotationList } from '@/components/quotations/quotation-list';
import { getCurrentAccountId } from '@/lib/account'; // existing helper, matches other dashboard pages

export default async function QuotationsPage() {
  const accountId = await getCurrentAccountId();
  return (
    <div>
      <h1>Quotations</h1>
      <QuotationList accountId={accountId} />
    </div>
  );
}
```

- [ ] **Step 4: Locate and extend the nav config**

```bash
grep -rn "Pipelines" src/components/layout/
```

Add a "Quotations" entry pointing at `/quotations`, in the exact shape the
grep result shows the "Pipelines"/"Contacts" entries already use — same
icon-component pattern, same array position style. (No literal code block
here: the shape depends entirely on what the grep surfaces, and copying a
guessed shape risks being wrong in a way that silently doesn't render.
Match what's actually there.)

- [ ] **Step 5: Manual check**

Run: `npm run dev`, sign in, confirm "Quotations" appears in the nav and
`/quotations` renders an empty list with no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/quotations/ src/components/quotations/quotation-list.tsx src/components/layout/
git commit -m "feat(quotations): add quotations list page and nav entry"
```

---

### Task 12: Quotation detail page — party/project form, status, and PDF/send actions

**Files:**
- Create: `src/app/(dashboard)/quotations/[id]/page.tsx`
- Create: `src/components/quotations/quotation-form.tsx`
- Create: `src/components/quotations/quotation-actions.tsx`

**Interfaces:**
- Consumes: `GET /api/quotations/[id]`, `PATCH /api/quotations/[id]` (Task 6); `POST /api/quotations/[id]/generate-pdf`, `POST /api/quotations/[id]/send` (Task 10). This is the only UI surface that calls those two routes — without it they exist but nothing reaches them.

- [ ] **Step 1: Write the form component**

```tsx
// src/components/quotations/quotation-form.tsx
'use client';

import { useState } from 'react';
import type { Quotation } from '@/lib/quotations/types';

export function QuotationForm({ quotation, onSaved }: { quotation: Quotation; onSaved: (q: Quotation) => void }) {
  const [fields, setFields] = useState({
    clientName: quotation.clientName ?? '',
    clientPhone: quotation.clientPhone ?? '',
    clientCompany: quotation.clientCompany ?? '',
    location: quotation.location ?? '',
    projectName: quotation.projectName ?? '',
    subject: quotation.subject ?? '',
    validUntil: quotation.validUntil ?? '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/quotations/${quotation.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields }),
    });
    const updated = await res.json();
    onSaved(updated);
    setSaving(false);
  }

  return (
    <div>
      <label>Client name<input value={fields.clientName} onChange={(e) => setFields({ ...fields, clientName: e.target.value })} /></label>
      <label>Client phone<input value={fields.clientPhone} onChange={(e) => setFields({ ...fields, clientPhone: e.target.value })} /></label>
      <label>Company<input value={fields.clientCompany} onChange={(e) => setFields({ ...fields, clientCompany: e.target.value })} /></label>
      <label>Location<input value={fields.location} onChange={(e) => setFields({ ...fields, location: e.target.value })} /></label>
      <label>Project<input value={fields.projectName} onChange={(e) => setFields({ ...fields, projectName: e.target.value })} /></label>
      <label>Subject<input value={fields.subject} onChange={(e) => setFields({ ...fields, subject: e.target.value })} /></label>
      <label>Valid until<input type="date" value={fields.validUntil} onChange={(e) => setFields({ ...fields, validUntil: e.target.value })} /></label>
      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
}
```

- [ ] **Step 2: Write the actions component (Generate PDF, Send)**

```tsx
// src/components/quotations/quotation-actions.tsx
'use client';

import { useState } from 'react';
import type { Quotation } from '@/lib/quotations/types';

// The only caller of the Task 10 routes. "Send" never sends anything
// itself — it navigates the rep into the existing inbox thread with the
// PDF link, per the correction noted in Task 10: this codebase has no
// staged/pending outbound-message state, so a human doing the actual
// attach-and-send in the inbox IS the confirmation step, not a UI
// nicety layered on top of an auto-send call.
export function QuotationActions({ quotation, onGenerated }: { quotation: Quotation; onGenerated: (q: Quotation) => void }) {
  const [busy, setBusy] = useState<'pdf' | 'send' | null>(null);

  async function generatePdf() {
    setBusy('pdf');
    const res = await fetch(`/api/quotations/${quotation.id}/generate-pdf`, { method: 'POST' });
    const { storagePath, revision } = await res.json();
    onGenerated({ ...quotation, pdfStoragePath: storagePath, revision });
    setBusy(null);
  }

  async function prepareSend() {
    setBusy('send');
    const res = await fetch(`/api/quotations/${quotation.id}/send`, { method: 'POST' });
    if (!res.ok) {
      const { error } = await res.json();
      alert(error);
      setBusy(null);
      return;
    }
    const { inboxUrl, pdfUrl } = await res.json();
    alert(`Attach and send this PDF in the conversation that's about to open:\n${pdfUrl}`);
    window.location.href = inboxUrl;
  }

  return (
    <div>
      <button onClick={generatePdf} disabled={busy !== null}>
        {busy === 'pdf' ? 'Generating…' : quotation.pdfStoragePath ? 'Regenerate PDF' : 'Generate PDF'}
      </button>
      <button onClick={prepareSend} disabled={busy !== null || !quotation.pdfStoragePath}>
        {busy === 'send' ? 'Opening…' : 'Send via WhatsApp'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the detail page**

```tsx
// src/app/(dashboard)/quotations/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { QuotationForm } from '@/components/quotations/quotation-form';
import { QuotationActions } from '@/components/quotations/quotation-actions';
import type { Quotation } from '@/lib/quotations/types';

export default function QuotationDetailPage({ params }: { params: { id: string } }) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);

  useEffect(() => {
    fetch(`/api/quotations/${params.id}`).then((res) => res.json()).then(setQuotation);
  }, [params.id]);

  if (!quotation) return <div>Loading…</div>;

  return (
    <div>
      <h1>{quotation.reference} <span>({quotation.status})</span></h1>
      <QuotationForm quotation={quotation} onSaved={setQuotation} />
      <QuotationActions quotation={quotation} onGenerated={setQuotation} />
    </div>
  );
}
```

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open a quotation created via Task 11's list (or
directly `POST /api/quotations` once via curl to seed one), edit the
fields, save, reload, confirm the values persisted. Click Generate PDF,
confirm it succeeds and "Send via WhatsApp" becomes enabled; click it,
confirm it navigates to `/inbox?c=<id>` for the right conversation without
anything having been sent automatically.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/quotations/[id]/" src/components/quotations/quotation-form.tsx \
  src/components/quotations/quotation-actions.tsx
git commit -m "feat(quotations): add quotation detail page with party/project form and PDF/send actions"
```

---

### Task 13: Item tree editor with catalog autocomplete and discounts

**Files:**
- Create: `src/components/quotations/quotation-item-tree.tsx`
- Create: `src/components/quotations/catalog-item-picker.tsx`
- Modify: `src/app/(dashboard)/quotations/[id]/page.tsx` (render the tree below the form)

**Interfaces:**
- Consumes: `computeQuotationTotals` (Task 3); `QuotationItemToSave` (Task 5 — **not** `QuotationItemInput`; that type is arithmetic-only and doesn't carry `description`/`sizeW`/`sizeH`, see Task 5's revision note); `GET`/`POST /api/catalog-items` (Task 7); `PATCH /api/quotations/[id]` with an `items` body (Task 6).

**Note (post Task-5-review):** the state type below is `QuotationItemToSave`, not
`QuotationItemInput` — using the narrow type here was part of the same
defect that made `saveQuotationItems` drop description/size fields.
`newId()` generates a real UUID (`crypto.randomUUID()`), not a placeholder
string — a child item's `parentItemId` must be a valid `uuid` before it's
ever sent to the database (the atomic save function resolves parent-child
links within one batch by real id, not by re-mapping temp strings).

- [ ] **Step 1: Write the catalog picker**

```tsx
// src/components/quotations/catalog-item-picker.tsx
'use client';

import { useState } from 'react';
import type { QuotationItemToSave } from '@/lib/quotations/crud';

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  defaultUnitPrice: number | null;
}

export function CatalogItemPicker({
  accountId,
  onPick,
}: {
  accountId: string;
  onPick: (item: Partial<QuotationItemToSave> & { productId?: string; description?: string; saveToCatalog?: boolean; newName?: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [saveNew, setSaveNew] = useState(true);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) return setResults([]);
    const res = await fetch(`/api/catalog-items?q=${encodeURIComponent(q)}&accountId=${accountId}`);
    setResults(await res.json());
  }

  return (
    <div>
      <input value={query} onChange={(e) => search(e.target.value)} placeholder="Search catalog or type new…" />
      {results.map((r) => (
        <button
          key={r.id}
          onClick={() =>
            onPick({ productId: r.id, description: r.name, unitPrice: r.defaultUnitPrice ?? undefined })
          }
        >
          {r.name}
        </button>
      ))}
      {query.length >= 2 && results.length === 0 && (
        <div>
          <button
            onClick={() =>
              onPick({ description: query, newName: saveNew ? query : undefined, saveToCatalog: saveNew })
            }
          >
            Use "{query}" as a new item
          </button>
          <label>
            <input type="checkbox" checked={saveNew} onChange={(e) => setSaveNew(e.target.checked)} />
            Save to catalog for reuse
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write the item tree editor**

```tsx
// src/components/quotations/quotation-item-tree.tsx
'use client';

import { useMemo, useState } from 'react';
import { computeQuotationTotals } from '@/lib/quotations/totals';
import type { QuotationItemToSave } from '@/lib/quotations/crud';
import { CatalogItemPicker } from './catalog-item-picker';

// A real UUID, not a placeholder string — see Task 5's revision note.
// Client-generated v4 UUIDs are safe to use directly as primary keys;
// the DB accepts an explicit id on insert instead of using its own
// gen_random_uuid() default.
const newId = () => crypto.randomUUID();

export function QuotationItemTree({
  quotationId,
  accountId,
  initialItems,
}: {
  quotationId: string;
  accountId: string;
  initialItems: QuotationItemToSave[];
}) {
  const [items, setItems] = useState<QuotationItemToSave[]>(initialItems);
  const totals = useMemo(() => computeQuotationTotals(items), [items]);

  function addProduct() {
    setItems([...items, { id: newId(), itemType: 'line', qty: 1, unitPrice: 0 }]);
  }

  function addChild(parentItemId: string, kind: string) {
    setItems([...items, { id: newId(), itemType: 'line', parentItemId, kind, qty: 1, unitPrice: 0 }]);
  }

  function updateItem(id: string, patch: Partial<QuotationItemToSave>) {
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function save() {
    await fetch(`/api/quotations/${quotationId}`, {
      method: 'PATCH',
      body: JSON.stringify({ accountId, items }),
    });
  }

  const topLevel = items.filter((i) => !i.parentItemId);

  return (
    <div>
      {topLevel.map((product) => (
        <div key={product.id}>
          <CatalogItemPicker
            accountId={accountId}
            onPick={async (picked) => {
              if (picked.saveToCatalog && picked.newName) {
                const res = await fetch('/api/catalog-items', {
                  method: 'POST',
                  body: JSON.stringify({ accountId, name: picked.newName, category: 'product' }),
                });
                const created = await res.json();
                updateItem(product.id, { unitPrice: picked.unitPrice });
                updateItem(product.id, { ...picked, productId: created.id } as Partial<QuotationItemToSave>);
              } else {
                updateItem(product.id, picked as Partial<QuotationItemToSave>);
              }
            }}
          />
          <input
            type="number"
            value={product.qty ?? 1}
            onChange={(e) => updateItem(product.id, { qty: Number(e.target.value) })}
          />
          <input
            type="number"
            value={product.unitPrice ?? 0}
            onChange={(e) => updateItem(product.id, { unitPrice: Number(e.target.value) })}
          />
          <span>{totals.itemTotals[product.id]?.toLocaleString() ?? 0}</span>
          <button onClick={() => addChild(product.id, 'Accessory')}>+ Accessory</button>
          <button onClick={() => addChild(product.id, 'Customization')}>+ Customization</button>

          {items
            .filter((i) => i.parentItemId === product.id)
            .map((child) => (
              <div key={child.id} style={{ marginInlineStart: '24px' }}>
                <span>{child.kind}</span>
                <CatalogItemPicker accountId={accountId} onPick={(picked) => updateItem(child.id, picked as Partial<QuotationItemToSave>)} />
                <input
                  type="number"
                  value={child.qty ?? 1}
                  onChange={(e) => updateItem(child.id, { qty: Number(e.target.value) })}
                />
                <input
                  type="number"
                  value={child.unitPrice ?? 0}
                  onChange={(e) => updateItem(child.id, { unitPrice: Number(e.target.value) })}
                />
                <span>{totals.itemTotals[child.id]?.toLocaleString() ?? 0}</span>
              </div>
            ))}
        </div>
      ))}

      <button onClick={addProduct}>+ Add product</button>

      <div>
        <strong>Subtotal: {totals.subtotal.toLocaleString()}</strong>
        <strong>Total: {totals.total.toLocaleString()}</strong>
      </div>

      <button onClick={save}>Save items</button>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the detail page**

```tsx
// Add to src/app/(dashboard)/quotations/[id]/page.tsx, below <QuotationForm>:
import { QuotationItemTree } from '@/components/quotations/quotation-item-tree';
// ...
<QuotationItemTree quotationId={quotation.id} accountId={quotation.accountId} initialItems={[]} />
```

- [ ] **Step 4: Manual check**

Run: `npm run dev`, open a quotation, add a product, add an accessory
under it, confirm the live total updates as prices change, save, reload,
confirm the items and totals persisted correctly (cross-check against
`computeQuotationTotals`'s own test cases from Task 3 using the same
numbers by hand).

- [ ] **Step 5: Commit**

```bash
git add src/components/quotations/quotation-item-tree.tsx src/components/quotations/catalog-item-picker.tsx \
  "src/app/(dashboard)/quotations/[id]/page.tsx"
git commit -m "feat(quotations): add flexible item tree editor with catalog autocomplete"
```

---

### Task 14: Deal card Quotations section

**Files:**
- Create: `src/components/pipelines/quotations-dialog.tsx`
- Modify: `src/components/pipelines/deal-card.tsx`

**Interfaces:**
- Consumes: `GET /api/quotations?dealId=<id>` (extend Task 6/11's list route to accept a `dealId` filter), `POST /api/quotations` with `dealId` set.

Follows the exact pattern `order-info-dialog.tsx` (044) already
established for per-deal data, per spec section 1.

- [ ] **Step 1: Extend the list route to filter by deal**

```typescript
// Add to the GET handler in src/app/api/quotations/route.ts, alongside status:
const dealId = url.searchParams.get('dealId');
if (dealId) query = query.eq('deal_id', dealId);
```

- [ ] **Step 2: Read `order-info-dialog.tsx` for the exact dialog shape used
  in this codebase**

```bash
sed -n '1,60p' src/components/pipelines/order-info-dialog.tsx
```

- [ ] **Step 3: Write the quotations dialog, matching that shape**

```tsx
// src/components/pipelines/quotations-dialog.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Quotation } from '@/lib/quotations/types';

export function QuotationsDialog({
  dealId,
  accountId,
  contactId,
  onClose,
}: {
  dealId: string;
  accountId: string;
  contactId?: string;
  onClose: () => void;
}) {
  const [quotations, setQuotations] = useState<Quotation[]>([]);

  useEffect(() => {
    fetch(`/api/quotations?dealId=${dealId}&accountId=${accountId}`)
      .then((res) => res.json())
      .then(setQuotations);
  }, [dealId, accountId]);

  async function createNew() {
    const res = await fetch('/api/quotations', {
      method: 'POST',
      body: JSON.stringify({ accountId, dealId, contactId, productCode: 'GEN', currency: 'QAR' }),
    });
    const created = await res.json();
    window.location.href = `/quotations/${created.id}`;
  }

  return (
    <div role="dialog">
      <h2>Quotations</h2>
      <ul>
        {quotations.map((q) => (
          <li key={q.id}>
            <Link href={`/quotations/${q.id}`}>{q.reference}</Link> — {q.status} — {q.total.toLocaleString()} {q.currency}
          </li>
        ))}
      </ul>
      <button onClick={createNew}>New Quotation</button>
      <button onClick={onClose}>Close</button>
    </div>
  );
}
```

- [ ] **Step 4: Add the entry point to the deal card**

```bash
grep -n "OrderInfoDialog\|order-info" src/components/pipelines/deal-card.tsx
```

Add a "Quotations" button/section to `deal-card.tsx` in the exact spot and
style the grep result shows `OrderInfoDialog` is wired in, rendering
`<QuotationsDialog dealId={deal.id} accountId={deal.accountId}
contactId={deal.contactId} onClose={...} />` when opened — following that
existing open/close state pattern precisely rather than introducing a new
one.

- [ ] **Step 5: Manual check**

Run: `npm run dev`, open a deal, open the new Quotations section, create a
quotation from it, confirm it's pre-filled with the deal's `dealId`/
`contactId` and appears in the section's list on next open.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipelines/quotations-dialog.tsx src/components/pipelines/deal-card.tsx \
  src/app/api/quotations/route.ts
git commit -m "feat(quotations): add per-deal Quotations section to the deal card"
```

---

### Task 15: Quotation product codes settings page

**Files:**
- Create: `src/app/api/quotation-product-codes/route.ts`
- Create: `src/components/settings/quotation-product-codes.tsx`
- Test: `src/app/api/quotation-product-codes/route.test.ts`

**Interfaces:**
- Produces: `GET /api/quotation-product-codes`, `POST /api/quotation-product-codes` (admin-only, enforced by the `quotation_product_codes_write` RLS policy from Task 1 — the route itself does not need its own role check, it inherits the DB's).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';

function chain(finalResult: unknown) {
  const builder: Record<string, unknown> = {};
  ['select', 'eq', 'insert'].forEach((m) => {
    builder[m] = vi.fn().mockReturnValue(builder);
  });
  builder.then = (resolve: (v: unknown) => void) => resolve(finalResult);
  return builder;
}

const from = vi.fn();
vi.mock('@/lib/quotations/admin-client', () => ({ supabaseAdmin: () => ({ from }) }));

import { GET, POST } from './route';

describe('quotation-product-codes route', () => {
  it('lists codes for an account', async () => {
    from.mockReturnValueOnce(chain({ data: [{ code: 'PIV', label: 'Pivot Door' }], error: null }));
    const req = new Request('http://test?accountId=acc-1');
    const res = await GET(req);
    expect((await res.json())[0].code).toBe('PIV');
  });

  it('creates a new code', async () => {
    from.mockReturnValueOnce(chain({ error: null }));
    const req = new Request('http://test', {
      method: 'POST',
      body: JSON.stringify({ accountId: 'acc-1', code: 'PRG', label: 'Pergola' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/app/api/quotation-product-codes/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/quotation-product-codes/route.ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/quotations/admin-client';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get('accountId');
  const { data, error } = await supabaseAdmin().from('quotation_product_codes').select('*').eq('account_id', accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { error } = await supabaseAdmin().from('quotation_product_codes').insert({
    account_id: body.accountId,
    code: body.code,
    label: body.label,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true }, { status: 201 });
}
```

```tsx
// src/components/settings/quotation-product-codes.tsx
'use client';

import { useEffect, useState } from 'react';

interface ProductCode {
  code: string;
  label: string;
}

export function QuotationProductCodes({ accountId }: { accountId: string }) {
  const [codes, setCodes] = useState<ProductCode[]>([]);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');

  function refresh() {
    fetch(`/api/quotation-product-codes?accountId=${accountId}`).then((res) => res.json()).then(setCodes);
  }
  useEffect(refresh, [accountId]);

  async function add() {
    await fetch('/api/quotation-product-codes', {
      method: 'POST',
      body: JSON.stringify({ accountId, code, label }),
    });
    setCode('');
    setLabel('');
    refresh();
  }

  return (
    <div>
      <h2>Quotation product codes</h2>
      <ul>
        {codes.map((c) => (
          <li key={c.code}>{c.code} — {c.label}</li>
        ))}
      </ul>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code (e.g. PRG)" />
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Pergola)" />
      <button onClick={add}>Add</button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/app/api/quotation-product-codes/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Seed the initial codes for the account**

```bash
# Once, via psql or the Supabase SQL editor, for the real account:
INSERT INTO quotation_product_codes (account_id, code, label) VALUES
  ('<account-id>', 'PIV', 'Pivot Door'),
  ('<account-id>', 'RSD', 'Roll-Up Shutter'),
  ('<account-id>', 'STL', 'Steel Door'),
  ('<account-id>', 'UPV', 'UPVC'),
  ('<account-id>', 'GEN', 'General');
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/quotation-product-codes/ src/components/settings/quotation-product-codes.tsx
git commit -m "feat(quotations): add admin-managed product codes settings page"
```

---

## Post-plan note: repo automation (not a task — advisory only)

This repo has no `.claude/settings.json` yet — no hooks configured. Given
this plan adds a new TypeScript surface with its own test suite, and the
explicit priority is "don't break anything," a `PostToolUse` hook running
`npm run typecheck` and the relevant Vitest file after each edit inside
`src/lib/quotations/` or `src/app/api/quotations/` would catch a broken
build the moment it happens rather than at the next manual test run. This
is a genuinely good fit for this repo (`typecheck` and `test` scripts
already exist; nothing new to install), but it's a repo-wide tooling
decision independent of the quotations feature itself — not folded into
the tasks above. Worth doing as a short, separate follow-up if wanted.
