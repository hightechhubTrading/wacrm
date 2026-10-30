'use client';
import { ConversationDraftBadge } from './conversation-draft-badge';

import { DirectionProvider } from '@base-ui/react/direction-provider';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useInboxList } from '@/hooks/use-inbox-list';
import { useInboxQuery } from '@/hooks/use-inbox-query';
import { SavedViews } from './saved-views';
import { MessageSearch } from './message-search';
import type { InboxView, InboxSort } from '@/lib/inbox/query-state';
import { useCan } from '@/hooks/use-can';
import { SALES_VIEWS, type SalesView } from '@/lib/inbox/sales-context';
import { TRIAGE_GROUPS, sortTriage, triageGroup } from '@/lib/inbox/triage';
import { ar, enUS } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Conversation, ConversationStatus, Tag, Profile } from '@/types';
import {
  Search,
  ChevronDown,
  X,
  Flame,
  ArrowUpCircle,
  Megaphone,
  Inbox,
  Mail,
  UserRound,
  SlidersHorizontal,
  Tag as TagIcon,
  Building2,
  ArrowDownUp,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { VirtualConversationList } from './virtual-conversation-list';

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  onPrefetch?: (conversation: Conversation | null) => void;
  onOpenMessage?: (
    conversationId: string,
    messageId: string
  ) => Promise<boolean>;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: 'bg-info',
  pending: 'bg-warning',
  closed: 'bg-success',
};

type InboxFilter = InboxView;

/** Sentinel for the "no assigned agent" filter option, distinct from
 *  any real `profiles.user_id`. */
const UNASSIGNED_AGENT = '__unassigned__';

