'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  Trash2,
  Eye,
  EyeOff,
  AlertTriangle,
  PlugZap,
  MessageSquare,
  BookOpen,
  Clock,
  AudioLines,
  ChevronRight,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SalesAssistanceSettings } from './sales-assistance-settings';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';
import { ProductCatalogPanel } from './product-catalog-panel';
import { BusinessHoursCard } from './business-hours-card';
import { SocialLinksCard } from './social-links-card';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import { useLocale, useTranslations } from 'next-intl';
import { DirectionProvider } from '@base-ui/react/direction-provider';

type SetupSection =
  | 'connection'
  | 'behaviour'
  | 'knowledge'
  | 'capabilities'
  | 'schedule'
  | 'assistance';

const SETUP_SECTIONS = [
  { id: 'connection', icon: PlugZap },
  { id: 'behaviour', icon: MessageSquare },
  { id: 'knowledge', icon: BookOpen },
  { id: 'capabilities', icon: AudioLines },
  { id: 'schedule', icon: Clock },
  { id: 'assistance', icon: Sparkles },
] as const;

const MASKED_KEY = '••••••••••••••••';

// Radix Select can't use an empty-string item value, so the "leave
// unassigned" choice gets a sentinel that maps to null in the payload.
const HANDOFF_QUEUE = '__queue__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
  deepseek: 'DeepSeek',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  gemini: 'AIza...',
  deepseek: 'sk-...',
};

