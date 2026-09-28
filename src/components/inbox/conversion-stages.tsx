"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Megaphone, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { RequireRole } from "@/components/auth/require-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CONVERSION_STAGES, type ConversionStage } from "@/lib/conversions/stages";
import type { Conversation } from "@/types";

interface StageRow {
  id: string;
  stage: ConversionStage;
  undone_at: string | null;
}

const STAGE_LABEL_KEY: Record<ConversionStage, string> = {
  qualified: "stageQualified",
  site_visit: "stageSiteVisit",
  won: "stageWon",
};

interface Props {
  conversation: Conversation;
  /** Bumped by the inbox when messages land -- refetch (a deal may have
   *  been marked won elsewhere). */
  refreshToken?: number;
}

/**
 * Lead-stage tagging for CTWA conversions (migration 065). Tags are sent
 * to Meta only for ad-sourced chats; organic chats are tracked in-app.
 */
export function ConversionStages({ conversation, refreshToken }: Props) {
  const t = useTranslations("Inbox.sidebar");
  const [rows, setRows] = useState<StageRow[]>([]);
  const [pending, setPending] = useState<ConversionStage | null>(null);
  const [undoing, setUndoing] = useState<StageRow | null>(null);
  const [wonValue, setWonValue] = useState("");
  const [busy, setBusy] = useState(false);

  const fromAd = !!conversation.ad_clicked_at;
  const adName = conversation.ad_headline || conversation.ad_source_id || "";

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from("conversion_events")
      .select("id, stage, undone_at")
      .eq("conversation_id", conversation.id);
    setRows((data as StageRow[] | null) ?? []);
  }, [conversation.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshToken]);

  const active = (stage: ConversionStage) =>
    rows.find((r) => r.stage === stage && !r.undone_at) ?? null;

  const wonNumber = Number(wonValue);
  const wonValid = wonValue.trim() !== "" && Number.isFinite(wonNumber) && wonNumber > 0;

  async function confirmTag() {
    if (!pending) return;
    if (pending === "won" && !wonValid) return;
    setBusy(true);
    const res = await fetch("/api/conversions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversation.id,
        stage: pending,
        ...(pending === "won" ? { value: wonNumber } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(body?.error ?? t("toastStageFailed"));
      return;
    }
    toast.success(t("toastStageSaved"));
    setPending(null);
    setWonValue("");
    void load();
  }

  async function confirmUndo() {
    if (!undoing) return;
    setBusy(true);
    const res = await fetch(`/api/conversions/${undoing.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast.error(t("toastStageFailed"));
      return;
    }
    toast.success(t("toastStageUndone"));
    setUndoing(null);
    void load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Megaphone className="h-3 w-3" />
        {t("leadStage")}
      </div>

      <p className={cn("mt-2 px-1 text-xs", fromAd ? "text-foreground" : "text-muted-foreground")}>
        {fromAd ? t("fromAd", { name: adName }) : t("notFromAd")}
      </p>

      <RequireRole min="agent">
        <div className="mt-2 flex flex-wrap gap-1.5 px-1">
          {CONVERSION_STAGES.map((stage) => {
            const row = active(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() => (row ? setUndoing(row) : setPending(stage))}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  row
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {row && <Check className="h-3 w-3" />}
                {t(STAGE_LABEL_KEY[stage])}
              </button>
            );
          })}
        </div>
      </RequireRole>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending && t("stageConfirmTitle", { stage: t(STAGE_LABEL_KEY[pending]) })}
            </DialogTitle>
            <DialogDescription>
              {fromAd ? t("stageConfirmBody") : t("stageConfirmBodyOrganic")}
            </DialogDescription>
          </DialogHeader>
          {pending === "won" && (
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="won-value">
                {t("wonValueLabel")}
              </label>
              <Input
                id="won-value"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={wonValue}
                onChange={(e) => setWonValue(e.target.value)}
              />
              {wonValue !== "" && !wonValid && (
                <p className="text-xs text-destructive">{t("wonValueInvalid")}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>
              {t("stageCancel")}
            </Button>
            <Button onClick={confirmTag} disabled={busy || (pending === "won" && !wonValid)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("stageConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={undoing !== null} onOpenChange={(open) => !open && setUndoing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {undoing && t("stageUndoTitle", { stage: t(STAGE_LABEL_KEY[undoing.stage]) })}
            </DialogTitle>
            <DialogDescription>{t("stageUndoBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndoing(null)} disabled={busy}>
              {t("stageCancel")}
            </Button>
            <Button variant="destructive" onClick={confirmUndo} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("stageUndo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
