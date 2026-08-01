'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

interface MediaItem {
  id: string;
  name: string;
  product_label: string | null;
  description: string;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  price_notes: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
  updated_at: string;
}

/** Editor target: 'new' when creating, an item id when editing, null when closed. */
type EditTarget = 'new' | string | null;

export function AiMediaLibraryCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [name, setName] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [description, setDescription] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceNotes, setPriceNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/media');
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else toast.error(data.error ?? 'Failed to load media library.');
    } catch {
      toast.error('Failed to load media library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchItems();
  }, [accountId, fetchItems]);

  const openNew = () => {
    setEditing('new');
    setName('');
    setProductLabel('');
    setDescription('');
    setPriceMin('');
    setPriceMax('');
    setPriceUnit('');
    setPriceNotes('');
    setFile(null);
  };

  const openEdit = (item: MediaItem) => {
    setEditing(item.id);
    setName(item.name);
    setProductLabel(item.product_label ?? '');
    setDescription(item.description);
    setPriceMin(item.price_min != null ? String(item.price_min) : '');
    setPriceMax(item.price_max != null ? String(item.price_max) : '');
    setPriceUnit(item.price_unit ?? '');
    setPriceNotes(item.price_notes ?? '');
    setFile(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setName('');
    setProductLabel('');
    setDescription('');
    setPriceMin('');
    setPriceMax('');
    setPriceUnit('');
    setPriceNotes('');
    setFile(null);
  };

  const save = async () => {
    if (!name.trim() || !description.trim()) {
      toast.error('Name and description are required.');
      return;
    }
    const isNew = editing === 'new';
    if (isNew && !file) {
      toast.error('Choose a file to upload.');
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
      if (isNew && file) {
        const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
        const maxBytes = MEDIA_MAX_BYTES_BY_KIND[mediaKind];
        if (file.size > maxBytes) {
          toast.error(
            mediaKind === 'image'
              ? 'Images must be 5 MB or smaller.'
              : 'Documents must be 16 MB or smaller.',
          );
          setSaving(false);
          return;
        }
        const { publicUrl: _publicUrl, path } = await uploadAccountMedia('ai-media', file);
        const res = await fetch('/api/ai/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            product_label: productLabel.trim(),
            price_min: parsedMin,
            price_max: parsedMax,
            price_unit: priceUnit.trim() || null,
            price_notes: priceNotes.trim() || null,
            storage_path: path,
            mime_type: file.type,
            media_kind: mediaKind,
            file_size: file.size,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success('Media item added.');
          cancelEdit();
          await fetchItems();
        } else {
          toast.error(data.error ?? 'Failed to save media item.');
          await deleteAccountMedia('ai-media', path).catch(() => {});
        }
      } else {
        const res = await fetch(`/api/ai/media/${editing}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            product_label: productLabel.trim(),
            price_min: parsedMin,
            price_max: parsedMax,
            price_unit: priceUnit.trim() || null,
            price_notes: priceNotes.trim() || null,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success('Media item updated.');
          cancelEdit();
          await fetchItems();
        } else {
          toast.error(data.error ?? 'Failed to save media item.');
        }
      }
    } catch {
      toast.error('Failed to save media item.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/media/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Media item removed.');
        setItems((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove media item.');
      }
    } catch {
      toast.error('Failed to remove media item.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4 text-primary" /> Media library
        </CardTitle>
        <CardDescription>
          Product photos and catalogs your AI agent can attach on its own,
          mid-conversation, when what the customer asks for clearly matches
          one -- no scripted flow needed. The description below is what the
          AI reads to decide relevance, so be specific.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <>
            {items.length === 0 && editing === null && (
              <p className="text-sm text-muted-foreground">
                No media items yet. Add a product photo or catalog file below.
              </p>
            )}

            {items.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.name}
                      {item.product_label && (
                        <span className="text-muted-foreground"> -- {item.product_label}</span>
                      )}
                      {item.price_min != null && item.price_max != null && (
                        <span className="text-muted-foreground">
                          {' '}
                          ({item.price_min}-{item.price_max}
                          {item.price_unit ? ` / ${item.price_unit.replace(/_/g, ' ')}` : ''}
                          {item.price_notes ? ', + options' : ''})
                        </span>
                      )}
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(item)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          onClick={() => void remove(item.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {editing !== null ? (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="media-name">Name</Label>
                    <Input
                      id="media-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Shutter catalog"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="media-product">Product (optional)</Label>
                    <Input
                      id="media-product"
                      value={productLabel}
                      onChange={(e) => setProductLabel(e.target.value)}
                      placeholder="Roller shutters"
                      disabled={saving}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="media-price-min">Price min (optional)</Label>
                    <Input
                      id="media-price-min"
                      type="number"
                      step="any"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                      placeholder="80"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="media-price-max">Price max (optional)</Label>
                    <Input
                      id="media-price-max"
                      type="number"
                      step="any"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                      placeholder="120"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="media-price-unit">Unit</Label>
                    <Input
                      id="media-price-unit"
                      value={priceUnit}
                      onChange={(e) => setPriceUnit(e.target.value)}
                      placeholder="per_meter"
                      disabled={saving}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Optional — when both min and max are set, the AI may share this as a rough
                  estimate (always caveated as non-final); leave both blank to keep pricing
                  strictly human-confirmed.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="media-price-notes">Add-on / option pricing (optional)</Label>
                  <Textarea
                    id="media-price-notes"
                    value={priceNotes}
                    onChange={(e) => setPriceNotes(e.target.value)}
                    placeholder="Automatic +$60, manual included; custom colors +$20; motor add-on +$50-80"
                    rows={2}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only referenced by the AI alongside the price range above, never on its own.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="media-description">
                    Description (read by the AI to decide relevance)
                  </Label>
                  <Textarea
                    id="media-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Full product catalog with prices and sizes for our roller shutter range. Send when a customer asks about roller shutters, pricing, or a catalog."
                    rows={3}
                    disabled={saving}
                  />
                </div>
                {editing === 'new' && (
                  <div className="space-y-2">
                    <Label htmlFor="media-file">File (image or document)</Label>
                    <Input
                      id="media-file"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground">
                      Images up to 5 MB, documents up to 16 MB.
                    </p>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={saving}>
                    {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              canEdit && (
                <Button variant="outline" size="sm" onClick={openNew}>
                  <Plus className="me-2 h-4 w-4" /> Add media item
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