export function AiConfig() {
  const locale = useLocale();
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');
  const [section, setSection] = useState<SetupSection>('connection');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [embeddingsKey, setEmbeddingsKey] = useState('');
  const [embeddingsKeyEdited, setEmbeddingsKeyEdited] = useState(false);
  const [hasStoredEmbeddingsKey, setHasStoredEmbeddingsKey] = useState(false);
  const [imageAnalysisProvider, setImageAnalysisProvider] = useState<
    'openai' | 'gemini'
  >('openai');
  const [imageAnalysisKey, setImageAnalysisKey] = useState('');
  const [imageAnalysisKeyEdited, setImageAnalysisKeyEdited] = useState(false);
  const [hasStoredImageAnalysisKey, setHasStoredImageAnalysisKey] =
    useState(false);
  const [imageAnalysisEnabled, setImageAnalysisEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [companyFacts, setCompanyFacts] = useState('');
  const [behaviorV2Enabled, setBehaviorV2Enabled] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [unlimitedReplies, setUnlimitedReplies] = useState(false);
  // Empty string = leave unassigned (shared queue).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [lastKeyError, setLastKeyError] = useState<string | null>(null);
  const [lastKeyErrorAt, setLastKeyErrorAt] = useState<string | null>(null);
  const [transcribeVoiceMessages, setTranscribeVoiceMessages] = useState(false);
  const [afterHoursTakeoverEnabled, setAfterHoursTakeoverEnabled] =
    useState(false);
  const [pauseDuringBusinessHours, setPauseDuringBusinessHours] =
    useState(false);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setCompanyFacts(data.company_facts ?? '');
        setBehaviorV2Enabled(data.behavior_v2_enabled === true);
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        const loadedMax = data.auto_reply_max_per_conversation ?? 3;
        setUnlimitedReplies(loadedMax <= 0);
        setMaxPerConversation(loadedMax > 0 ? loadedMax : 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setHasStoredEmbeddingsKey(Boolean(data.has_embeddings_key));
        setEmbeddingsKey(data.has_embeddings_key ? MASKED_KEY : '');
        setEmbeddingsKeyEdited(false);
        setLastKeyError(data.last_key_error ?? null);
        setLastKeyErrorAt(data.last_key_error_at ?? null);
        setTranscribeVoiceMessages(Boolean(data.transcribe_voice_messages));
        setAfterHoursTakeoverEnabled(
          Boolean(data.after_hours_takeover_enabled)
        );
        setPauseDuringBusinessHours(Boolean(data.pause_during_business_hours));
        setImageAnalysisProvider(
          data.image_analysis_provider === 'gemini' ? 'gemini' : 'openai'
        );
        setHasStoredImageAnalysisKey(Boolean(data.has_image_analysis_key));
        setImageAnalysisKey(data.has_image_analysis_key ? MASKED_KEY : '');
        setImageAnalysisKeyEdited(false);
        setImageAnalysisEnabled(Boolean(data.image_analysis_enabled));
      }
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    setCompanyFacts('');
    setBehaviorV2Enabled(false);
    void fetchConfig();
    // Members populate the handoff-target picker. Best-effort — on an
    // older deployment without the endpoint the picker just shows the
    // queue option.
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchConfig]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model) ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  // undefined = leave unchanged; '' typed = null (clear); text = set.
  const embeddingsKeyPayload = () =>
    embeddingsKeyEdited ? embeddingsKey.trim() || null : undefined;
  const imageAnalysisKeyPayload = () =>
    imageAnalysisKeyEdited ? imageAnalysisKey.trim() || null : undefined;

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    embeddings_api_key: embeddingsKeyPayload(),
    system_prompt: systemPrompt.trim() || null,
    company_facts: companyFacts.trim() || null,
    behavior_v2_enabled: behaviorV2Enabled,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: unlimitedReplies ? 0 : maxPerConversation,
    handoff_agent_id: handoffAgentId || null,
    transcribe_voice_messages: transcribeVoiceMessages,
    after_hours_takeover_enabled: afterHoursTakeoverEnabled,
    pause_during_business_hours: pauseDuringBusinessHours,
    image_analysis_provider: imageAnalysisProvider,
    image_analysis_api_key: imageAnalysisKeyPayload(),
    image_analysis_enabled: imageAnalysisEnabled,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('testSuccess'));
        setLastKeyError(null);
        setLastKeyErrorAt(null);
      } else {
        toast.error(data.error ?? t('testRejected'));
      }
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error(t('missingModel'));
      return;
    }
    if (!configured && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success(t('removeSuccess'));
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setUnlimitedReplies(false);
        setSystemPrompt('');
        setHandoffAgentId('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? t('removeFailed'));
      }
    } catch {
      toast.error(t('removeFailed'));
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div
        role="status"
        className="text-muted-foreground flex items-center justify-center py-16"
      >
        <Loader2 className="me-2 h-4 w-4 animate-spin" /> {t('layout.loading')}
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="crm-ai-config">
        <SettingsPanelHead title={t('title')} description={t('description')} />

        {!canEdit && (
          <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border px-3 py-2 text-sm">
            {t('adminOnlyConfig')}
          </p>
        )}

        {lastKeyError && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="size-4" />
            <AlertTitle>{t('keyErrorTitle')}</AlertTitle>
            <AlertDescription>
              {lastKeyError}
              {lastKeyErrorAt && (
                <>
                  {' — '}
                  {t('keyErrorAt', {
                    time: formatDistanceToNow(new Date(lastKeyErrorAt), {
                      addSuffix: true,
                    }),
                  })}
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="crm-agent-setup-grid">
          <label className="crm-agent-mobile-category space-y-2 text-sm font-medium">
            {t('layout.navigation')}
            <select
              value={section}
              onChange={(event) =>
                setSection(event.target.value as SetupSection)
              }
              className="border-border bg-card text-foreground focus-visible:outline-ring block min-h-12 w-full rounded-lg border px-3 focus-visible:outline-2"
            >
              {SETUP_SECTIONS.map(({ id }) => (
                <option key={id} value={id}>
                  {t(`layout.${id}`)}
                </option>
              ))}
            </select>
          </label>
          <nav
            aria-label={t('layout.navigation')}
            className="crm-agent-setup-nav"
          >
            {SETUP_SECTIONS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={section === id ? 'page' : undefined}
                aria-controls={`agent-setup-${id}`}
                className={cn(
                  'crm-agent-setup-link',
                  section === id && 'is-active'
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span>{t(`layout.${id}`)}</span>
                <ChevronRight className="ms-auto size-3.5 shrink-0 rtl:rotate-180" />
              </button>
            ))}
          </nav>
          <div className="min-w-0">
            <div className="mb-6">
              <h3 className="text-foreground text-lg font-semibold">
                {t(`layout.${section}`)}
              </h3>
              <p className="text-muted-foreground mt-1 max-w-[62ch] text-sm leading-relaxed">
                {t(`layout.${section}Hint`)}
              </p>
            </div>
            <div
              id="agent-setup-connection"
              hidden={section !== 'connection'}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="text-primary h-4 w-4" />{' '}
                    {t('providerAndKey')}
                  </CardTitle>
                  <CardDescription>{t('encryptionNotice')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="ai-provider">{t('provider')}</Label>
                      <Select
                        items={Object.entries(PROVIDER_LABEL).map(
                          ([value, label]) => ({ value, label })
                        )}
                        value={provider}
                        onValueChange={(v) =>
                          handleProviderChange(v as AiProvider)
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger id="ai-provider" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectItem value="openai">
                            {PROVIDER_LABEL.openai}
                          </SelectItem>
                          <SelectItem value="anthropic">
                            {PROVIDER_LABEL.anthropic}
                          </SelectItem>
                          <SelectItem value="gemini">
                            {PROVIDER_LABEL.gemini}
                          </SelectItem>
                          <SelectItem value="deepseek">
                            {PROVIDER_LABEL.deepseek}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="ai-model">{t('model')}</Label>
                      <Input
                        id="ai-model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                        disabled={disabled}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-key">{t('apiKey')}</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          id="ai-key"
                          type={showKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={(e) => {
                            setApiKey(e.target.value);
                            setKeyEdited(true);
                          }}
                          onFocus={() => {
                            if (!keyEdited && hasStoredKey) {
                              setApiKey('');
                              setKeyEdited(true);
                            }
                          }}
                          placeholder={KEY_PLACEHOLDER[provider]}
                          disabled={disabled}
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((s) => !s)}
                          className="text-muted-foreground hover:text-foreground absolute end-2 top-1/2 -translate-y-1/2"
                          aria-label={t(
                            showKey ? 'layout.hideKey' : 'layout.showKey'
                          )}
                        >
                          {showKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleTest}
                        disabled={disabled || testing}
                      >
                        {testing ? (
                          <Loader2 className="me-2 h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="me-2 h-4 w-4" />
                        )}
                        {t('testKey')}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div
              id="agent-setup-behaviour"
              hidden={section !== 'behaviour'}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('behaviour')}</CardTitle>
                  <CardDescription>{t('behaviourDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="ai-company-facts">
                      {locale === 'ar'
                        ? 'معلومات الشركة المؤكدة'
                        : 'Confirmed company facts'}
                    </Label>
                    <Textarea
                      id="ai-company-facts"
                      dir="auto"
                      value={companyFacts}
                      onChange={(e) => setCompanyFacts(e.target.value)}
                      maxLength={12000}
                      rows={5}
                      disabled={disabled}
                    />
                    <p className="text-muted-foreground text-xs">
                      {locale === 'ar'
                        ? 'اكتب العنوان ووسائل التواصل والخدمات والسياسات المؤكدة. خلي تعليمات الأسلوب في الحقل التالي، ومواصفات وأسعار المنتجات في الكتالوج.'
                        : 'Use this for confirmed contact details, services and policies. Keep writing instructions below, and product specifications and prices in the catalog.'}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="ai-improved-replies">
                      {locale === 'ar'
                        ? 'ردود محسّنة ومراجعة قبل التحويل'
                        : 'Improved replies and recovery before transfer'}
                    </Label>
                    <Switch
                      id="ai-improved-replies"
                      checked={behaviorV2Enabled}
                      onCheckedChange={setBehaviorV2Enabled}
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-prompt">
                      {locale === 'ar'
                        ? 'طريقة الرد وتعليمات العمل'
                        : 'Reply style and business instructions'}
                    </Label>
                    <Textarea
                      id="ai-prompt"
                      dir="auto"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder={t('promptPlaceholder')}
                      rows={8}
                      disabled={disabled}
                    />
                  </div>

                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('enableAssistant')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('enableAssistantDesc')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('enableAssistant')}
                      checked={isActive}
                      onCheckedChange={setIsActive}
                      disabled={disabled}
                    />
                  </div>

                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('autoReply')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('autoReplyDesc')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('autoReply')}
                      checked={autoReplyEnabled}
                      onCheckedChange={setAutoReplyEnabled}
                      disabled={disabled || !isActive}
                    />
                  </div>

                  <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                    <div>
                      <Label htmlFor="ai-max">{t('maxAutoReplies')}</Label>
                      <p className="text-muted-foreground text-xs">
                        {t('maxAutoRepliesDesc')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-muted-foreground flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={unlimitedReplies}
                          onChange={(e) =>
                            setUnlimitedReplies(e.target.checked)
                          }
                          disabled={disabled || !autoReplyEnabled}
                        />
                        {t('layout.unlimited')}
                      </label>
                      <Input
                        id="ai-max"
                        type="number"
                        min={1}
                        value={maxPerConversation}
                        onChange={(e) =>
                          setMaxPerConversation(
                            Math.max(1, Number(e.target.value) || 1)
                          )
                        }
                        disabled={
                          disabled || !autoReplyEnabled || unlimitedReplies
                        }
                        className="w-20"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ai-handoff">{t('handoffTo')}</Label>
                    <p className="text-muted-foreground text-xs">
                      {t('handoffToDesc')}
                    </p>
                    <Select
                      items={[
                        { value: HANDOFF_QUEUE, label: t('handoffQueue') },
                        ...members.map((m) => ({
                          value: m.user_id,
                          label: memberLabel(m),
                        })),
                      ]}
                      value={handoffAgentId || HANDOFF_QUEUE}
                      onValueChange={(v) =>
                        setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)
                      }
                      disabled={disabled || !autoReplyEnabled}
                    >
                      <SelectTrigger id="ai-handoff" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        <SelectItem value={HANDOFF_QUEUE}>
                          {t('handoffQueue')}
                        </SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.user_id} value={m.user_id}>
                            {memberLabel(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div
              id="agent-setup-knowledge"
              hidden={section !== 'knowledge'}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle>{t('embeddingsKey')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor="ai-embeddings-key">
                      {t('embeddingsKey')}{' '}
                      <span className="text-muted-foreground font-normal">
                        {t('optionalSemanticSearch')}
                      </span>
                    </Label>
                    <Input
                      id="ai-embeddings-key"
                      type="password"
                      value={embeddingsKey}
                      onChange={(e) => {
                        setEmbeddingsKey(e.target.value);
                        setEmbeddingsKeyEdited(true);
                      }}
                      onFocus={() => {
                        if (!embeddingsKeyEdited && hasStoredEmbeddingsKey) {
                          setEmbeddingsKey('');
                          setEmbeddingsKeyEdited(true);
                        }
                      }}
                      placeholder="sk-... (OpenAI)"
                      disabled={disabled}
                      autoComplete="off"
                    />
                    <p className="text-muted-foreground text-xs">
                      {t('embeddingsHint', {
                        sameKeyText:
                          provider === 'openai' ? t('sameKeyText') : '',
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <ProductCatalogPanel />

              <SocialLinksCard />
            </div>
            <div
              id="agent-setup-capabilities"
              hidden={section !== 'capabilities'}
              className="space-y-6"
            >
              <Card>
                <CardContent className="space-y-6 pt-2">
                  <div className="space-y-2">
                    <Label>
                      {t('imageAnalysisKey')}{' '}
                      <span className="text-muted-foreground font-normal">
                        {t('optionalImageAnalysis')}
                      </span>
                    </Label>
                    <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                      <Select
                        items={['openai', 'gemini'].map((value) => ({
                          value,
                          label: PROVIDER_LABEL[value as AiProvider],
                        }))}
                        value={imageAnalysisProvider}
                        onValueChange={(v) =>
                          setImageAnalysisProvider(v as 'openai' | 'gemini')
                        }
                        disabled={disabled}
                      >
                        <SelectTrigger className="sm:w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          align="start"
                          alignItemWithTrigger={false}
                        >
                          <SelectItem value="openai">
                            {PROVIDER_LABEL.openai}
                          </SelectItem>
                          <SelectItem value="gemini">
                            {PROVIDER_LABEL.gemini}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        id="ai-image-analysis-key"
                        type="password"
                        value={imageAnalysisKey}
                        onChange={(e) => {
                          setImageAnalysisKey(e.target.value);
                          setImageAnalysisKeyEdited(true);
                        }}
                        onFocus={() => {
                          if (
                            !imageAnalysisKeyEdited &&
                            hasStoredImageAnalysisKey
                          ) {
                            setImageAnalysisKey('');
                            setImageAnalysisKeyEdited(true);
                          }
                        }}
                        placeholder={KEY_PLACEHOLDER[imageAnalysisProvider]}
                        disabled={disabled}
                        autoComplete="off"
                      />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {t('imageAnalysisHint')}
                    </p>
                  </div>
                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('transcribeVoice')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {hasStoredEmbeddingsKey
                          ? t('transcribeVoiceDesc')
                          : t('transcribeVoiceNeedsKey')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('transcribeVoice')}
                      checked={transcribeVoiceMessages}
                      onCheckedChange={setTranscribeVoiceMessages}
                      disabled={disabled || !hasStoredEmbeddingsKey}
                    />
                  </div>
                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('analyzeImages')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {hasStoredImageAnalysisKey
                          ? t('analyzeImagesDesc')
                          : t('analyzeImagesNeedsKey')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('analyzeImages')}
                      checked={imageAnalysisEnabled}
                      onCheckedChange={setImageAnalysisEnabled}
                      disabled={disabled || !hasStoredImageAnalysisKey}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div
              id="agent-setup-schedule"
              hidden={section !== 'schedule'}
              className="space-y-6"
            >
              <Card>
                <CardContent className="space-y-2 pt-2">
                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('afterHoursTakeover')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('afterHoursTakeoverDesc')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('afterHoursTakeover')}
                      checked={afterHoursTakeoverEnabled}
                      onCheckedChange={setAfterHoursTakeoverEnabled}
                      disabled={disabled || !autoReplyEnabled}
                    />
                  </div>
                  <div className="border-border flex items-center justify-between gap-6 border-b py-5 last:border-b-0">
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {t('pauseDuringBusinessHours')}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('pauseDuringBusinessHoursDesc')}
                      </p>
                    </div>
                    <Switch
                      aria-label={t('pauseDuringBusinessHours')}
                      checked={pauseDuringBusinessHours}
                      onCheckedChange={setPauseDuringBusinessHours}
                      disabled={disabled || !autoReplyEnabled}
                    />
                  </div>
                </CardContent>
              </Card>
              <BusinessHoursCard />
            </div>
            <div id="agent-setup-assistance" hidden={section !== 'assistance'}>
              <SalesAssistanceSettings />
            </div>
          </div>
        </div>
        <div className="crm-agent-savebar">
          <p className="text-muted-foreground max-w-[55ch] text-xs leading-relaxed">
            {t('layout.saveHint')}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {configured ? (
              <Button
                variant="ghost"
                onClick={handleRemove}
                disabled={!canEdit || removing}
                className="text-destructive hover:text-destructive"
              >
                {removing ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="me-2 h-4 w-4" />
                )}
                {t('remove')}
              </Button>
            ) : (
              <span />
            )}

            <Button onClick={handleSave} disabled={disabled}>
              {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
          </div>
        </div>
      </div>
    </DirectionProvider>
  );
}
