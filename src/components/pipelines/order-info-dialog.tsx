"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { CustomFieldGroupFields } from "@/components/custom-fields/custom-field-group-fields";
import type { Deal } from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { User2, Phone, ExternalLink, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

interface OrderInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Must have `contact` embedded — the caller's `loadDeals` query
   *  already selects `contact:contacts(*)`. */
  deal: Deal;
  onSaved: () => void;
  /** Field ids the move route just rejected the deal for — custom
   *  field ids from any group linked to the stage (migration 046), plus
   *  `contact_name` / `contact_phone` for the independent
   *  `requires_contact_identity` check. Highlights exactly those
   *  fields and shows a banner explaining why this popped up. Absent
   *  when opened as the plain "just entered this stage" nudge. */
  missingFieldIds?: string[];
}

/**
 * Deal info popup. Opens two ways:
 *  - a convenience nudge when a deal enters a stage with an active
 *    custom field group linked (migration 046) — dismissible any time;
 *  - automatically, with `missingFieldIds` set, when the move route
 *    rejects a stage change because required fields are still empty
 *    — the real gate lives at `POST /api/pipelines/deals/[id]/move`,
 *    this is just the fastest path to fixing what it flagged.
 *
 * Renders every active group for both scopes via the shared
 * `CustomFieldGroupFields` — deal-scoped groups against this deal,
 * contact-scoped groups against its linked contact — so whichever
 * group(s) actually gated the move show up here regardless of scope.
 * The bot can also fill deal-scoped fields in naturally from the
 * conversation (`applyCollectedFields`, src/lib/ai/collect-fields.ts)
 * and a human agent can finish the rest here or inline on the inbox
 * contact sidebar. Client name/phone are read-only here (sourced from
 * the linked contact, not duplicated onto the deal) — edit them from
 * Contacts.
 */
export function OrderInfoDialog({
  open,
  onOpenChange,
  deal,
  onSaved,
  missingFieldIds,
}: OrderInfoDialogProps) {
  const t = useTranslations("Pipelines.orderInfo");

  const missing = new Set(missingFieldIds ?? []);

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

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {missing.size > 0 && (
              <Alert className="border-red-500/40 bg-red-500/10">
                <AlertTriangle className="size-4 text-red-400" />
                <AlertDescription className="text-red-200">
                  {t("missingFieldsBanner")}
                </AlertDescription>
              </Alert>
            )}

            <div
              className={cn(
                "space-y-1.5 rounded-lg border border-border bg-muted/50 p-3",
                (missing.has("contact_name") || missing.has("contact_phone")) &&
                  "border-red-500/60",
              )}
            >
              <div className="flex items-center gap-2 text-sm text-foreground">
                <User2 className="h-3.5 w-3.5 text-muted-foreground" />
                {deal.contact?.name || (
                  <span className={missing.has("contact_name") ? "text-red-300" : ""}>
                    {t("noName")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {deal.contact?.phone || (
                  <span className={missing.has("contact_phone") ? "text-red-300" : ""}>
                    {t("noPhone")}
                  </span>
                )}
              </div>
              <Link
                href="/contacts"
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
              >
                <ExternalLink className="h-3 w-3" />
                {t("editInContacts")}
              </Link>
            </div>

            <CustomFieldGroupFields
              scope="deal"
              recordId={deal.id}
              editable
              invalidFieldIds={missing}
              onSaved={onSaved}
            />
            {deal.contact_id && (
              <CustomFieldGroupFields
                scope="contact"
                recordId={deal.contact_id}
                editable
                invalidFieldIds={missing}
                onSaved={onSaved}
              />
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {missing.size > 0 ? t("cancel") : t("skipForNow")}
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("done")}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
