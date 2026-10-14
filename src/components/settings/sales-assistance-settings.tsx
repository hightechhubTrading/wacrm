'use client';
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Tag, X, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';
type Data = {
  enabled: boolean;
  aiActive: boolean;
  mode: string;
  verifierReady: boolean;
  tags: { id: string; name: string; color: string; ai_rule: string | null }[];
};
export function SalesAssistanceSettings() {
  const t = useTranslations('SalesAssistance');
  const { profile, accountId } = useAuth();
  const canEdit =
    !!profile?.account_role && canEditSettings(profile.account_role);
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [tag, setTag] = useState(''),
    [rule, setRule] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/ai/assistance', { signal });
      if (!res.ok) throw Error();
      const next = await res.json();
      if (!signal?.aborted) {
        setData(next);
        setError(false);
      }
    } catch {
      if (!signal?.aborted) setError(true);
    }
  }, []);
  useEffect(() => {
    setData(null);
    setTag('');
    setRule('');
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [accountId, refresh]);
  async function save(body: object) {
    setBusy(true);
    try {
      const res = await fetch('/api/ai/assistance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw Error();
      await refresh();
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveError'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="crm-assistance-settings mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles size={20} />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? (
          <div role="alert">
            <p>{t('unavailable')}</p>
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshCw size={16} />
              {t('retry')}
            </Button>
          </div>
        ) : !data ? (
          <p role="status">{t('loading')}</p>
        ) : (
          <>
            <label className="crm-assistance-activation">
              <div>
                <p className="font-medium">{t('enable')}</p>
                <p className="text-muted-foreground text-sm">
                  {t('enableHint')}
                </p>
              </div>
              <Switch
                aria-label={t('enable')}
                checked={data.enabled}
                disabled={
                  !canEdit ||
                  busy ||
                  (!data.enabled &&
                    (!data.aiActive ||
                      data.mode === 'off' ||
                      !data.verifierReady))
                }
                onCheckedChange={(enabled) => void save({ enabled })}
              />
            </label>
            {(!data.aiActive || data.mode === 'off' || !data.verifierReady) && (
              <p className="text-muted-foreground text-sm">
                {t('requirements')}
              </p>
            )}
            {data.mode === 'shadow' && (
              <p className="text-muted-foreground text-sm">{t('preview')}</p>
            )}
            <div className="border-t pt-4">
              <h3 className="flex items-center gap-2 font-medium">
                <Tag size={17} />
                {t('rules')}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('rulesHint')}
              </p>
            </div>
            <div className="crm-assistance-rules space-y-2">
              {data.tags
                .filter((item) => item.ai_rule)
                .map((item) => (
                  <div
                    key={item.id}
                    className="bg-muted/40 flex items-start gap-3 rounded-xl p-3"
                  >
                    <Tag size={16} style={{ color: item.color }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-muted-foreground text-sm" dir="auto">
                        {item.ai_rule}
                      </p>
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('removeRule', { name: item.name })}
                        disabled={busy}
                        onClick={() => void save({ tag_id: item.id, rule: '' })}
                      >
                        <X size={15} />
                      </Button>
                    )}
                  </div>
                ))}
            </div>
            {canEdit && (
              <form
                className="crm-assistance-form space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (tag && rule.trim()) void save({ tag_id: tag, rule });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="assistance-tag-picker">{t('tag')}</Label>
                  <Select
                    items={data.tags.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                    value={tag || null}
                    onValueChange={(value) => {
                      setTag(value ?? '');
                      setRule(
                        data.tags.find((item) => item.id === value)?.ai_rule ??
                          ''
                      );
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id="assistance-tag-picker"
                      className="w-full"
                    >
                      <SelectValue placeholder={t('chooseTag')} />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="crm-assistance-tag-menu"
                    >
                      {data.tags.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          <Tag
                            size={15}
                            style={{ color: item.color }}
                            aria-hidden
                          />
                          <bdi>{item.name}</bdi>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  {t('rule')}
                  <Textarea
                    value={rule}
                    onChange={(event) => setRule(event.target.value)}
                    placeholder={t('ruleExample')}
                    maxLength={1000}
                    required
                    dir="auto"
                  />
                </label>
                <Button type="submit" disabled={busy || !tag || !rule.trim()}>
                  {t('saveRule')}
                </Button>
              </form>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
