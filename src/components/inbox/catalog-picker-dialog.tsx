"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, Loader2, ImageIcon, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { ComposerMediaKind } from "./message-composer";

interface CatalogFile {
  id: string;
  label: string | null;
  media_kind: "image" | "document";
  mime_type: string;
  storage_path: string;
}

interface CatalogProduct {
  id: string;
  name: string;
  description: string;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
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

/**
 * Lets a human agent attach a product-catalog file to a reply
 * immediately, instead of re-uploading a file every time. Two steps:
 * pick a product, then pick one of its files. Reuses the same
 * read-only `GET /api/ai/products` the AI's own attach flow reads
 * from (any account member may call it) -- one fetch loads every
 * product with its files nested, so step 2 needs no extra request.
 * Derives the public URL client-side -- the `ai-media` bucket is
 * public (migration 038), same as the auto-reply dispatcher's own
 * lookup.
 */
export function CatalogPickerDialog({
  open,
  onOpenChange,
  onPick,
}: CatalogPickerDialogProps) {
  const t = useTranslations("Inbox.composer");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!open) return;
    setSelectedProductId(null);
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/ai/products", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setProducts((data.items as CatalogProduct[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePickFile = (file: CatalogFile) => {
    const { data } = supabase.storage.from("ai-media").getPublicUrl(file.storage_path);
    const filename = file.storage_path.split("/").pop() || file.label || "file";
    onPick({
      kind: file.media_kind,
      mediaUrl: data.publicUrl,
      path: file.storage_path,
      filename,
    });
    onOpenChange(false);
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {selectedProduct && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setSelectedProductId(null)}
                title={t("catalogBack")}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>{selectedProduct ? selectedProduct.name : t("catalog")}</DialogTitle>
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedProduct ? (
            products.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("catalogEmpty")}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {products.map((product) => {
                  const hasRange = product.price_min != null && product.price_max != null;
                  const unit = product.price_unit ? product.price_unit.replace(/_/g, " ") : "";
                  return (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedProductId(product.id)}
                        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {product.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {product.description}
                            {hasRange && (
                              <>
                                {" "}
                                ({product.price_min}-{product.price_max}
                                {unit ? ` / ${unit}` : ""})
                              </>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : selectedProduct.files.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("catalogNoFiles")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {selectedProduct.files.map((file) => (
                <li key={file.id}>
                  <button
                    type="button"
                    onClick={() => handlePickFile(file)}
                    className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                  >
                    {file.media_kind === "image" ? (
                      <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm text-foreground">
                      {file.label || file.media_kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
