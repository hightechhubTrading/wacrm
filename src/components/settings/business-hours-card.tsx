'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Clock, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import type { BusinessHours, Weekday } from '@/lib/ai/business-hours';

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface DayState {
  enabled: boolean;
  open: string;
  close: string;
}

const DEFAULT_DAY: DayState = { enabled: false, open: '09:00', close: '18:00' };

function toDayStates(businessHours: BusinessHours | null): Record<Weekday, DayState> {
  const result = {} as Record<Weekday, DayState>;
  for (const day of WEEKDAYS) {
    const range = businessHours?.[day];
    result[day] = range ? { enabled: true, open: range[0], close: range[1] } : { ...DEFAULT_DAY };
  }
  return result;
}

function toBusinessHours(days: Record<Weekday, DayState>): BusinessHours {
  const result: BusinessHours = {};
  for (const day of WEEKDAYS) {
    const d = days[day];
    result[day] = d.enabled ? [d.open, d.close] : null;
  }
  return result;
}

/**
 * Account-wide business hours, consumed only by AI after-hours takeover
 * today (src/lib/ai/business-hours.ts, src/lib/ai/auto-reply.ts). Writes
 * go straight to `accounts.business_hours`/`timezone` — no bespoke API
 * route, same pattern as DealsSettings' default_currency — the existing
 * `accounts_update` RLS policy (017) already restricts this to admins+.
 */
export function BusinessHoursCard() {
  const t = useTranslations('Settings.aiConfig.businessHours');
  const { accountId, canEditSettings: canEdit, profileLoading } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<Record<Weekday, DayState>>(() => toDayStates(null));
  const [timezone, setTimezone] = useState('UTC');
  const loadedRef = useRef(false);

  const fetchHours = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('business_hours, timezone')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      setDays(toDayStates((data?.business_hours as BusinessHours | null) ?? null));
      setTimezone(data?.timezone || 'UTC');
    } catch (err) {
      console.error('Failed to load business hours:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase, t]);

  useEffect(() => {
    if (profileLoading || !accountId || loadedRef.current) return;
    loadedRef.current = true;
    void fetchHours();
  }, [profileLoading, accountId, fetchHours]);

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('accounts')
        .update({
          business_hours: toBusinessHours(days),
          timezone: timezone.trim() || 'UTC',
        })
        .eq('id', accountId);
      if (error) throw error;
      toast.success(t('saveSuccess'));
    } catch (err) {
      console.error('Failed to save business hours:', err);
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEdit || saving;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="business-timezone">{t('timezone')}</Label>
          <Input
            id="business-timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Qatar"
            disabled={disabled}
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">{t('timezoneHint')}</p>
        </div>

        <div className="space-y-2">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2.5"
            >
              <Switch
                checked={days[day].enabled}
                onCheckedChange={(checked) =>
                  setDays((prev) => ({ ...prev, [day]: { ...prev[day], enabled: checked } }))
                }
                disabled={disabled}
              />
              <span className="w-10 text-sm font-medium text-foreground">{t(`day.${day}`)}</span>
              <Input
                type="time"
                value={days[day].open}
                onChange={(e) =>
                  setDays((prev) => ({ ...prev, [day]: { ...prev[day], open: e.target.value } }))
                }
                disabled={disabled || !days[day].enabled}
                className="w-28"
              />
              <span className="text-xs text-muted-foreground">{t('to')}</span>
              <Input
                type="time"
                value={days[day].close}
                onChange={(e) =>
                  setDays((prev) => ({ ...prev, [day]: { ...prev[day], close: e.target.value } }))
                }
                disabled={disabled || !days[day].enabled}
                className="w-28"
              />
            </div>
          ))}
        </div>

        {canEdit && (
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
