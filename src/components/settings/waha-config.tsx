'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, MessageSquare, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_KEY = '••••••••••••••••';

interface WahaConfigResponse {
  configured: boolean;
  has_api_key?: boolean;
  base_url?: string | null;
  session_name?: string;
  group_chat_id?: string | null;
  is_active?: boolean;
}

/**
 * Connection settings for a self-hosted WAHA (WhatsApp HTTP API)
 * instance, used only to post structured messages into an internal
 * WhatsApp GROUP when a deal enters a flagged pipeline stage — Meta's
 * Cloud API (everywhere else in this app) cannot message groups at
 * all. This is a separate, unofficial WhatsApp connection the admin
 * stands up and authenticates independently (Docker + QR login),
 * deliberately isolated from the customer-facing Cloud API number.
 */
export function WahaConfig() {
  const t = useTranslations('Settings.waha');
  const { accountId, canEditSettings, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [configured, setConfigured] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [sessionName, setSessionName] = useState('default');
  const [groupChatId, setGroupChatId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [isActive, setIsActive] = useState(false);

  const loadedRef = useRef(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/waha/config');
      const data = (await res.json()) as WahaConfigResponse;
      setConfigured(!!data.configured);
      setBaseUrl(data.base_url ?? '');
      setSessionName(data.session_name ?? 'default');
      setGroupChatId(data.group_chat_id ?? '');
      setIsActive(!!data.is_active);
      setApiKey(data.has_api_key ? MASKED_KEY : '');
      setKeyEdited(false);
    } catch (err) {
      console.error('Failed to load WAHA config:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (profileLoading || !accountId || loadedRef.current) return;
    loadedRef.current = true;
    fetchConfig();
  }, [profileLoading, accountId, fetchConfig]);

  async function handleSave() {
    if (!baseUrl.trim()) {
      toast.error(t('toastBaseUrlRequired'));
      return;
    }
    if (!groupChatId.trim().endsWith('@g.us')) {
      toast.error(t('toastGroupIdInvalid'));
      return;
    }
    if (!configured && (!apiKey.trim() || !keyEdited)) {
      toast.error(t('toastKeyRequired'));
      return;
    }

    setSaving(true);
    const payload: Record<string, unknown> = {
      base_url: baseUrl.trim(),
      session_name: sessionName.trim() || 'default',
      group_chat_id: groupChatId.trim(),
      is_active: isActive,
    };
    if (keyEdited && apiKey !== MASKED_KEY && apiKey.trim()) {
      payload.api_key = apiKey.trim();
    }

    try {
      const res = await fetch('/api/waha/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('toastSaveFailed'));
        return;
      }
      toast.success(t('toastSaved'));
      await fetchConfig();
    } catch (err) {
      console.error('Save error:', err);
      toast.error(t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Alert className="mb-4 bg-card border-border">
        <div className="flex items-center gap-2">
          {configured && isActive ? (
            <CheckCircle2 className="size-4 text-primary" />
          ) : (
            <XCircle className="size-4 text-muted-foreground" />
          )}
          <AlertTitle className="mb-0 text-foreground">
            {configured && isActive ? t('statusActive') : t('statusInactive')}
          </AlertTitle>
        </div>
        <AlertDescription className="text-muted-foreground">
          {t('statusDesc')}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <MessageSquare className="size-4 text-primary" />
            {t('connectionTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('connectionDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('baseUrl')}</Label>
            <Input
              placeholder="https://waha.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={!canEditSettings}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('apiKey')}</Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={t('apiKeyPlaceholder')}
                value={apiKey}
                disabled={!canEditSettings}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyEdited(true);
                }}
                onFocus={() => {
                  if (apiKey === MASKED_KEY) {
                    setApiKey('');
                    setKeyEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pe-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('sessionName')}</Label>
            <Input
              placeholder="default"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              disabled={!canEditSettings}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              {t('sessionNameNotUsedHint')}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('groupChatId')}</Label>
            <Input
              placeholder="120363047483149991@g.us"
              value={groupChatId}
              onChange={(e) => setGroupChatId(e.target.value)}
              disabled={!canEditSettings}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">{t('groupChatIdHint')}</p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">{t('activeLabel')}</p>
              <p className="text-xs text-muted-foreground">{t('activeHint')}</p>
            </div>
            <Switch
              checked={isActive}
              onCheckedChange={setIsActive}
              disabled={!canEditSettings}
            />
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
