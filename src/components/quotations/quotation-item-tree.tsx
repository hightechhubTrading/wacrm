'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';

import { computeQuotationTotals, type DiscountType, type OrderDiscount } from '@/lib/quotations/totals';
import type { QuotationItemToSave } from '@/lib/quotations/crud';
import type { Quotation, QuotationItem } from '@/lib/quotations/types';
import { CatalogItemPicker, type CatalogPickResult } from './catalog-item-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// A real UUID, not a placeholder string -- a child item's parentItemId
// must be a valid uuid before it's ever sent to the database (the atomic
// save function, save_quotation_items, resolves parent-child links within
// one batch by real id, not by re-mapping temp strings).
const newId = () => crypto.randomUUID();

// Converts a fetched QuotationItem (GET/PATCH response shape, via
// mapQuotationItemRow) into the QuotationItemToSave shape this editor's
// state uses. Exported so the detail page can thread real fetched items
// into `initialItems` instead of the empty array the original brief for
// this task shipped -- reopening a quotation with real items must not
// start the tree empty, or clicking "Save items" would delete every
// existing item (saveQuotationItems / save_quotation_items deletes then
// re-inserts the whole set).
export function toItemToSave(item: QuotationItem): QuotationItemToSave {
  return {
    id: item.id,
    itemType: item.itemType,
    parentItemId: item.parentItemId ?? undefined,
    kind: item.kind ?? undefined,
    qty: item.qty ?? undefined,
    unitPrice: item.unitPrice ?? undefined,
    discountType: item.discountType ?? undefined,
    discountValue: item.discountValue ?? undefined,
    productId: item.productId ?? undefined,
    itemCode: item.itemCode ?? undefined,
    description: item.description ?? undefined,
    descriptionAr: item.descriptionAr ?? undefined,
    sizeW: item.sizeW ?? undefined,
    sizeH: item.sizeH ?? undefined,
  };
}

type SavedQuotation = Quotation & { items: QuotationItem[] };

function DiscountFields({
  discountType,
  discountValue,
  onChange,
  disabled,
}: {
  discountType?: DiscountType;
  discountValue?: number;
  onChange: (patch: { discountType?: DiscountType; discountValue?: number }) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={discountType ?? 'percent'}
        onValueChange={(v) => v && onChange({ discountType: v as DiscountType })}
      >
        <SelectTrigger size="sm" className="w-[4.5rem]" disabled={disabled}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="percent">%</SelectItem>
          <SelectItem value="fixed">Flat</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        min={0}
        step="any"
        value={discountValue ?? 0}
        onChange={(e) => onChange({ discountValue: Number(e.target.value) })}
        disabled={disabled}
        className="w-20"
      />
    </div>
  );
}

