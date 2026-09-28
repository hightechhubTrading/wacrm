"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format, subDays } from "date-fns";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adReportToCsv, type AdReportRow, type FailedSend } from "@/lib/conversions/report";

const STAGE_KEY = { qualified: "qualified", site_visit: "siteVisit", won: "won" } as const;

export function AdConversionsReport() {
  const t = useTranslations("AdConversions");
  const [from, setFrom] = useState(() => format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [rows, setRows] = useState<AdReportRow[]>([]);
  const [failed, setFailed] = useState<FailedSend[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/conversions/report?from=${from}&to=${to}`);
    setLoading(false);
    if (!res.ok) {
      toast.error(t("loadFailed"));
      return;
    }
    const body = (await res.json()) as { rows: AdReportRow[]; failed: FailedSend[] };
    setRows(body.rows);
    setFailed(body.failed);
  }, [from, to, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  function exportCsv() {
    const blob = new Blob([adReportToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ad-conversions_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const num = (n: number) => n.toLocaleString();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t("from")}</span>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">{t("to")}</span>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="me-1 h-4 w-4" />
          {t("exportCsv")}
        </Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-start">{t("adColumn")}</th>
              <th className="px-3 py-2 text-end">{t("conversations")}</th>
              <th className="px-3 py-2 text-end">{t("qualified")}</th>
              <th className="px-3 py-2 text-end">{t("siteVisit")}</th>
              <th className="px-3 py-2 text-end">{t("won")}</th>
              <th className="px-3 py-2 text-end">{t("wonValue")}</th>
              <th className="px-3 py-2 text-end">{t("qualifiedRate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ad_id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.headline || r.ad_id}</div>
                    {r.headline && <div className="text-xs text-muted-foreground">{r.ad_id}</div>}
                  </td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.conversations)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.qualified)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.site_visit)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.won)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{num(r.won_value)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{(r.qualified_rate * 100).toFixed(1)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{t("failedTitle")}</h2>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("failedEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start">{t("stage")}</th>
                  <th className="px-3 py-2 text-end">{t("attempts")}</th>
                  <th className="px-3 py-2 text-start">{t("lastError")}</th>
                  <th className="px-3 py-2 text-start">{t("lastAttempt")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {failed.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-3 py-2">{t(STAGE_KEY[f.stage])}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{f.attempts}</td>
                    <td className="px-3 py-2 text-xs">{f.last_error}</td>
                    <td className="px-3 py-2 text-xs">
                      {f.last_attempt_at ? format(new Date(f.last_attempt_at), "yyyy-MM-dd HH:mm") : "—"}
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Link className="text-primary hover:underline" href={`/inbox?c=${f.conversation_id}`}>
                        {t("openConversation")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
