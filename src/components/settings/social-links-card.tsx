'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Share2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';

const PLATFORMS = ['website', 'instagram', 'facebook', 'tiktok', 'x'] as const;

/**
 * Account-wide social media / website links the AI assistant may share
 * when a customer asks (see the `socialLinks` param on `buildSystemPrompt`,
 * defaults.ts). Writes go straight to `accounts.social_links` — same
 * pattern as DealsSettings' default_currency and BusinessHoursCard.
 */
export function SocialLinksCard() {
  const t = useTranslations('Settings.aiConfig.socialLinks');
  const { accountId, canEditSettings: canEdit, profileLoading } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const loadedRef = useRef(false);

  const fetchLinks = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('social_links')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      setLinks((data?.social_links as Record<string, string> | null) ?? {});
    } catch (err) {
      console.error('Failed to load social links:', err);
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase, t]);

  useEffect(() => {
    if (profileLoading || !accountId || loadedRef.current) return;
    loadedRef.current = true;
    void fetchLinks();
  }, [profileLoading, accountId, fetchLinks]);

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);
    try {
      // Drop blank entries so an emptied field clears it rather than
      // storing an empty string forever.
      const cleaned = Object.fromEntries(
        Object.entries(links).filter(([, v]) => v.trim()),
      );
      const { error } = await supabase
        .from('accounts')
        .update({ social_links: Object.keys(cleaned).length > 0 ? cleaned : null })
        .eq('id', accountId);
      if (error) throw error;
      toast.success(t('saveSuccess'));
    } catch (err) {
      console.error('Failed to save social links:', err);
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
          <Share2 className="h-4 w-4 text-primary" /> {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((platform) => (
            <div key={platform} className="space-y-1.5">
              <Label htmlFor={`social-${platform}`}>{t(`platform.${platform}`)}</Label>
              <Input
                id={`social-${platform}`}
                value={links[platform] ?? ''}
                onChange={(e) =>
                  setLinks((prev) => ({ ...prev, [platform]: e.target.value }))
                }
                placeholder="https://..."
                disabled={disabled}
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