export function QuotationItemTree({
  quotationId,
  initialItems,
  initialOrderDiscount,
  onSaved,
}: {
  quotationId: string;
  initialItems: QuotationItemToSave[];
  initialOrderDiscount?: OrderDiscount;
  onSaved?: (quotation: SavedQuotation) => void;
}) {
  const [items, setItems] = useState<QuotationItemToSave[]>(initialItems);
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>(
    initialOrderDiscount?.discountType ?? 'percent',
  );
  const [orderDiscountValue, setOrderDiscountValue] = useState<number>(
    initialOrderDiscount?.discountValue ?? 0,
  );
  const [saving, setSaving] = useState(false);

  // computeQuotationTotals/applyDiscount already treat a falsy value as
  // "no discount" (src/lib/quotations/totals.ts), but keeping that
  // decision explicit here means the PATCH payload doesn't send a
  // discount object at all when the rep hasn't set one.
  const orderDiscount: OrderDiscount | undefined =
    orderDiscountValue > 0 ? { discountType: orderDiscountType, discountValue: orderDiscountValue } : undefined;

  const totals = useMemo(
    () => computeQuotationTotals(items, orderDiscount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, orderDiscountType, orderDiscountValue],
  );

  function addProduct() {
    setItems([...items, { id: newId(), itemType: 'line', qty: 1, unitPrice: 0 }]);
  }

  function addChild(parentItemId: string, kind: string) {
    setItems([...items, { id: newId(), itemType: 'line', parentItemId, kind, qty: 1, unitPrice: 0 }]);
  }

  function updateItem(id: string, patch: Partial<QuotationItemToSave>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  // Applies a CatalogItemPicker pick to an item. Only writes the
  // `unitPrice` key when the pick actually carries a price -- the
  // "use as new" pick (CatalogItemPicker's useAsNew()) never includes
  // `unitPrice` at all, so blindly merging `{ unitPrice: picked.unitPrice }`
  // would set it to `undefined` and, because `updateItem` spreads the
  // patch over the existing item, clobber whatever price was already
  // typed in. Same reasoning for productId: an "existing catalog item"
  // pick should always set/replace it, a "new item" pick should clear a
  // stale link, but neither should ever touch price unless the pick says so.
  function applyPick(id: string, picked: CatalogPickResult) {
    const patch: Partial<QuotationItemToSave> = {
      description: picked.description,
      productId: picked.productId,
    };
    if (picked.unitPrice !== undefined) patch.unitPrice = picked.unitPrice;
    updateItem(id, patch);
  }

  async function handlePick(id: string, picked: CatalogPickResult) {
    if (picked.saveToCatalog && picked.newName) {
      try {
        const res = await fetch('/api/catalog-items', {
          method: 'POST',
          body: JSON.stringify({ name: picked.newName, category: 'product' }),
        });
        if (!res.ok) {
          toast.error('Failed to save item to catalog — kept as free text.');
          applyPick(id, { description: picked.description });
          return;
        }
        const created = await res.json();
        applyPick(id, { description: picked.description, productId: created.id });
      } catch {
        toast.error('Failed to save item to catalog — kept as free text.');
        applyPick(id, { description: picked.description });
      }
      return;
    }
    applyPick(id, picked);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/quotations/${quotationId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          items,
          orderDiscount,
          // save_quotation_items (Task 5) only ever writes subtotal/
          // discount_amount/total back onto the quotations row -- it
          // never persists discount_type/discount_value themselves, so
          // without this the order discount's *effect* survives a reload
          // but the rep's chosen type/value silently resets to blank.
          // `fields` goes through the same PATCH path Task 12's
          // QuotationForm already uses for party/project fields.
          fields: {
            discount_type: orderDiscount?.discountType ?? null,
            discount_value: orderDiscount?.discountValue ?? null,
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to save items (${res.status})`);
        return;
      }
      const updated = (await res.json()) as SavedQuotation;
      onSaved?.(updated);
      toast.success('Items saved');
    } catch {
      toast.error('Failed to save items — check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  const topLevel = items.filter((i) => !i.parentItemId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {topLevel.map((product) => (
          <div key={product.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1">
                <Label className="text-xs text-muted-foreground">Product</Label>
                <CatalogItemPicker
                  disabled={saving}
                  defaultValue={product.description ?? ''}
                  onPick={(picked) => handlePick(product.id, picked)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Qty</Label>
                <Input
                  type="number"
                  min={0}
                  className="w-20"
                  value={product.qty ?? 1}
                  disabled={saving}
                  onChange={(e) => updateItem(product.id, { qty: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Unit price</Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  className="w-28"
                  value={product.unitPrice ?? 0}
                  disabled={saving}
                  onChange={(e) => updateItem(product.id, { unitPrice: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Discount</Label>
                <DiscountFields
                  discountType={product.discountType}
                  discountValue={product.discountValue}
                  disabled={saving}
                  onChange={(patch) => updateItem(product.id, patch)}
                />
              </div>
              <div className="ms-auto space-y-1 text-end">
                <Label className="text-xs text-muted-foreground">Line total</Label>
                <p className="text-sm font-medium text-foreground">
                  {(totals.itemTotals[product.id] ?? 0).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => addChild(product.id, 'Accessory')}
              >
                <Plus className="size-3" />
                Accessory
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => addChild(product.id, 'Customization')}
              >
                <Plus className="size-3" />
                Customization
              </Button>
            </div>

            {items
              .filter((i) => i.parentItemId === product.id)
              .map((child) => (
                <div
                  key={child.id}
                  className="ms-6 flex flex-wrap items-end gap-2 border-s-2 border-border ps-3"
                >
                  <span className="w-24 shrink-0 pb-1.5 text-xs text-muted-foreground">{child.kind}</span>
                  <div className="min-w-48 flex-1 space-y-1">
                    <CatalogItemPicker
                      disabled={saving}
                      defaultValue={child.description ?? ''}
                      onPick={(picked) => handlePick(child.id, picked)}
                    />
                  </div>
                  <Input
                    type="number"
                    min={0}
                    className="w-20"
                    value={child.qty ?? 1}
                    disabled={saving}
                    onChange={(e) => updateItem(child.id, { qty: Number(e.target.value) })}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    className="w-28"
                    value={child.unitPrice ?? 0}
                    disabled={saving}
                    onChange={(e) => updateItem(child.id, { unitPrice: Number(e.target.value) })}
                  />
                  <DiscountFields
                    discountType={child.discountType}
                    discountValue={child.discountValue}
                    disabled={saving}
                    onChange={(patch) => updateItem(child.id, patch)}
                  />
                  <span className="ms-auto pb-1.5 text-sm font-medium text-foreground">
                    {(totals.itemTotals[child.id] ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
          </div>
        ))}

        <Button type="button" variant="outline" disabled={saving} onClick={addProduct}>
          <Plus className="size-4" />
          Add product
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Order discount</Label>
            <DiscountFields
              discountType={orderDiscountType}
              discountValue={orderDiscountValue}
              disabled={saving}
              onChange={(patch) => {
                if (patch.discountType) setOrderDiscountType(patch.discountType);
                if (patch.discountValue !== undefined) setOrderDiscountValue(patch.discountValue);
              }}
            />
          </div>

          <div className="space-y-1 text-end">
            <p className="text-sm text-muted-foreground">
              Subtotal: <span className="text-foreground">{totals.subtotal.toLocaleString()}</span>
            </p>
            {totals.discountAmount > 0 && (
              <p className="text-sm text-muted-foreground">
                Discount: <span className="text-foreground">-{totals.discountAmount.toLocaleString()}</span>
              </p>
            )}
            <p className="text-base font-semibold text-foreground">Total: {totals.total.toLocaleString()}</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Saving…
              </>
            ) : (
              'Save items'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
