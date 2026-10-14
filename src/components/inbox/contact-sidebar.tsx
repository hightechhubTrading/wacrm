'use client';

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { CustomFieldGroupFields } from '@/components/custom-fields/custom-field-group-fields';
import { cn } from '@/lib/utils';
import { sharedLocation } from '@/lib/inbox/shared-location';
import type {
  Contact,
  Conversation,
  Deal,
  ContactNote,
  Tag,
  Message,
} from '@/types';
import { DealSalesPanel } from './sales-workspace';
import { ConversionStages } from '@/components/inbox/conversion-stages';
import {
  FileText,
  Image as ImageIcon,
  Video,
  Mic,
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  BriefcaseBusiness,
  LayoutDashboard,
  MapPin,
  ArrowUpRight,
  ChevronRight,
  Layers,
  StickyNote,
  Plus,
  X,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

interface ContactSidebarProps {
  contact: Contact | null;
  sharedMessages?: Message[];
  onOpenSharedMessage?: (id: string) => void;
  /** Bumped by the inbox page whenever a new message lands on the
   *  active conversation — the trigger to refetch deals (and their
   *  order-info fields), since the AI bot may have just written to
   *  them. No dedicated realtime channel on `deals` exists anywhere
   *  in the app, so this piggybacks on the inbox's existing
   *  message-event handling instead of adding a first one. */
  refreshToken?: number;
  /** Active conversation -- drives the CTWA lead-stage chips. */
  conversation?: Conversation | null;
}

export function ContactSidebar({
  contact,
  sharedMessages = [],
  onOpenSharedMessage,
  conversation,
  refreshToken,
}: ContactSidebarProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  const tDealStatus = useTranslations('Inbox.sales.dealStatuses');
  const locale = useLocale();
  const tThread = useTranslations('Inbox.messageThread');

  const { accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const [salesDealId, setSalesDealId] = useState('');
  const [section, setSection] = useState('overview');
  const [copied, setCopied] = useState(false);
  const [copiedMapUrl, setCopiedMapUrl] = useState<string | null>(null);
  const mapCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (mapCopyTimer.current) clearTimeout(mapCopyTimer.current);
    },
    []
  );
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const fetchSequence = useRef(0);
  const loadedContact = useRef<string | null>(null);
  const fetchContactData = useCallback(async () => {
    const sequence = ++fetchSequence.current;
    if (loadedContact.current !== (contact?.id ?? null)) {
      loadedContact.current = contact?.id ?? null;
      setSalesDealId('');
      setSection('overview');
      setNewNote('');
      setDeals([]);
      setNotes([]);
      setTags([]);
    }
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from('deals')
        .select(
          '*, stage:pipeline_stages(*), assignee:profiles!deals_assigned_to_fkey(full_name)'
        )
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
    ]);

    if (sequence !== fetchSequence.current) return;
    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact, setSalesDealId, setSection, setNewNote]);

  // Load on contact change, and whenever refreshToken bumps (a new
  // message just landed on this conversation — see prop doc above).
  // setContactData/setTags run inside async Supabase callbacks, not
  // synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData, refreshToken]);

  useEffect(() => {
    const refresh = () => void fetchContactData();
    window.addEventListener('sales-assistance-updated', refresh);
    return () =>
      window.removeEventListener('sales-assistance-updated', refresh);
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleRemoveTag = useCallback(
    async (tag: Tag & { contact_tag_id: string }) => {
      if (!contact) return;
      const res = await fetch(`/api/contacts/${contact.id}/tags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      if (!res.ok) {
        toast.error(tSidebar('toastTagRemoveFailed'));
        return;
      }
      setTags((prev) =>
        prev.filter((t) => t.contact_tag_id !== tag.contact_tag_id)
      );
    },
    [contact, tSidebar]
  );

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from('contact_notes')
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote('');
    }
    setAddingNote(false);
  }, [contact, newNote, accountId, setNewNote, setAddingNote]);

  if (!contact) {
    return (
      <div className="crm-contact-panel border-border bg-card flex h-full w-70 items-center justify-center border-s">
        <p className="text-muted-foreground text-sm">
          {tThread('selectConversation')}
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  const locationMessage = [...sharedMessages]
    .reverse()
    .find(
      (m) =>
        m.sender_type === 'customer' &&
        m.content_type === 'location' &&
        sharedLocation(m.content_text)
    );
  const location = locationMessage
    ? sharedLocation(locationMessage.content_text)
    : null;
  const currentDeal = deals.find((deal) => deal.status === 'open') ?? deals[0];

  const copyLocation = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedMapUrl(url);
      if (mapCopyTimer.current) clearTimeout(mapCopyTimer.current);
      mapCopyTimer.current = setTimeout(() => setCopiedMapUrl(null), 2000);
    } catch {
      toast.error(tSidebar('copyMapFailed'));
    }
  };

  const openSharedMessage = (id: string) => {
    if (onOpenSharedMessage) {
      onOpenSharedMessage(id);
      return;
    }
    const element = document.getElementById(`message-${id}`);
    element?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
    element?.focus({ preventScroll: true });
  };

  const mediaMessages = sharedMessages.filter((m) =>
    ['image', 'video', 'audio', 'document'].includes(m.content_type)
  );
  const renderFiles = (limit: number) => (
    <div className="crm-file-list">
      {sharedMessages
        .filter((m) =>
          ['image', 'video', 'audio', 'document'].includes(m.content_type)
        )
        .slice(-limit)
        .reverse()
        .map((message) => {
          const Icon =
            message.content_type === 'image'
              ? ImageIcon
              : message.content_type === 'video'
                ? Video
                : message.content_type === 'audio'
                  ? Mic
                  : FileText;
          const label =
            message.content_type === 'document' && message.content_text
              ? message.content_text
              : tSidebar(
                  message.content_type === 'image'
                    ? 'mediaImage'
                    : message.content_type === 'video'
                      ? 'mediaVideo'
                      : message.content_type === 'audio'
                        ? 'mediaAudio'
                        : 'mediaDocument'
                );
          return (
            <button
              key={message.id}
              title={tSidebar('viewSharedMessage')}
              onClick={() => {
                if (onOpenSharedMessage) {
                  onOpenSharedMessage(message.id);
                  return;
                }
                const element = document.getElementById(
                  `message-${message.id}`
                );
                element?.scrollIntoView({
                  block: 'center',
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)'
                  ).matches
                    ? 'instant'
                    : 'smooth',
                });
                element?.focus({ preventScroll: true });
              }}
            >
              <span className="crm-file-icon">
                <Icon aria-hidden />
              </span>
              <span>
                <strong dir="auto">{label}</strong>
                <small>
                  {new Intl.DateTimeFormat(locale, {
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date(message.created_at))}
                </small>
              </span>
            </button>
          );
        })}
    </div>
  );
  return (
    <aside
      className="crm-contact-panel crm-customer-inspector flex h-full flex-col"
      aria-label={tSidebar('contactInfo')}
    >
      <header className="crm-customer-header">
        <div className="crm-customer-portrait" aria-hidden="true">
          {contact.avatar_url ? (
            <img src={contact.avatar_url} alt="" />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0">
          <h3 dir="auto">{displayName}</h3>
          {contact.company && <p dir="auto">{contact.company}</p>}
          {contact.opted_out && (
            <Badge data-tone="amber" className="crm-customer-optout mt-2">
              {tSidebar('optedOutBadge')}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopyPhone}
          className="crm-customer-phone"
          aria-label={tSidebar('copyPhone')}
        >
          <Phone size={15} aria-hidden />
          <span dir="ltr">{contact.phone}</span>
          {copied ? (
            <Check size={14} aria-hidden />
          ) : (
            <Copy size={14} aria-hidden />
          )}
        </button>
        {contact.email && (
          <div className="crm-customer-email">
            <Mail size={14} aria-hidden />
            <span dir="ltr">{contact.email}</span>
          </div>
        )}
      </header>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <Tabs
          value={section}
          onValueChange={(value) => setSection(String(value))}
          className="crm-customer-tabs flex min-h-0 flex-1 flex-col"
        >
          <TabsList
            className="crm-customer-tab-list"
            aria-label={tSidebar('sections')}
          >
            <TabsTrigger value="overview">
              <LayoutDashboard aria-hidden />
              <span>{tSidebar('overview')}</span>
            </TabsTrigger>
            <TabsTrigger value="sales" data-tone="blue">
              <BriefcaseBusiness aria-hidden />
              <span>{tSidebar('salesTab')}</span>
            </TabsTrigger>
            <TabsTrigger value="files" data-tone="teal">
              <FileText aria-hidden />
              <span>{tSidebar('filesTab')}</span>
            </TabsTrigger>
            <TabsTrigger value="notes" data-tone="amber">
              <StickyNote aria-hidden />
              <span>{tSidebar('notes')}</span>
            </TabsTrigger>
          </TabsList>
          <ScrollArea key={section} className="min-h-0 flex-1">
            <div className="crm-contact-body">
              <TabsContent
                value="overview"
                className="crm-customer-tab-content"
              >
                {location && locationMessage && (
                  <section
                    className="crm-customer-section crm-customer-location"
                    data-tone="green"
                  >
                    <div className="crm-customer-section-title">
                      <MapPin size={18} aria-hidden />
                      <h4>{tSidebar('sharedLocation')}</h4>
                    </div>
                    <p className="crm-customer-hint">
                      {tSidebar('locationFromCustomer')}
                    </p>
                    {location.label && (
                      <p dir="auto" className="crm-location-label">
                        {location.label}
                      </p>
                    )}
                    <div className="crm-location-actions">
                      <a
                        href={location.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="crm-location-link"
                      >
                        {tSidebar('openMap')}
                        <ArrowUpRight size={16} aria-hidden />
                      </a>
                      <button
                        type="button"
                        className="crm-location-copy"
                        onClick={() => void copyLocation(location.url)}
                        aria-label={tSidebar('copyMap')}
                        title={tSidebar('copyMap')}
                      >
                        {copiedMapUrl === location.url ? (
                          <Check size={16} aria-hidden />
                        ) : (
                          <Copy size={16} aria-hidden />
                        )}
                        <span aria-live="polite">
                          {tSidebar(
                            copiedMapUrl === location.url
                              ? 'mapCopied'
                              : 'copyMap'
                          )}
                        </span>
                      </button>
                    </div>
                    <button
                      type="button"
                      className="crm-location-source"
                      onClick={() => openSharedMessage(locationMessage.id)}
                    >
                      {tSidebar('viewLocationMessage')}
                    </button>
                  </section>
                )}
                <section className="crm-customer-section" data-tone="blue">
                  <div className="crm-customer-section-title">
                    <BriefcaseBusiness size={17} aria-hidden />
                    <h4>{tSidebar('salesSnapshot')}</h4>
                  </div>
                  {currentDeal ? (
                    <div className="crm-customer-deal-list">
                      {[currentDeal].map((deal) => (
                        <button
                          type="button"
                          key={deal.id}
                          onClick={() => {
                            setSalesDealId(deal.id);
                            setSection('sales');
                          }}
                        >
                          <div>
                            <strong dir="auto">{deal.title}</strong>
                            <span>
                              {deal.stage?.name ??
                                tDealStatus(deal.status ?? 'unknown')}
                            </span>
                          </div>
                          <b dir="auto">
                            {deal.value.toLocaleString(locale)} {deal.currency}
                          </b>
                          <ChevronRight
                            size={15}
                            className="rtl:rotate-180"
                            aria-hidden
                          />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="crm-customer-hint">{tSidebar('noDeals')}</p>
                  )}
                  <Button
                    variant="outline"
                    className="crm-open-sales"
                    onClick={() => setSection('sales')}
                  >
                    <BriefcaseBusiness size={16} aria-hidden />
                    {tSidebar('openSales')}
                    <ChevronRight
                      size={15}
                      className="ms-auto rtl:rotate-180"
                      aria-hidden
                    />
                  </Button>
                </section>
                {/* Tags */}
                <details
                  key={`tags-${contact.id}`}
                  className="crm-customer-section crm-customer-fields"
                  data-tone="violet"
                >
                  <summary>
                    <TagIcon size={17} aria-hidden />
                    {tSidebar('tags')}
                    <span className="text-muted-foreground ms-auto text-xs">
                      {tags.length}
                    </span>
                  </summary>
                  <div className="mt-3 flex items-center justify-between px-1">
                    <div className="text-muted-foreground flex items-center gap-2 text-sm font-semibold">
                      <TagIcon className="h-3 w-3" />
                      {tSidebar('tags')}
                    </div>
                    <TagPicker
                      contactId={contact.id}
                      appliedTags={tags}
                      onChanged={fetchContactData}
                      t={tSidebar}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {tags.length === 0 ? (
                      <p className="text-muted-foreground px-1 text-xs">
                        {tSidebar('noTags')}
                      </p>
                    ) : (
                      tags.map((tag) => (
                        <span
                          key={tag.contact_tag_id}
                          className="crm-customer-tag group inline-flex items-center gap-1"
                          style={{
                            borderInlineStartColor: tag.color,
                          }}
                        >
                          {tag.name}
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(tag)}
                            aria-label={tSidebar('removeTagAria', {
                              name: tag.name,
                            })}
                            className="rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </details>
                <details
                  key={`fields-${contact.id}`}
                  className="crm-customer-section crm-customer-fields"
                  data-tone="violet"
                >
                  <summary>
                    <Layers size={17} aria-hidden />
                    {tSidebar('customerFields')}
                  </summary>
                  <p className="crm-customer-hint mt-3">
                    {tSidebar('fieldsHint')}
                  </p>
                  <CustomFieldGroupFields
                    scope="contact"
                    recordId={contact.id}
                    editable={canEdit}
                    onSaved={fetchContactData}
                  />
                </details>
              </TabsContent>
              <TabsContent value="sales" className="crm-customer-tab-content">
                <DealSalesPanel
                  key={contact.id}
                  deals={deals}
                  contactId={contact.id}
                  selectedDealId={salesDealId}
                  onSelectDeal={setSalesDealId}
                />
                {!canEdit &&
                  deals.map((deal) => (
                    <details
                      key={deal.id}
                      className="crm-customer-section crm-customer-fields"
                      data-tone="blue"
                    >
                      <summary>
                        <BriefcaseBusiness size={17} aria-hidden />
                        <span dir="auto">{deal.title}</span>
                      </summary>
                      <CustomFieldGroupFields
                        scope="deal"
                        recordId={deal.id}
                        editable={false}
                      />
                      {deal.notes && (
                        <p dir="auto" className="crm-customer-hint">
                          {deal.notes}
                        </p>
                      )}
                    </details>
                  ))}
                {conversation && (
                  <section
                    className="crm-customer-section crm-customer-progress"
                    data-tone="green"
                  >
                    <ConversionStages
                      conversation={conversation}
                      refreshToken={refreshToken}
                    />
                  </section>
                )}
              </TabsContent>
              <TabsContent value="files" className="crm-customer-tab-content">
                <section
                  className="crm-customer-section crm-shared-files"
                  data-tone="teal"
                >
                  <div className="crm-customer-section-title">
                    <FileText size={17} aria-hidden />
                    <h4>{tSidebar('sharedFiles')}</h4>
                    <span>{mediaMessages.length}</span>
                  </div>
                  {mediaMessages.length ? (
                    renderFiles(6)
                  ) : (
                    <p className="crm-customer-hint">
                      {tSidebar('noSharedFiles')}
                    </p>
                  )}
                </section>
              </TabsContent>
              <TabsContent value="notes" className="crm-customer-tab-content">
                {/* Notes */}
                <section
                  className="crm-customer-section crm-customer-notes"
                  data-tone="amber"
                >
                  <div className="text-muted-foreground flex items-center gap-2 px-1 text-sm font-semibold">
                    <StickyNote className="h-3 w-3" />
                    {tSidebar('notes')}
                  </div>
                  <div className="mt-2">
                    <div className="crm-note-compose">
                      <textarea
                        aria-label={tSidebar('addNotePlaceholder')}
                        dir="auto"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={tSidebar('addNotePlaceholder')}
                        rows={2}
                        className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-lg border px-3 py-2 text-xs outline-none"
                      />
                      <Button
                        size="sm"
                        aria-label={tSidebar('saveNote')}
                        className="bg-primary hover:bg-primary/90 h-auto px-2"
                        onClick={handleAddNote}
                        disabled={!newNote.trim() || addingNote}
                      >
                        <Plus className="h-4 w-4" />
                        {tSidebar('saveNote')}
                      </Button>
                    </div>

                    <div className="mt-2 space-y-2">
                      {notes.map((note) => (
                        <div
                          key={note.id}
                          className={cn(
                            'rounded-lg px-3 py-2',
                            note.is_ai_generated ? 'bg-primary/5' : 'bg-muted'
                          )}
                        >
                          <p
                            dir="auto"
                            className="text-foreground text-sm whitespace-pre-wrap"
                          >
                            {note.note_text}
                          </p>
                          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[10px]">
                            {note.is_ai_generated && (
                              <Sparkles className="h-2.5 w-2.5" />
                            )}
                            {new Intl.DateTimeFormat(locale, {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            }).format(new Date(note.created_at))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
                {!notes.length && (
                  <p className="crm-customer-hint">{tSidebar('noNotes')}</p>
                )}
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DirectionProvider>
    </aside>
  );
}

/**
 * "+" popover next to the Tags header — pick any existing account tag
 * (toggle to add/remove) and, for admins, create a brand-new one
 * inline. Tag CREATION requires admin+ (tags_insert RLS, migration
 * 017); ASSIGNING an existing tag to a contact only requires agent+
 * (contact_tags_modify) — both routes already exist and are reused
 * here (`POST`/`DELETE /api/contacts/[id]/tags`) rather than writing
 * straight to the table, so the `tag_added` automation trigger still
 * fires correctly.
 */
function TagPicker({
  contactId,
  appliedTags,
  onChanged,
  t,
}: {
  contactId: string;
  appliedTags: (Tag & { contact_tag_id: string })[];
  onChanged: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
}) {
  const { user, accountId, canEditSettings } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accountTags, setAccountTags] = useState<Tag[]>([]);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [creating, setCreating] = useState(false);

  // Fetch the account's full tag catalogue only when the popover opens
  // — this list is account-wide (not per-contact), so there's no
  // reason to load it until the picker is actually used.
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('tags')
        .select('*')
        .eq('account_id', accountId)
        .order('name');
      if (!cancelled) {
        setAccountTags((data as Tag[] | null) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const appliedIds = new Set(appliedTags.map((tag) => tag.id));

  async function toggleTag(tagId: string, applied: boolean) {
    setBusyTagId(tagId);
    const res = await fetch(`/api/contacts/${contactId}/tags`, {
      method: applied ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: tagId }),
    });
    setBusyTagId(null);
    if (!res.ok) {
      toast.error(applied ? t('toastTagRemoveFailed') : t('toastTagAddFailed'));
      return;
    }
    onChanged();
  }

  async function handleCreateAndAssign() {
    const name = newTagName.trim();
    if (!name || !user || !accountId) return;
    setCreating(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('tags')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name,
        // A calm default; admins can recolor it later from Settings →
        // Fields & tags, which already owns full tag management.
        color: '#3b82f6',
      })
      .select()
      .single();
    setCreating(false);
    if (error || !data) {
      toast.error(t('toastTagCreateFailed'));
      return;
    }
    setAccountTags((prev) => [...prev, data as Tag]);
    setNewTagName('');
    await toggleTag((data as Tag).id, false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title={t('addTagsTitle')}
            className="text-muted-foreground hover:text-foreground"
          />
        }
      >
        <Plus className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <p className="text-foreground text-xs font-medium">
          {t('addTagsTitle')}
        </p>
        <div className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
            </div>
          ) : accountTags.length === 0 ? (
            <p className="text-muted-foreground px-1 py-1 text-xs">
              {t('noAccountTags')}
            </p>
          ) : (
            accountTags.map((tag) => {
              const applied = appliedIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={busyTagId === tag.id}
                  onClick={() => toggleTag(tag.id, applied)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded px-1.5 py-1 text-start text-xs disabled:opacity-50"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-foreground flex-1 truncate">
                    {tag.name}
                  </span>
                  {busyTagId === tag.id ? (
                    <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
                  ) : (
                    applied && (
                      <Check className="text-primary h-3 w-3 shrink-0" />
                    )
                  )}
                </button>
              );
            })
          )}
        </div>
        {canEditSettings && (
          <div className="border-border mt-2 flex gap-1 border-t pt-2">
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder={t('newTagPlaceholder')}
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateAndAssign();
              }}
              className="border-border bg-muted text-foreground focus:border-primary h-7 flex-1 rounded border px-2 text-xs outline-none"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2"
              disabled={!newTagName.trim() || creating}
              onClick={handleCreateAndAssign}
            >
              {creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
