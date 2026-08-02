'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Pencil, ImageIcon, FileText, X, Check } from 'lucide-react';
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

interface ProductFile {
  id: string;
  label: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
}

interface Product {
  id: string;
  name: string;
  description: string;
  tag_label: string | null;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  price_notes: string | null;
  updated_at: string;
  files: ProductFile[];
}

/** Editor target: 'new' when creating, a product id when editing, null when closed. */
type EditTarget = 'new' | string | null;

export function AiMediaLibraryCard({
  accountId,
  canEdit,
}: {
  accountId: string | null;
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [name, setName] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [description, setDescription] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceUnit, setPriceUnit] = useState('');
  const [priceNotes, setPriceNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [newFileLabel, setNewFileLabel] = useState('');
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editFileLabel, setEditFileLabel] = useState('');
  const [savingFileLabel, setSavingFileLabel] = useState(false);
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/products');
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else toast.error(data.error ?? 'Failed to load product catalog.');
    } catch {
      toast.error('Failed to load product catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchItems();
  }, [accountId, fetchItems]);

  const resetForm = () => {
    setName('');
    setTagLabel('');
    setDescription('');
    setPriceMin('');
    setPriceMax('');
    setPriceUnit('');
    setPriceNotes('');
    setNewFileLabel('');
    setEditingFileId(null);
    setEditFileLabel('');
  };

  const openNew = () => {
    setEditing('new');
    resetForm();
  };

  const openEdit = (item: Product) => {
    setEditing(item.id);
    setName(item.name);
    setTagLabel(item.tag_label ?? '');
    setDescription(item.description);
    setPriceMin(item.price_min != null ? String(item.price_min) : '');
    setPriceMax(item.price_max != null ? String(item.price_max) : '');
    setPriceUnit(item.price_unit ?? '');
    setPriceNotes(item.price_notes ?? '');
    setNewFileLabel('');
    setEditingFileId(null);
    setEditFileLabel('');
  };

  const cancelEdit = () => {
    setEditing(null);
    resetForm();
  };

  const currentEditingItem = editing !== 'new' ? items.find((i) => i.id === editing) : null;

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
      const isNew = editing === 'new';
      const payload = {
        name: name.trim(),
        description: description.trim(),
        tag_label: tagLabel.trim(),
        price_min: parsedMin,
        price_max: parsedMax,
        price_unit: priceUnit.trim() || null,
        price_notes: priceNotes.trim() || null,
      };
      const res = await fetch(isNew ? '/api/ai/products' : `/api/ai/products/${editing}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(isNew ? 'Product added.' : 'Product updated.');
        await fetchItems();
        if (isNew && data.id) {
          // Stay in the editor, now scoped to the new product, so
          // "Add file" becomes available immediately.
          setEditing(data.id);
        } else {
          cancelEdit();
        }
      } else {
        toast.error(data.error ?? 'Failed to save product.');
      }
    } catch {
      toast.error('Failed to save product.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product removed.');
        setItems((d) => d.filter((x) => x.id !== id));
        if (editing === id) cancelEdit();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove product.');
      }
    } catch {
      toast.error('Failed to remove product.');
    }
  };

  const addFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || editing === 'new' || editing === null) return;
    const productId = editing;
    const mediaKind = file.type.startsWith('image/') ? 'image' : 'document';
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[mediaKind];
    if (file.size > maxBytes) {
      toast.error(
        mediaKind === 'image' ? 'Images must be 5 MB or smaller.' : 'Documents must be 16 MB or smaller.',
      );
      return;
    }
    setUploadingFile(true);
    try {
      const { path } = await uploadAccountMedia('ai-media', file);
      const res = await fetch(`/api/ai/products/${productId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newFileLabel.trim(),
          storage_path: path,
          mime_type: file.type,
          media_kind: mediaKind,
          file_size: file.size,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('File added.');
        setNewFileLabel('');
        await fetchItems();
      } else {
        toast.error(data.error ?? 'Failed to save file.');
        await deleteAccountMedia('ai-media', path).catch(() => {});
      }
    } catch {
      toast.error('Failed to upload file.');
    } finally {
      setUploadingFile(false);
    }
  };

  const removeFile = async (productId: string, fileId: string) => {
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${fileId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('File removed.');
        await fetchItems();
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove file.');
      }
    } catch {
      toast.error('Failed to remove file.');
    }
  };

  const startEditFileLabel = (file: ProductFile) => {
    setEditingFileId(file.id);
    setEditFileLabel(file.label ?? '');
  };

  const cancelEditFileLabel = () => {
    setEditingFileId(null);
    setEditFileLabel('');
  };

  const saveFileLabel = async (productId: string, fileId: string) => {
    setSavingFileLabel(true);
    try {
      const res = await fetch(`/api/ai/products/${productId}/media/${fileId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editFileLabel.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('File label updated.');
        setEditingFileId(null);
        setEditFileLabel('');
        await fetchItems();
      } else {
        toast.error(data.error ?? 'Failed to update file label.');
      }
    } catch {
      toast.error('Failed to update file label.');
    } finally {
      setSavingFileLabel(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ImageIcon className="h-4 w-4 text-primary" /> Media library
        </CardTitle>
        <CardDescription>
          Products your AI agent can discuss and attach photos/catalogs for on its own,
          mid-conversation, when what the customer asks for clearly matches one -- no scripted
          flow needed. Each product&apos;s description is what the AI reads to decide relevance, so be
          specific. A product can have any number of files, or none yet.
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
                No products yet. Add one below.
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
                      <span className="text-muted-foreground">
                        {' '}
                        ({item.files.length} file{item.files.length === 1 ? '' : 's'})
                      </span>
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
                    <Label htmlFor="product-name">Name</Label>
                    <Input
                      id="product-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Rollup Shutter door"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-tag-label">Tag label (optional)</Label>
                    <Input
                      id="product-tag-label"
                      value={tagLabel}
                      onChange={(e) => setTagLabel(e.target.value)}
                      placeholder="Shutters"
                      disabled={saving}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Tag label names the CRM tag applied to a contact when this product is clearly
                  the topic of conversation. Leave blank to use the product name.
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
                      disabled={saving}
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
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-price-unit">Unit</Label>
                    <Input
                      id="product-price-unit"
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
                  <Label htmlFor="product-price-notes">Add-on / option pricing (optional)</Label>
                  <Textarea
                    id="product-price-notes"
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
                  <Label htmlFor="product-description">
                    Description (read by the AI to decide relevance)
                  </Label>
                  <Textarea
                    id="product-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Aluminum roller shutters for windows, cabins, and pool enclosures. Send when a customer asks about roller shutters, pricing, or a catalog."
                    rows={3}
                    disabled={saving}
                  />
                </div>

                {editing !== 'new' && (
                  <div className="space-y-2 rounded-md border border-dashed border-border p-3">
                    <Label>Files</Label>
                    {(currentEditingItem?.files.length ?? 0) === 0 ? (
                      <p className="text-xs text-muted-foreground">No files yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {currentEditingItem?.files.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between gap-2 rounded border border-border bg-muted/30 px-2 py-1.5 text-sm"
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              {f.media_kind === 'image' ? (
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              {editingFileId === f.id ? (
                                <Input
                                  autoFocus
                                  value={editFileLabel}
                                  onChange={(e) => setEditFileLabel(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveFileLabel(editing, f.id);
                                    if (e.key === 'Escape') cancelEditFileLabel();
                                  }}
                                  className="h-6 py-0 text-sm"
                                  disabled={savingFileLabel}
                                />
                              ) : (
                                <span className="truncate">{f.label || '(no label)'}</span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {editingFileId === f.id ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 shrink-0 p-0"
                                    onClick={() => void saveFileLabel(editing, f.id)}
                                    disabled={savingFileLabel}
                                    title="Save label"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 shrink-0 p-0"
                                    onClick={cancelEditFileLabel}
                                    disabled={savingFileLabel}
                                    title="Cancel"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 shrink-0 p-0"
                                    onClick={() => startEditFileLabel(f)}
                                    title="Edit label"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 shrink-0 p-0 text-destructive hover:text-destructive"
                                    onClick={() => void removeFile(editing, f.id)}
                                    title="Remove file"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-end gap-2 pt-1">
                      <div className="flex-1 space-y-1">
                        <Label htmlFor="new-file-label" className="text-xs">
                          Label for next file (optional)
                        </Label>
                        <Input
                          id="new-file-label"
                          value={newFileLabel}
                          onChange={(e) => setNewFileLabel(e.target.value)}
                          placeholder="front view"
                          disabled={uploadingFile}
                        />
                      </div>
                      <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent">
                        {uploadingFile ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Add file
                        <input
                          type="file"
                          className="hidden"
                          accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                          onChange={(e) => void addFile(e)}
                          disabled={uploadingFile}
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Images up to 5 MB, documents up to 16 MB.
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                    {editing === 'new' ? 'Cancel' : 'Done'}
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
                  <Plus className="me-2 h-4 w-4" /> Add product
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
