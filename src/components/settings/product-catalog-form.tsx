'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Product } from './product-catalog-types';

export function ProductCatalogForm({
  product,
  canEdit,
  onSaved,
  onCancel,
}: {
  /** null when creating a new product. */
  product: Product | null;
  canEdit: boolean;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [description, setDescription] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceNotes, setPriceNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(product?.name ?? '');
    setTagLabel(product?.tag_label ?? '');
    setDescription(product?.description ?? '');
    setPriceMin(product?.price_min != null ? String(product.price_min) : '');
    setPriceMax(product?.price_max != null ? String(product.price_max) : '');
    setPriceUnit(product?.price_unit ?? '');
    setPriceNotes(product?.price_notes ?? '');
  }, [product]);

  const save = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error('Name and description are required.');
      return;
    }
    const parsedMin = priceMin.trim() ? Number(priceMin.trim()) : null;
    const parsedMax = priceMax.trim() ? Number(priceMax.trim()) : null;
    if (parsedMin !== null && parsedMax !== null && parsedMax < parsedMin) {
      toast.error('Max price must be greater than or equal to min price.');
      return;
    }
    setSaving(true);
    try {
      const isNew = product === null;
      const payload = {
        name: name.trim(),
        description: description.trim(),
        tag_label: tagLabel.trim(),
        price_min: parsedMin,
        price_max: parsedMax,
        price_unit: priceUnit.trim() || null,
        price_notes: priceNotes.trim() || null,
      };
      const res = await fetch(isNew ? '/api/ai/products' : `/api/ai/products/${product.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? 'Product added.' : 'Product updated.');
        onSaved(isNew ? data.id : product.id);
      } else {
        toast.error(data.error ?? 'Failed to save product.');
      }
    } catch {
      toast.error('Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rollup Shutter door"
            disabled={!canEdit || saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-tag-label">Tag label (optional)</Label>
          <Input
            id="product-tag-label"
            value={tagLabel}
            onChange={(e) => setTagLabel(e.target.value)}
            placeholder="Shutters"
            disabled={!canEdit || saving}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Tag label names the CRM tag applied to a contact when this product is clearly the topic
        of conversation. Leave blank to use the product name.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="product-price-min">Price min (optional)</Label>
          <Input
            id="product-price-min"
            type="number"
            step="any"
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            placeholder="80"
            disabled={!canEdit || saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-price-max">Price max (optional)</Label>
          <Input
            id="product-price-max"
            type="number"
            step="any"
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            placeholder="120"
            disabled={!canEdit || saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="product-price-unit">Unit</Label>
          <Input
            id="product-price-unit"
            value={priceUnit}
            onChange={(e) => setPriceUnit(e.target.value)}
            placeholder="per_meter"
            disabled={!canEdit || saving}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Optional — when both min and max are set, the AI may share this as a rough estimate
        (always caveated as non-final); leave both blank to keep pricing strictly
        human-confirmed.
      </p>
      <div className="space-y-2">
        <Label htmlFor="product-price-notes">Add-on / option pricing (optional)</Label>
        <Textarea
          id="product-price-notes"
          value={priceNotes}
          onChange={(e) => setPriceNotes(e.target.value)}
          placeholder="Automatic +$60, manual included; custom colors +$20; motor add-on +$50-80"
          rows={2}
          disabled={!canEdit || saving}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="product-description">
          Description (read by the AI to decide relevance)
        </Label>
        <Textarea
          id="product-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Aluminum roller shutters for windows, cabins, and pool enclosures. Send when a customer asks about roller shutters, pricing, or a catalog."
          rows={3}
          disabled={!canEdit || saving}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {product === null ? 'Cancel' : 'Close'}
        </Button>
        {canEdit && (
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
