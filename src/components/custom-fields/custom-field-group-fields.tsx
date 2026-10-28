'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { isLikelyUrl } from '@/lib/pipelines/order-fields';
import { cn } from '@/lib/utils';
import type { CustomField, CustomFieldGroup } from '@/types';
import { toast } from 'sonner';
import { ExternalLink, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface CustomFieldGroupFieldsProps {
  /** Which side of the scope split to render — 'contact' groups persist
   *  across a contact's whole history; 'deal' groups belong to one
   *  specific order (see migration 046). */
  scope: 'contact' | 'deal';
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
  const t = useTranslations('CustomFieldGroups.fields');
  const { accountId } = useAuth();
  const [groups, setGroups] = useState<CustomFieldGroup[]>([]);
  const [fieldsByGroup, setFieldsByGroup] = useState<
    Record<string, CustomField[]>
  >({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestVersion = useRef(0);
  const editing = useRef(false);
  const dirtyFields = useRef(new Set<string>());

  const valueTable =
    scope === 'contact' ? 'contact_custom_values' : 'deal_custom_values';
  const recordColumn = scope === 'contact' ? 'contact_id' : 'deal_id';

  const fetchAll = useCallback(async () => {
    if (!accountId || editing.current || dirtyFields.current.size > 0) return;
    const version = ++requestVersion.current;
    const supabase = createClient();
    const [groupsRes, fieldsRes] = await Promise.all([
      supabase
        .from('custom_field_groups')
        .select('*')
        .eq('account_id', accountId)
        .eq('scope', scope)
        .eq('is_active', true)
        .order('position'),
      supabase
        .from('custom_fields')
        .select('*')
        .eq('account_id', accountId)
        .order('position'),
    ]);

    if (
      version !== requestVersion.current ||
      editing.current ||
      dirtyFields.current.size > 0
    )
      return;
    if (groupsRes.error || fieldsRes.error) {
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    const groupRows = (groupsRes.data as CustomFieldGroup[] | null) ?? [];
    // Ungrouped fields predate groups and always belong to the customer.
    if (scope === 'contact')
      groupRows.push({
        id: 'ungrouped',
        account_id: accountId,
        name: '',
        scope: 'contact',
        is_active: true,
        position: -1,
        created_at: '',
        updated_at: '',
      });

    const groupIds = new Set(groupRows.map((g) => g.id));
    const fieldRows = ((fieldsRes.data as CustomField[] | null) ?? []).filter(
      (f) => (f.group_id ? groupIds.has(f.group_id) : scope === 'contact')
    );
    const byGroup: Record<string, CustomField[]> = {};
    for (const f of fieldRows) {
      const key = f.group_id || 'ungrouped';
      (byGroup[key] ??= []).push(f);
    }

    if (recordId && fieldRows.length > 0) {
      const { data: valueRows, error: valuesError } = await supabase
        .from(valueTable)
        .select('custom_field_id, value')
        .eq(recordColumn, recordId)
        .in(
          'custom_field_id',
          fieldRows.map((f) => f.id)
        );
      if (
        version !== requestVersion.current ||
        editing.current ||
        dirtyFields.current.size > 0
      )
        return;
      if (valuesError) {
        setLoadFailed(true);
        setLoaded(true);
        return;
      }
      const map: Record<string, string> = {};
      for (const row of valueRows ?? []) {
        map[row.custom_field_id as string] = (row.value as string | null) ?? '';
      }
      setValues(map);
    } else {
      setValues({});
    }
    setGroups(groupRows);
    setFieldsByGroup(byGroup);
    setLoadFailed(false);
    setLoaded(true);
  }, [accountId, scope, recordId, valueTable, recordColumn]);

  useEffect(() => {
    setLoaded(false);
    editing.current = false;
    dirtyFields.current.clear();
    void fetchAll();
    const refresh = () => {
      if (document.visibilityState === 'visible') void fetchAll();
    };
    // Poll as well as refreshing on focus: value tables are not necessarily
    // published to Supabase Realtime in existing installations.
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    window.addEventListener('sales-assistance-updated', refresh);
    const invalidatePendingRequests = () => {
      requestVersion.current++;
    };
    return () => {
      invalidatePendingRequests();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('sales-assistance-updated', refresh);
    };
  }, [fetchAll]);

  async function saveValue(fieldId: string, value: string) {
    if (!recordId) return;
    const supabase = createClient();
    const trimmed = value.trim();
    const { error } = await supabase.from(valueTable).upsert(
      {
        [recordColumn]: recordId,
        custom_field_id: fieldId,
        value: trimmed || null,
      },
      { onConflict: `${recordColumn},custom_field_id` }
    );
    if (error) {
      toast.error(t('saveFailed'));
      return;
    }
    dirtyFields.current.delete(fieldId);
    onSaved?.();
  }

  if (!loaded)
    return <p className="text-muted-foreground text-xs">{t('loading')}</p>;
  if (loadFailed)
    return (
      <div role="alert" className="text-muted-foreground text-xs">
        {t('loadFailed')}{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void fetchAll()}
        >
          {t('retry')}
        </button>
      </div>
    );

  const sections = groups
    .map((group) => ({
      group,
      fields: (fieldsByGroup[group.id] ?? [])
        .slice()
        .sort((a, b) => a.position - b.position),
    }))
    .filter(({ fields }) => fields.length > 0);

  if (sections.length === 0)
    return <p className="text-muted-foreground text-xs">{t('noFields')}</p>;

  return (
    <div
      className={cn('space-y-2.5', className)}
      onFocusCapture={() => {
        editing.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          editing.current = false;
      }}
    >
      {sections.map(({ group, fields }) => {
        const hasAnyValue = fields.some((f) => values[f.id]?.trim());
        if (!editable && !hasAnyValue) return null;

        return (
          <div
            key={group.id}
            className="border-border bg-muted/50 rounded-lg border p-3"
          >
            <p className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase">
              <Layers className="h-3 w-3" />
              {group.id === 'ungrouped' ? t('customerDetails') : group.name}
            </p>
            <div className="mt-1.5 space-y-1.5">
              {fields.map((field) => (
                <GroupField
                  key={field.id}
                  field={field}
                  value={values[field.id] ?? ''}
                  editable={editable}
                  invalid={invalidFieldIds?.has(field.id) ?? false}
                  t={t}
                  onChange={(v) => {
                    dirtyFields.current.add(field.id);
                    setValues((prev) => ({ ...prev, [field.id]: v }));
                  }}
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
  const invalidClass = invalid
    ? 'border-red-500/60 focus-visible:ring-red-500/30'
    : '';

  if (!editable) {
    if (!value.trim()) return null;
    return (
      <p className="text-muted-foreground text-[11px]">
        <span className="text-foreground font-medium">{field.field_name}:</span>{' '}
        {asLink ? (
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary/80 underline underline-offset-2"
          >
            {t('openLink')}
          </a>
        ) : (
          value
        )}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      <label
        htmlFor={`custom-field-${field.id}`}
        className="text-muted-foreground px-0.5 text-[10px] font-medium tracking-wide uppercase"
      >
        {label}
      </label>
      {field.field_type === 'textarea' ? (
        <textarea
          id={`custom-field-${field.id}`}
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onBlur(value)}
          rows={2}
          className={cn(
            'border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/60 focus:ring-primary/30 w-full resize-none rounded-md border px-2 py-1.5 text-[11px] outline-none focus:ring-1',
            invalidClass
          )}
        />
      ) : (
        <div className="relative">
          <input
            id={`custom-field-${field.id}`}
            dir={
              field.field_type === 'url' || field.field_type === 'number'
                ? 'ltr'
                : 'auto'
            }
            type={
              field.field_type === 'number'
                ? 'number'
                : field.field_type === 'date'
                  ? 'date'
                  : 'text'
            }
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onBlur(value)}
            className={cn(
              'border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/60 focus:ring-primary/30 w-full rounded-md border px-2 py-1.5 text-[11px] outline-none focus:ring-1',
              asLink && 'pr-7',
              invalidClass
            )}
          />
          {asLink && (
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
