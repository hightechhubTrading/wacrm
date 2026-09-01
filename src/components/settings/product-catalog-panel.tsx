'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ProductCatalogForm } from './product-catalog-form';
import { ProductMediaGrid } from './product-media-grid';
import type { Product } from './product-catalog-types';

/** Selected product: an existing product's id, 'new' when creating, or
 * null when nothing is selected yet. */
type Selection = string | 'new' | null;

export function ProductCatalogPanel() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
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

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Product removed.');
        setItems((d) => d.filter((x) => x.id !== id));
        if (selection === id) setSelection(null);
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove product.');
      }
    } catch {
      toast.error('Failed to remove product.');
    }
  };

  const selected =
    selection !== 'new' && selection !== null
      ? (items.find((i) => i.id === selection) ?? null)
      : null;

  if (profileLoading || loading) {
    return (
      <Card>
        <CardContent className="flex items-center py-8 text-sm text-muted-foreground">
          <Loader2 className="me-2 h-4 w-4 animate-spin" /> Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Products</CardTitle>
          <CardDescription>
            Products your AI agent can discuss and attach photos/catalogs for on its own,
            mid-conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No products yet.</p>
          )}
          {items.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelection(item.id)}
                    className={cn(
                      'min-w-0 flex-1 truncate text-start text-sm hover:underline',
                      selection === item.id ? 'font-medium text-primary' : 'text-foreground',
                    )}
                  >
                    {item.name}
                    <span className="text-muted-foreground">
                      {' '}
                      ({item.files.length} file{item.files.length === 1 ? '' : 's'})
                    </span>
                  </button>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
                      onClick={() => void remove(item.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setSelection('new')}>
              <Plus className="me-2 h-4 w-4" /> Add product
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selection === 'new' ? 'New product' : (selected?.name ?? 'Product details')}
          </CardTitle>
          <CardDescription>
            Each product&apos;s description is what the AI reads to decide relevance, so be
            specific. A product can have any number of photos or files, or none yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {selection === null ? (
            <p className="text-sm text-muted-foreground">
              Select a product on the left, or add a new one.
            </p>
          ) : (
            <div className="space-y-4">
              <ProductCatalogForm
                product={selection === 'new' ? null : selected}
                canEdit={canEdit}
                onSaved={(id) => {
                  void fetchItems();
                  setSelection(id);
                }}
                onCancel={() => setSelection(null)}
              />
              {selected && (
                <ProductMediaGrid
                  productId={selected.id}
                  files={selected.files}
                  canEdit={canEdit}
                  onChanged={fetchItems}
                />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
