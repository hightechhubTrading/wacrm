'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

// GET /api/catalog-items (src/app/api/catalog-items/route.ts) does
// `NextResponse.json(data)` on the raw Supabase result -- there is no
// camelCase mapper for catalog_items (unlike quotations/quotation_items,
// which go through mapQuotationRow/mapQuotationItemRow). snake_case here
// is deliberate: it matches what the API actually returns.
interface CatalogItemRow {
  id: string;
  name: string;
  description: string | null;
  default_unit_price: number | null;
}

export interface CatalogPickResult {
  productId?: string;
  description?: string;
  unitPrice?: number;
  newName?: string;
  saveToCatalog?: boolean;
}

// accountId is deliberately not a prop here: GET/POST /api/catalog-items
// always derive it from ctx.accountId server-side and ignore any
// client-supplied value (Task 7) -- the same pattern Task 11/12's
// components already established for this feature. Threading one through
// would be dead weight that could mislead a future reader into thinking
// it's load-bearing for authorization.
export function CatalogItemPicker({
  onPick,
  defaultValue = '',
  placeholder = 'Search catalog or type new…',
  disabled = false,
}: {
  onPick: (picked: CatalogPickResult) => void;
  // Seeds the search box with an item's current description when editing
  // an existing line (e.g. a quotation reopened with real saved items) --
  // without this, every picker starts blank regardless of what the item
  // underneath it already holds, which reads as data loss even though the
  // qty/price/discount fields next to it are correctly populated.
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<CatalogItemRow[]>([]);
  const [saveNew, setSaveNew] = useState(true);
  const [open, setOpen] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) {
      setResults([]);
      setOpen(q.length > 0);
      return;
    }
    setOpen(true);
    const res = await fetch(`/api/catalog-items?q=${encodeURIComponent(q)}`);
    if (!res.ok) {
      setResults([]);
      return;
    }
    setResults(await res.json());
  }

  function pick(row: CatalogItemRow) {
    onPick({
      productId: row.id,
      description: row.name,
      unitPrice: row.default_unit_price ?? undefined,
    });
    setQuery(row.name);
    setOpen(false);
  }

  function useAsNew() {
    onPick({
      description: query,
      newName: saveNew ? query : undefined,
      saveToCatalog: saveNew,
    });
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => setOpen(query.length > 0)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          disabled={disabled}
          className="ps-7"
        />
      </div>
      {open && query.length >= 2 && (
        <div className="absolute z-10 mt-1 w-full min-w-56 space-y-1 rounded-lg border border-border bg-popover p-1.5 shadow-md">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              // Plain onClick: the input's onBlur delays closing the
              // dropdown by 150ms (see below) specifically so this click
              // still lands before the dropdown unmounts out from under it.
              onClick={() => pick(r)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="truncate text-foreground">{r.name}</span>
              {r.default_unit_price != null && (
                <span className="ms-2 shrink-0 text-xs text-muted-foreground">
                  {r.default_unit_price.toLocaleString()}
                </span>
              )}
            </button>
          ))}
          {results.length === 0 && (
            <div className="space-y-2 p-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={useAsNew}
              >
                Use &ldquo;{query}&rdquo; as a new item
              </Button>
              <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
                <Checkbox
                  checked={saveNew}
                  onCheckedChange={(checked) => setSaveNew(checked === true)}
                />
                Save to catalog for reuse
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
