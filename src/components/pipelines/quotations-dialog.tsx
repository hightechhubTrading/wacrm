"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Quotation } from "@/lib/quotations/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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

  async function createNew() {
    setCreating(true);
    try {
      const res = await fetch("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          dealId,
          contactId: contactId ?? undefined,
          productCode: "GEN",
          currency: "QAR",
        }),
      });
      const created = await res.json();
      window.location.href = `/quotations/${created.id}`;
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

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <Button
              onClick={createNew}
              disabled={creating}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-1 h-4 w-4" />
              {creating ? t("creating") : t("newQuotation")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
