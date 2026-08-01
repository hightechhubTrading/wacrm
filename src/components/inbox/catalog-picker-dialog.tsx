"use client";

import { useEffect, useState } from "react";
import { Loader2, ImageIcon, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { ComposerMediaKind } from "./message-composer";

interface CatalogItem {
  id: string;
  name: string;
  product_label: string | null;
  description: string;
  price_min: number | null;
  price_max: number | null;
  price_unit: string | null;
  media_kind: "image" | "document";
  mime_type: string;
  storage_path: string;
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
 * Lets a human agent attach a product-catalog item to a reply
 * immediately, instead of re-uploading a file every time. Reuses the
 * same read-only `GET /api/ai/media` the AI's own attach flow reads
 * from (any account member may call it), and derives the public URL
 * client-side — the `ai-media` bucket is public (migration 038), same
 * as the auto-reply dispatcher's own lookup.
 */
export function CatalogPickerDialog({
  open,
  onOpenChange,
  onPick,
}: CatalogPickerDialogProps) {
  const t = useTranslations("Inbox.composer");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/ai/media", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setItems((data.items as CatalogItem[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePick = (item: CatalogItem) => {
    const { data } = supabase.storage.from("ai-media").getPublicUrl(item.storage_path);
    const filename = item.storage_path.split("/").pop() || item.name;
    onPick({
      kind: item.media_kind,
      mediaUrl: data.publicUrl,
      path: item.storage_path,
      filename,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("catalog")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("catalogEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const hasRange = item.price_min != null && item.price_max != null;
                const unit = item.price_unit ? item.price_unit.replace(/_/g, " ") : "";
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(item)}
                      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                    >
                      {item.media_kind === "image" ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {item.name}
                          {item.product_label && (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              — {item.product_label}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                          {hasRange && (
                            <>
                              {" "}
                              ({item.price_min}-{item.price_max}
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
