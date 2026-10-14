'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Loader2,
  ImageIcon,
  FileText,
  Search,
  ArrowUpRight,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import type { ComposerMediaKind } from './message-composer';

interface CatalogFile {
  id: string;
  label: string | null;
  media_kind: 'image' | 'document';
  mime_type: string;
  storage_path: string;
}
interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  files: CatalogFile[];
}
export interface CatalogPick {
  kind: ComposerMediaKind;
  mediaUrl: string;
  path: string;
  filename: string;
}
interface CatalogPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: CatalogPick) => void;
}

/** Account-scoped, read-only library. Picking stages an existing asset; sending
 * remains an explicit composer action and never deletes the shared original. */
export function CatalogPickerDialog({
  open,
  onOpenChange,
  onPick,
}: CatalogPickerDialogProps) {
  const t = useTranslations('Inbox.composer');
  const locale = useLocale();
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSelectedProductId(null);
    setQuery('');
    setProducts([]);
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const res = await fetch('/api/ai/products', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Library request failed');
        const data = await res.json();
        if (!Array.isArray(data.items))
          throw new Error('Invalid library response');
        if (!controller.signal.aborted) setProducts(data.items);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, attempt]);

  const publicUrl = (file: CatalogFile) =>
    supabase.storage.from('ai-media').getPublicUrl(file.storage_path).data
      .publicUrl;
  const fileName = (file: CatalogFile) =>
    file.label ||
    file.storage_path.split('/').pop() ||
    t(file.media_kind === 'image' ? 'photo' : 'document');
  const handlePickFile = (file: CatalogFile) => {
    onPick({
      kind: file.media_kind,
      mediaUrl: publicUrl(file),
      path: file.storage_path,
      filename: file.storage_path.split('/').pop() || file.label || 'file',
    });
    onOpenChange(false);
  };
  const selectedProduct =
    products.find((p) => p.id === selectedProductId) ?? null;
  const search = query.trim().toLocaleLowerCase(locale);
  const matchesFile = (file: CatalogFile) =>
    fileName(file).toLocaleLowerCase(locale).includes(search);
  const visibleProducts = products.filter(
    (p) =>
      `${p.name} ${p.description}`.toLocaleLowerCase(locale).includes(search) ||
      p.files.some(matchesFile)
  );
  const files = selectedProduct?.files.filter(matchesFile) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        className="crm-product-library max-h-[90dvh] gap-5 overflow-hidden rounded-2xl p-5 sm:max-w-2xl"
      >
        <DialogHeader className="pe-8 text-start">
          <div className="flex items-center gap-3">
            {selectedProduct ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelectedProductId(null);
                  setQuery('');
                }}
                aria-label={t('catalogBack')}
              >
                <ChevronLeft className="size-5 rtl:rotate-180" />
              </Button>
            ) : (
              <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
                <ImageIcon className="size-5" />
              </span>
            )}
            <DialogTitle>{selectedProduct?.name ?? t('catalog')}</DialogTitle>
          </div>
          <DialogDescription className="leading-relaxed">
            {selectedProduct ? t('catalogChoose') : t('catalogIntro')}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-3 top-3 size-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('catalogSearch')}
            aria-label={t('catalogSearchLabel')}
            className="h-10 ps-9"
          />
        </div>
        <div
          className="max-h-[55dvh] min-h-40 overflow-y-auto overscroll-contain p-1"
          aria-busy={loading}
        >
          {loading ? (
            <div className="flex justify-center py-12" role="status">
              <Loader2 className="text-primary size-6 animate-spin" />
              <span className="sr-only">{t('catalog')}</span>
            </div>
          ) : error ? (
            <div className="space-y-4 py-10 text-center" role="alert">
              <p>{t('catalogError')}</p>
              <Button
                variant="outline"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t('catalogRetry')}
              </Button>
            </div>
          ) : !products.length ? (
            <p className="text-muted-foreground mx-auto max-w-md py-10 text-center leading-relaxed">
              {t('catalogEmpty')}
            </p>
          ) : selectedProduct ? (
            !files.length ? (
              <p className="text-muted-foreground py-10 text-center">
                {t(
                  selectedProduct.files.length
                    ? 'catalogNoResults'
                    : 'catalogNoFiles'
                )}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => handlePickFile(file)}
                      className="group border-border bg-muted/20 hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-primary w-full overflow-hidden rounded-xl border text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <AssetPreview file={file} url={publicUrl(file)} />
                      <div className="space-y-2 p-3">
                        <span
                          className="block truncate font-medium"
                          title={fileName(file)}
                        >
                          {fileName(file)}
                        </span>
                        <span className="text-primary flex items-center justify-between gap-1 text-xs">
                          {t('catalogAdd')}
                          <ArrowUpRight className="size-3.5 rtl:-rotate-90" />
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !visibleProducts.length ? (
            <p className="text-muted-foreground py-10 text-center">
              {t('catalogNoResults')}
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {visibleProducts.map((product) => {
                const cover =
                  product.files.find((f) => f.media_kind === 'image') ??
                  product.files[0];
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProductId(product.id);
                        setQuery('');
                      }}
                      className="border-border bg-muted/20 hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-primary flex h-full w-full items-center gap-3 rounded-xl border p-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <span className="size-20 shrink-0 overflow-hidden rounded-lg">
                        {cover ? (
                          <AssetPreview file={cover} url={publicUrl(cover)} />
                        ) : (
                          <span className="bg-muted flex size-full items-center justify-center">
                            <ImageIcon className="text-muted-foreground size-6" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 space-y-1">
                        <span className="block truncate font-semibold">
                          {product.name}
                        </span>
                        <span className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                          {product.description}
                        </span>
                        <span className="text-primary block text-xs font-medium">
                          {t('catalogFileCount', {
                            count: product.files.length,
                          })}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetPreview({ file, url }: { file: CatalogFile; url: string }) {
  const [failed, setFailed] = useState(false);
  if (file.media_kind === 'document' || failed)
    return (
      <span className="bg-muted text-muted-foreground flex aspect-square size-full items-center justify-center">
        {file.media_kind === 'document' ? (
          <FileText className="size-8" />
        ) : (
          <ImageIcon className="size-8" />
        )}
      </span>
    );
  // Public account library URLs are dynamic; native lazy images avoid a remote-host allowlist.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="bg-muted aspect-square size-full object-cover"
    />
  );
}
