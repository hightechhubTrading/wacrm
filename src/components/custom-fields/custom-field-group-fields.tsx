"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isLikelyUrl } from "@/lib/pipelines/order-fields";
import { cn } from "@/lib/utils";
import type { CustomField, CustomFieldGroup } from "@/types";
import { ExternalLink, Layers } from "lucide-react";
import { useTranslations } from "next-intl";

interface CustomFieldGroupFieldsProps {
  /** Which side of the scope split to render — 'contact' groups persist
   *  across a contact's whole history; 'deal' groups belong to one
   *  specific order (see migration 046). */
  scope: "contact" | "deal";
  /** The contact or deal id values are stored against. */
  recordId: string;
  editable: boolean;
  onSaved?: () => void;
  /** Field ids to highlight as invalid (from the move route's 422
   *  response) — same highlight behaviour the old Order Info dialog
   *  had, now generalized to any group field. */
  invalidFieldIds?: Set<string>;
  /** Applied to the outer wrapper, but only when at least one section
   *  actually renders — lets a caller (e.g. a deal card) add a
   *  top border/margin that never shows up as a stray empty divider
   *  when there's nothing to render. */
  className?: string;
}

/**
 * Unified renderer for custom field GROUPS (migration 046) — retires
 * the three previously hardcoded UIs (`DealOrderInfoFields`/
 * `OrderInfoField` in the inbox sidebar, the bordered "Order Info"
 * block in the deal form, and the Order Info dialog's fixed fields).
 * Fetches every ACTIVE group for the given `scope`, its fields, and
 * their current values, then renders one bordered section per group
 * with the right control per `field_type`. Read-only mode collapses a
 * group entirely when it has no value at all — same behaviour the old
 * order-info block had, so a fresh lead's sidebar isn't cluttered with
 * empty sections.
 */
export function CustomFieldGroupFields({
  scope,
  recordId,
  editable,
  onSaved,
  invalidFieldIds,
  className,
}: CustomFieldGroupFieldsProps) {
  const t = useTranslations("CustomFieldGroups.fields");
  const { accountId } = useAuth();
  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [fieldsByGroup, setFieldsByGroup] = useState<Record<string, CustomField[]>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const valueTable = scope === "contact" ? "contact_custom_values" : "deal_custom_values";
  const recordColumn = scope === "contact" ? "contact_id" : "deal_id";

  const fetchAll = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const [groupsRes, fieldsRes] = await Promise.all([
      supabase
        .from("custom_field_groups")
        .select("*")
        .eq("account_id", accountId)
        .eq("scope", scope)
        .eq("is_active", true)
        .order("position"),
      supabase
        .from("custom_fields")
        .select("*")
        .eq("account_id", accountId)
        .not("group_id", "is", null)
        .order("position"),
    ]);

    const groupRows = (groupsRes.data as CustomFieldGroup[] | null) ?? [];
    setGroups(groupRows);

    const groupIds = new Set(groupRows.map((g) => g.id));
    const fieldRows = ((fieldsRes.data as CustomField[] | null) ?? []).filter(
      (f) => f.group_id && groupIds.has(f.group_id),
    );
    const byGroup: Record<string, CustomField[]> = {};
    for (const f of fieldRows) {
      const key = f.group_id as string;
      (byGroup[key] ??= []).push(f);
    }
    setFieldsByGroup(byGroup);

    if (recordId && fieldRows.length > 0) {
      const { data: valueRows } = await supabase
        .from(valueTable)
        .select("custom_field_id, value")
        .eq(recordColumn, recordId)
        .in(
          "custom_field_id",
          fieldRows.map((f) => f.id),
        );
      const map: Record<string, string> = {};
      for (const row of valueRows ?? []) {
        map[row.custom_field_id as string] = (row.value as string | null) ?? "";
      }
      setValues(map);
    } else {
      setValues({});
    }
    setLoaded(true);
  }, [accountId, scope, recordId, valueTable, recordColumn]);

  useEffect(() => {
    setLoaded(false);
    fetchAll();
  }, [fetchAll]);

  async function saveValue(fieldId: string, value: string) {
    if (!recordId) return;
    const supabase = createClient();
    const trimmed = value.trim();
    await supabase
      .from(valueTable)
      .upsert(
        { [recordColumn]: recordId, custom_field_id: fieldId, value: trimmed || null },
        { onConflict: `${recordColumn},custom_field_id` },
      );
    onSaved?.();
  }

  if (!loaded || groups.length === 0) return null;

  const sections = groups
    .map((group) => ({
      group,
      fields: (fieldsByGroup[group.id] ?? []).slice().sort((a, b) => a.position - b.position),
    }))
    .filter(({ fields }) => fields.length > 0);

  if (sections.length === 0) return null;

  return (
    <div className={cn("space-y-2.5", className)}>
      {sections.map(({ group, fields }) => {
        const hasAnyValue = fields.some((f) => values[f.id]?.trim());
        if (!editable && !hasAnyValue) return null;

        return (
          <div key={group.id} className="rounded-lg border border-border bg-muted/50 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Layers className="h-3 w-3" />
              {group.name}
            </p>
            <div className="mt-1.5 space-y-1.5">
              {fields.map((field) => (
                <GroupField
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ""}
                  editable={editable}
                  invalid={invalidFieldIds?.has(field.id) ?? false}
                  t={t}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
                  onBlur={(v) => saveValue(field.id, v)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GroupField({
  field,
  value,
  editable,
  invalid,
  t,
  onChange,
  onBlur,
}: {
  field: CustomField;
  value: string;
  editable: boolean;
  invalid: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
}) {
  const label = field.required ? `${field.field_name} *` : field.field_name;
  const asLink = isLikelyUrl(value);
  const invalidClass = invalid ? "border-red-500/60 focus-visible:ring-red-500/30" : "";

  if (!editable) {
    if (!value.trim()) return null;
    return (
      <p className="text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{field.field_name}:</span>{" "}
        {asLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {t("openLink")}
          </a>
        ) : (
          value
        )}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      <label className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {field.field_type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onBlur(value)}
          rows={2}
          className={cn(
            "w-full resize-none rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30",
            invalidClass,
          )}
        />
      ) : (
        <div className="relative">
          <input
            type={
              field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onBlur(value)}
            className={cn(
              "w-full rounded-md border border-border bg-muted px-2 py-1.5 text-[11px] text-foreground placeholder-muted-foreground outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30",
              asLink && "pr-7",
              invalidClass,
            )}
          />
          {asLink && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
