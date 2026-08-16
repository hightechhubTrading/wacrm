"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { Quotation } from "@/lib/quotations/types";
import { pickDefaultProductCode, type ProductCode } from "@/lib/quotations/product-codes";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

interface QuotationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  contactId?: string | null;
}

/**
 * Per-deal Quotations popup. Lists every quotation already linked to
 * this deal (`GET /api/quotations?dealId=`, this task's extension of
 * Task 6/11's list route) and lets the agent start a new one pre-filled
 * with this deal's `dealId`/`contactId` (`POST /api/quotations`, Task
 * 6/11).
 *
 * No `accountId` prop -- matching every other component in this feature
 * (Tasks 11-13, `quotation-list.tsx`) -- the API always derives it
 * server-side from the caller's own session (`ctx.accountId`) and
 * ignores any client-supplied value.
 *
 * Mirrors `order-info-dialog.tsx`'s shape: same Sheet container, and
 * the same lifted `open`/`onOpenChange` state pattern (state lives in
 * the pipelines page, not here) rather than a local dialog-open flag.
 */
export function QuotationsDialog({
  open,
  onOpenChange,
  dealId,
  contactId,
}: QuotationsDialogProps) {
  const t = useTranslations("Pipelines.quotationsDialog");
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Product codes are admin-managed (Task 15's Settings page, GET/POST
  // /api/quotation-product-codes), not hardcoded -- a code added in
  // Settings must be selectable here immediately, same reasoning as
  // quotation-list.tsx's standalone-creation flow. A brand-new account
  // can have zero codes seeded (059's seed step is applied per-account
  // by the app, not yet wired up as of this wave), so creation is
  // disabled with an explanatory message rather than defaulting to
  // "GEN", which might not exist for this account.
  const [productCodes, setProductCodes] = useState<ProductCode[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [productCode, setProductCode] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/quotations?dealId=${dealId}`)
      .then((res) => res.json())
      .then((data: Quotation[]) => {
        if (!cancelled) setQuotations(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, dealId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingCodes(true);
    fetch("/api/quotation-product-codes")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ProductCode[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setProductCodes(list);
        setProductCode((prev) => pickDefaultProductCode(list, prev));
      })
      .finally(() => {
        if (!cancelled) setLoadingCodes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function createNew() {
    if (!productCode) return;
    setCreating(true);
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          contactId: contactId ?? undefined,
          productCode,
          currency: "QAR",
        }),
      });
      if (!res.ok) {
        // A rejected create must not navigate to /quotations/undefined
        // -- surface the failure instead.
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Failed to create quotation (${res.status})`);
        return;
      }
      const created = await res.json();
      window.location.href = `/quotations/${created.id}`;
    } catch {
      toast.error("Failed to create quotation — check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {t("title")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!loading && quotations.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            )}
            {quotations.map((q) => (
              <Link
                key={q.id}
                href={`/quotations/${q.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm hover:bg-muted"
              >
                <span className="flex min-w-0 items-center gap-2 text-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{q.reference}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {q.status}
                  </span>
                </span>
                <span className="shrink-0 font-medium text-foreground">
                  {q.total.toLocaleString()} {q.currency}
                </span>
              </Link>
            ))}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4 space-y-2">
            {productCodes.length > 1 && (
              <Select
                value={productCode}
                onValueChange={(v) => v && setProductCode(v)}
                disabled={loadingCodes || creating}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {productCodes.map((pc) => (
                    <SelectItem key={pc.code} value={pc.code}>
                      {pc.label} ({pc.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              onClick={createNew}
              disabled={creating || loadingCodes || !productCode}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-1 h-4 w-4" />
              {creating ? t("creating") : t("newQuotation")}
            </Button>
            {!loadingCodes && productCodes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No product codes configured yet — add one under{" "}
                <Link
                  href="/settings?tab=quotation-product-codes"
                  className="text-primary hover:underline"
                >
                  Settings
                </Link>{" "}
                before creating a quotation.
              </p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