export function ConversationList({
  activeConversationId,
  onSelect,
  onPrefetch,
  onOpenMessage,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');
  const locale = useLocale();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canReadSales = useCan('send-messages');
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      ...(canReadSales
        ? SALES_VIEWS.map((value) => ({
            label: t(`salesViews.${value}`),
            value,
          }))
        : []),
      { label: t('filterAll'), value: 'all' },
      { label: t('filterUnread'), value: 'unread' },
      { label: t('mine'), value: 'mine' },
      { label: t('groups.priority'), value: 'priority' },
      { label: t('unassigned'), value: 'unassigned' },
      { label: t('filterOpen'), value: 'open' },
      { label: t('filterPending'), value: 'pending' },
      { label: t('filterClosed'), value: 'closed' },
    ],
    [t, canReadSales]
  );

  const { query, update: updateQuery } = useInboxQuery(canReadSales);
  const {
    search,
    view: filter,
    sort,
    tags: selectedTagIds,
    company: selectedCompany,
    agent: selectedAgentId,
  } = query;
  const setSearch = useCallback(
    (value: string) => updateQuery({ search: value }, 'replace'),
    [updateQuery]
  );
  const setFilter = useCallback(
    (view: InboxFilter) => updateQuery({ view }),
    [updateQuery]
  );
  const setSort = useCallback(
    (sort: InboxSort) => updateQuery({ sort }),
    [updateQuery]
  );
  const setSelectedTagIds = useCallback(
    (value: string[] | ((previous: string[]) => string[])) =>
      updateQuery((previous) => ({
        ...previous,
        tags: typeof value === 'function' ? value(previous.tags) : value,
      })),
    [updateQuery]
  );
  const setSelectedCompany = useCallback(
    (company: string | null) => updateQuery({ company }),
    [updateQuery]
  );
  const setSelectedAgentId = useCallback(
    (agent: string | null) => updateQuery({ agent }),
    [updateQuery]
  );

  const [retry, setRetry] = useState(0);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // null = no filter, 'unassigned' = the explicit unassigned bucket, or a profile's user_id.

  const remote = useInboxList(
    {
      search: search.trim(),
      view: filter,
      sort,
      tags: selectedTagIds,
      company: selectedCompany,
      agent: selectedAgentId,
    },
    resyncToken + retry,
    onConversationsLoaded
  );
  const loading = remote.loading;
  const fetchError = remote.error;

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Member names for the "assigned agent" filter picker — RLS already
  // scopes this to the caller's own account (mirrors message-thread.tsx's
  // assignee-dropdown fetch).
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('full_name');
      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch profiles:', error);
        return;
      }
      setProfiles((data as Profile[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const companies = remote.companies;

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const profilesById = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const p of profiles) m.set(p.user_id, p);
    return m;
  }, [profiles]);

  const viewCounts = remote.counts;
  const filtered = conversations;
  const sections = useMemo(() => {
    if (sort === 'priority') {
      const ordered = sortTriage(filtered);
      return TRIAGE_GROUPS.map((group) => ({
        key: group,
        label: t(`groups.${group}`),
        items: ordered.filter((c) => triageGroup(c) === group),
      }));
    }
    const timestamp = (c: Conversation) => {
      const parsed = Date.parse(c.last_message_at ?? '');
      return Number.isFinite(parsed) ? parsed : 0;
    };
    return [
      {
        key: sort,
        label: t(`sorting.${sort}`),
        items: [...filtered].sort((a, b) =>
          sort === 'newest'
            ? timestamp(b) - timestamp(a)
            : timestamp(a) - timestamp(b)
        ),
      },
    ];
  }, [filtered, sort, t]);

  const toggleTag = useCallback(
    (id: string) => {
      setSelectedTagIds((prev) =>
        prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
      );
    },
    [setSelectedTagIds]
  );

  const hasContactFilters =
    selectedTagIds.length > 0 ||
    selectedCompany !== null ||
    selectedAgentId !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    [setSearch]
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);
  const advancedView = !['all', 'unread', 'mine'].includes(filter);
  const refinementCount =
    selectedTagIds.length +
    Number(selectedCompany !== null) +
    Number(selectedAgentId !== null) +
    Number(advancedView);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="crm-queue bg-card flex h-full w-full flex-col lg:w-80">
        {/* Search + Filter */}
        <div className="crm-queue-head space-y-2">
          <div className="crm-queue-identity">
            <span className="crm-queue-mark" aria-hidden="true">
              <Inbox size={21} />
            </span>
            <div>
              <h1 className="crm-queue-title">{t('inbox')}</h1>
              <p>{t('queueHint')}</p>
            </div>
            {!loading && (
              <span
                className="crm-queue-count"
                aria-label={t('visibleCount', { count: filtered.length })}
              >
                {filtered.length}
              </span>
            )}
          </div>
          <div className="crm-queue-search relative">
            <Search className="text-muted-foreground absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={handleSearchChange}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              maxLength={200}
              className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 ps-9 pe-9 text-sm"
            />
            {search && (
              <button
                type="button"
                aria-label={t('clearSearch')}
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </div>

          <MessageSearch
            activeConversationId={activeConversationId}
            onOpenMessage={onOpenMessage}
          />
          <SavedViews
            query={query}
            onApply={(view) => updateQuery(view)}
            canReadSales={canReadSales}
          />
          {SALES_VIEWS.includes(filter as SalesView) && (
            <p role="status" className="text-muted-foreground text-xs">
              {fetchError
                ? t('salesUnavailable')
                : loading
                  ? t('salesLoading')
                  : t('salesViewHint')}
            </p>
          )}
          <div className="crm-segment" role="group" aria-label={t('filters')}>
            {(['all', 'unread', 'mine'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? (
                  <Inbox size={15} aria-hidden />
                ) : value === 'unread' ? (
                  <Mail size={15} aria-hidden />
                ) : (
                  <UserRound size={15} aria-hidden />
                )}
                {value === 'mine'
                  ? t('mine')
                  : t(value === 'all' ? 'filterAll' : 'filterUnread')}
                <small className="tabular-nums">
                  {loading ? '–' : (viewCounts[value] ?? 0)}
                </small>
              </button>
            ))}
          </div>
          {canReadSales && (
            <div
              className="crm-queue-action-views"
              role="group"
              aria-label={t('actionQueues')}
            >
              {(['needs_reply', 'followup_today'] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  <span>{t(`salesViews.${value}`)}</span>
                  <strong
                    title={
                      remote.salesError ? t('salesUnavailable') : undefined
                    }
                  >
                    {loading || remote.salesLoading || remote.salesError
                      ? '–'
                      : (viewCounts[value] ?? 0)}
                  </strong>
                </button>
              ))}
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger className="crm-queue-sort">
              <ArrowDownUp size={14} aria-hidden />
              <span>{t(`sorting.${sort}`)}</span>
              <ChevronDown size={13} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-52">
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => setSort(value as typeof sort)}
              >
                {(['priority', 'newest', 'oldest'] as const).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {t(`sorting.${value}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <details className="crm-queue-filter-panel">
            <summary>
              <SlidersHorizontal size={16} aria-hidden />
              <span>{t('refine')}</span>
              {refinementCount > 0 && <b>{refinementCount}</b>}
              <ChevronDown
                size={15}
                className="crm-filter-chevron"
                aria-hidden
              />
            </summary>
            <div className="crm-queue-refinements">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="crm-filter-control"
                  data-applied={advancedView || undefined}
                  aria-label={`${t('view')}: ${activeFilter?.label ?? t('filterAll')}`}
                >
                  <SlidersHorizontal size={15} aria-hidden />
                  <span>{activeFilter?.label ?? t('view')}</span>
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="crm-view-menu border-border bg-popover"
                >
                  <DropdownMenuRadioGroup
                    value={filter}
                    onValueChange={(value) => setFilter(value as InboxFilter)}
                  >
                    {[
                      {
                        label: 'actionQueues',
                        values: ['priority', ...SALES_VIEWS],
                      },
                      {
                        label: 'ownership',
                        values: ['all', 'unread', 'mine', 'unassigned'],
                      },
                      {
                        label: 'conversationStatus',
                        values: ['open', 'pending', 'closed'],
                      },
                    ].map((group) => (
                      <DropdownMenuGroup key={group.label}>
                        <DropdownMenuLabel>{t(group.label)}</DropdownMenuLabel>
                        {FILTER_OPTIONS.filter((opt) =>
                          group.values.includes(opt.value)
                        ).map((opt) => (
                          <DropdownMenuRadioItem
                            key={opt.value}
                            value={opt.value}
                            className="crm-view-option"
                          >
                            <span>{opt.label}</span>
                            <small>
                              {loading ? '–' : (viewCounts[opt.value] ?? 0)}
                            </small>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuGroup>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              {tags.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      'crm-filter-control hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
                      selectedTagIds.length > 0
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    data-applied={selectedTagIds.length > 0 || undefined}
                  >
                    <TagIcon size={15} aria-hidden />
                    {t('tags')}
                    {selectedTagIds.length > 0 && (
                      <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                        {selectedTagIds.length}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="border-border bg-popover max-h-64 w-56"
                  >
                    {tags.map((t) => (
                      <DropdownMenuCheckboxItem
                        key={t.id}
                        checked={selectedTagIds.includes(t.id)}
                        onCheckedChange={() => toggleTag(t.id)}
                        className="text-popover-foreground text-sm"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          <span className="truncate">{t.name}</span>
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {companies.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      'crm-filter-control hover:bg-muted inline-flex h-7 max-w-40 items-center justify-center gap-1 rounded-md px-2 text-xs',
                      selectedCompany
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    data-applied={Boolean(selectedCompany) || undefined}
                  >
                    <Building2 size={15} aria-hidden />
                    <span className="truncate">
                      {selectedCompany ?? t('company')}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="border-border bg-popover max-h-64 w-56"
                  >
                    <DropdownMenuItem
                      onClick={() => setSelectedCompany(null)}
                      className={cn(
                        'text-sm',
                        selectedCompany === null
                          ? 'text-primary'
                          : 'text-popover-foreground'
                      )}
                    >
                      {t('allCompanies')}
                    </DropdownMenuItem>
                    {companies.map((co) => (
                      <DropdownMenuItem
                        key={co}
                        onClick={() => setSelectedCompany(co)}
                        className={cn(
                          'text-sm',
                          selectedCompany === co
                            ? 'text-primary'
                            : 'text-popover-foreground'
                        )}
                      >
                        <span className="truncate">{co}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {profiles.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className={cn(
                      'crm-filter-control hover:bg-muted inline-flex h-7 max-w-40 items-center justify-center gap-1 rounded-md px-2 text-xs',
                      selectedAgentId
                        ? 'text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    data-applied={Boolean(selectedAgentId) || undefined}
                  >
                    <UserRound size={15} aria-hidden />
                    <span className="truncate">
                      {selectedAgentId === UNASSIGNED_AGENT
                        ? t('unassigned')
                        : selectedAgentId
                          ? (profilesById.get(selectedAgentId)?.full_name ??
                            t('agent'))
                          : t('agent')}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="border-border bg-popover max-h-64 w-56"
                  >
                    <DropdownMenuItem
                      onClick={() => setSelectedAgentId(null)}
                      className={cn(
                        'text-sm',
                        selectedAgentId === null
                          ? 'text-primary'
                          : 'text-popover-foreground'
                      )}
                    >
                      {t('allAgents')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setSelectedAgentId(UNASSIGNED_AGENT)}
                      className={cn(
                        'text-sm',
                        selectedAgentId === UNASSIGNED_AGENT
                          ? 'text-primary'
                          : 'text-popover-foreground'
                      )}
                    >
                      {t('unassigned')}
                    </DropdownMenuItem>
                    {profiles.map((p) => (
                      <DropdownMenuItem
                        key={p.user_id}
                        onClick={() => setSelectedAgentId(p.user_id)}
                        className={cn(
                          'text-sm',
                          selectedAgentId === p.user_id
                            ? 'text-primary'
                            : 'text-popover-foreground'
                        )}
                      >
                        <span className="truncate">{p.full_name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </details>
          {(hasContactFilters || advancedView) && (
            <div className="crm-queue-filter-chips flex flex-wrap items-center gap-1">
              {advancedView && (
                <button type="button" onClick={() => setFilter('all')}>
                  <SlidersHorizontal size={12} aria-hidden />
                  {activeFilter?.label}
                  <X size={12} aria-hidden />
                </button>
              )}
              {selectedTagIds.map((id) => {
                const tag = tagsById.get(id);
                return (
                  <button
                    key={id}
                    onClick={() => toggleTag(id)}
                    className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          tag?.color ?? 'var(--muted-foreground)',
                      }}
                    />
                    <span className="max-w-24 truncate">
                      {tag?.name ?? t('tags')}
                    </span>
                    <X className="h-3 w-3" />
                  </button>
                );
              })}
              {selectedCompany && (
                <button
                  onClick={() => setSelectedCompany(null)}
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span className="max-w-24 truncate">{selectedCompany}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {selectedAgentId && (
                <button
                  onClick={() => setSelectedAgentId(null)}
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span className="max-w-24 truncate">
                    {selectedAgentId === UNASSIGNED_AGENT
                      ? t('unassigned')
                      : (profilesById.get(selectedAgentId)?.full_name ??
                        t('agent'))}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => {
                  updateQuery({
                    tags: [],
                    company: null,
                    agent: null,
                    view: 'all',
                  });
                }}
                className="text-muted-foreground hover:text-foreground px-1 text-[11px]"
              >
                {t('clearAll')}
              </button>
            </div>
          )}
        </div>

        {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
            </div>
          ) : fetchError ? (
            <div
              className="text-muted-foreground px-4 py-12 text-center text-sm"
              role="status"
            >
              {t('unavailable')}{' '}
              <button
                onClick={() => setRetry((r) => r + 1)}
                className="text-primary underline"
              >
                {t('retry')}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-muted-foreground text-sm">
                {t('noConversations')}
              </p>
              {(search || filter !== 'all' || hasContactFilters) && (
                <button
                  type="button"
                  className="text-primary mt-3 text-sm underline"
                  onClick={() => {
                    updateQuery({
                      search: '',
                      view: 'all',
                      tags: [],
                      company: null,
                      agent: null,
                    });
                  }}
                >
                  {t('clearAll')}
                </button>
              )}
            </div>
          ) : (
            <VirtualConversationList
              key={JSON.stringify([
                search,
                filter,
                selectedTagIds,
                selectedCompany,
                selectedAgentId,
                sort,
              ])}
              sections={sections}
              renderItem={(conv) => (
                <ConversationItem
                  conversation={conv}
                  isActive={conv.id === activeConversationId}
                  onSelect={handleSelect}
                  onPrefetch={onPrefetch}
                  t={t}
                  profilesById={profilesById}
                />
              )}
            />
          )}
          {!loading && !fetchError && remote.hasMore && (
            <button
              type="button"
              className="text-primary py-3 text-sm"
              disabled={remote.busy}
              onClick={remote.loadMore}
            >
              {t('loadMore')}
            </button>
          )}
        </div>
      </div>
    </DirectionProvider>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  onPrefetch?: (conversation: Conversation | null) => void;
  onOpenMessage?: (
    conversationId: string,
    messageId: string
  ) => Promise<boolean>;
  t: ReturnType<typeof useTranslations>;
  profilesById: Map<string, Profile>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onPrefetch,
  t,
  profilesById,
}: ConversationItemProps) {
  const locale = useLocale();
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = displayName.charAt(0).toUpperCase();
  const assignedAgent = conversation.assigned_agent_id
    ? profilesById.get(conversation.assigned_agent_id)
    : undefined;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
        locale: locale === 'ar' ? ar : enUS,
      })
    : '';

  return (
    <button
      aria-current={isActive ? 'true' : undefined}
      onPointerEnter={() => onPrefetch?.(conversation)}
      onPointerLeave={() => onPrefetch?.(null)}
      onFocus={() => onPrefetch?.(conversation)}
      onBlur={() => onPrefetch?.(null)}
      onClick={handleClick}
      className={cn(
        'crm-conversation hover:bg-muted/50 flex items-start gap-3 transition-colors',
        isActive && 'bg-muted/70'
      )}
    >
      {/* Avatar */}
      <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span className="text-foreground truncate text-sm font-medium">
              {displayName}
            </span>
            {conversation.ad_clicked_at && (
              <span
                title={
                  conversation.ad_headline ||
                  conversation.ad_source_id ||
                  t('fromAdBadge')
                }
                aria-label={t('fromAdBadge')}
                className="text-primary inline-flex shrink-0 items-center"
              >
                <Megaphone className="h-3 w-3" />
              </span>
            )}
            {conversation.ai_priority === 'urgent' && (
              <span title={t('aiPriorityUrgent')}>
                <Flame className="text-destructive h-3.5 w-3.5 shrink-0" />
              </span>
            )}
            {conversation.ai_priority === 'high' && (
              <span title={t('aiPriorityHigh')}>
                <ArrowUpCircle className="text-warning h-3.5 w-3.5 shrink-0" />
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {assignedAgent && (
              <span
                title={t('assignedTo', { name: assignedAgent.full_name ?? '' })}
                className="bg-muted text-muted-foreground flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold"
              >
                {(assignedAgent.full_name ?? '?').charAt(0).toUpperCase()}
              </span>
            )}
            <span className="text-muted-foreground text-[10px]">{timeAgo}</span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="text-muted-foreground truncate text-xs">
            <ConversationDraftBadge conversationId={conversation.id} />
            {conversation.last_message_text || t('noMessagesYet')}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
