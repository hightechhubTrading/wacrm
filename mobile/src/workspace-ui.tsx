import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ChevronLeft,
  Ellipsis,
  Inbox,
  LogOut,
  RefreshCw,
  Search,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { DeliveryStatus } from './delivery-status';
import { AttachmentButton, AttachmentViewer } from './attachment-viewer';
import { InlinePhoto, InlineVoice } from './inline-media';
import { ContactPhoto } from './contact-photo';
import { ReadStatus } from './read-status';
export type Conversation = {
  id: string;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count?: number;
  assigned_agent_id?: string | null;
  status?: string;
  contact: {
    id?: string;
    name: string | null;
    phone: string;
    avatar_url?: string | null;
  } | null;
};
export type Message = {
  id: string;
  sender_type: string;
  status: string | null;
  content_text: string | null;
  content_type: string;
  media_url?: string | null;
  created_at: string;
};
const zone = 'Asia/Qatar';
function date(value: string | null) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
function dayKey(value: string) {
  const d = date(value);
  return d
    ? new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(d)
    : 'unknown';
}
function dayLabel(value: string) {
  const d = date(value);
  if (!d) return 'Date unavailable';
  if (dayKey(value) === dayKey(new Date().toISOString())) return 'Today';
  return new Intl.DateTimeFormat('en', {
    timeZone: zone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}
function shortTime(value: string | null) {
  const d = date(value);
  return d
    ? new Intl.DateTimeFormat('en', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d)
    : '—';
}
function listTime(value: string | null) {
  const d = date(value);
  return d
    ? dayKey(value!) === dayKey(new Date().toISOString())
      ? shortTime(value)
      : new Intl.DateTimeFormat('en', {
          timeZone: zone,
          month: 'short',
          day: 'numeric',
        }).format(d)
    : '';
}
function fullTime(value: string | null) {
  const d = date(value);
  return d
    ? new Intl.DateTimeFormat('en', {
        timeZone: zone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d)
    : 'Time unavailable';
}
function language(value: string | null | undefined) {
  return /[\u0600-\u06ff]/.test(value ?? '') ? 'ar' : undefined;
}
function unread(c: Conversation) {
  return Math.max(0, c.unread_count ?? 0);
}
export function Avatar({ conversation }: { conversation: Conversation }) {
  const name = conversation.contact?.name?.trim();
  const initials = name
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map((n) => Array.from(n)[0])
        .join('')
        .toLocaleUpperCase()
    : null;
  const tone =
    Array.from(conversation.id).reduce((n, c) => n + c.charCodeAt(0), 0) % 3;
  return (
    <span className="person-avatar" data-tone={tone} aria-hidden="true">
      {initials ?? <UserRound size={20} />}
      <ContactPhoto src={conversation.contact?.avatar_url} />
    </span>
  );
}
export function WorkspaceHeader({
  active,
  rows,
  busy,
  onBack,
  onRefresh,
  onLogout,
  onContact,
  title = 'Chats',
}: {
  active: Conversation | null;
  rows: Conversation[];
  busy: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onContact?: () => void;
  title?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node))
        menu.current.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [active?.id]);
  return (
    <header className={`workspace-header ${active ? 'chat-header' : ''}`}>
      {active ? (
        <>
          <button
            className="icon-button"
            aria-label="Back to inbox"
            onClick={onBack}
          >
            <ChevronLeft size={30} />
          </button>
        </>
      ) : null}
      {active ? (
        <button
          className="contact-identity"
          aria-label="Contact details"
          onClick={onContact}
          disabled={!onContact}
        >
          <Avatar conversation={active} />
          <div className="header-identity">
            <h1 dir="auto" lang={language(active.contact?.name)}>
              {active.contact?.name || active.contact?.phone || 'Conversation'}
            </h1>
            <p>
              {active.contact?.name
                ? active.contact.phone
                : 'Customer conversation'}
            </p>
          </div>
        </button>
      ) : (
        <div className="header-identity">
          <span className="brand-word">HIGH TECH HUB</span>
          <h1>{title}</h1>
          <p className="sr">
            {rows.length
              ? `${rows.length} recent conversations`
              : 'Your customer conversations'}
          </p>
        </div>
      )}
      <div className="header-actions">
        <button
          className="icon-button"
          disabled={busy}
          aria-label="Refresh"
          onClick={onRefresh}
        >
          <RefreshCw size={19} />
        </button>
        <details className="account-menu" ref={menu}>
          <summary className="icon-button" aria-label="Chat options">
            <Ellipsis size={22} />
          </summary>
          <div className="account-actions">
            <button
              disabled={busy}
              onClick={() => {
                if (menu.current) menu.current.open = false;
                onLogout();
              }}
            >
              <LogOut size={17} aria-hidden="true" />
              Sign out
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}
export function ConnectionLine({ connection }: { connection: string }) {
  return (
    <p
      className="connection"
      data-offline={connection.startsWith('Offline')}
      data-connected={connection === 'Live updates connected'}
      aria-live="polite"
    >
      {connection.startsWith('Offline') ? (
        <WifiOff size={13} aria-hidden="true" />
      ) : (
        <Wifi size={13} aria-hidden="true" />
      )}
      <span>{connection}</span>
    </p>
  );
}
export function InboxView({
  rows,
  busy,
  error,
  userId,
  search,
  onSearch,
  onSelect,
  filter,
  onFilter,
  initialScroll,
  onScrollPosition,
}: {
  filter: string;
  onFilter: (value: string) => void;
  initialScroll: number;
  onScrollPosition: (value: number) => void;
  rows: Conversation[];
  busy: boolean;
  error: string;
  userId: string | null;
  search: string;
  onSearch: (s: string) => void;
  onSelect: (c: Conversation) => void;
}) {
  const setFilter = onFilter;
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollTop = initialScroll;
    });
    return () => cancelAnimationFrame(frame);
  }, [initialScroll]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [filter, search]);
  const filtered = rows.filter(
    (c) =>
      (filter !== 'unread' || unread(c) > 0) &&
      (filter !== 'mine' || c.assigned_agent_id === userId) &&
      `${c.contact?.name ?? ''} ${c.contact?.phone ?? ''} ${c.last_message_text ?? ''}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const unreadThreads = rows.filter((c) => unread(c) > 0).length;
  return (
    <section className="inbox-layout" aria-label="Conversations">
      <div className="inbox-controls">
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <label className="sr" htmlFor="inbox-search">
            Search loaded conversations
          </label>
          <input
            id="inbox-search"
            type="search"
            placeholder="Search chats"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => onSearch('')}
            >
              <X size={17} />
            </button>
          )}
        </div>
        <div className="filters" role="group" aria-label="Conversation filters">
          {[
            ['all', 'All'],
            ['unread', 'Unread'],
            ['mine', 'Assigned to me'],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              {key === 'unread' && unreadThreads > 0 && (
                <span className="filter-count">{unreadThreads}</span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div
        className="inbox-scroll"
        ref={scroll}
        onScroll={() => {
          if (scroll.current) onScrollPosition(scroll.current.scrollTop);
        }}
      >
        {busy && !rows.length ? (
          <div className="skeleton-list" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((n) => (
              <div className="skeleton-row" key={n}>
                <span />
                <div>
                  <i />
                  <i />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="list">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  className="conversation"
                  data-unread={unread(c) > 0}
                  onClick={() => onSelect(c)}
                >
                  <Avatar conversation={c} />
                  <span className="summary">
                    <strong dir="auto" lang={language(c.contact?.name)}>
                      {c.contact?.name || c.contact?.phone || 'Contact'}
                    </strong>
                    <span dir="auto" lang={language(c.last_message_text)}>
                      {c.last_message_text || 'No text preview'}
                    </span>
                  </span>
                  <span className="row-meta">
                    <time
                      dateTime={c.last_message_at ?? undefined}
                      title={fullTime(c.last_message_at)}
                    >
                      {listTime(c.last_message_at)}
                    </time>
                    {unread(c) > 0 && (
                      <span
                        className="unread-count"
                        aria-label={`${unread(c)} unread messages`}
                      >
                        {unread(c) > 99 ? '99+' : unread(c)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!busy && !error && !filtered.length && (
          <div className="empty-state">
            <Inbox size={32} strokeWidth={1.4} aria-hidden="true" />
            <h2>
              {search
                ? 'No matching conversations'
                : filter === 'unread'
                  ? 'You’re all caught up'
                  : filter === 'mine'
                    ? 'Nothing assigned to you'
                    : 'No conversations yet'}
            </h2>
            <p>
              {search
                ? 'Try a different name, phone number or message.'
                : filter !== 'all'
                  ? 'Choose All to see the rest of your loaded inbox.'
                  : 'Conversations you have access to will appear here.'}
            </p>
            {(search || filter !== 'all') && (
              <button
                className="text"
                onClick={() => {
                  setFilter('all');
                  onSearch('');
                }}
              >
                Show all conversations
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
export function ConversationView({
  activeId,
  messages,
  busy,
  error,
  children,
  readStatus,
}: {
  readStatus?: {
    conversation: Conversation;
    canMark: boolean;
    onRead: (snapshot: Conversation) => void;
    onConflict: () => void;
  };
  activeId: string;
  messages: Message[];
  busy: boolean;
  error: string;
  children: ReactNode;
}) {
  const transcript = useRef<HTMLDivElement>(null),
    scrollState = useRef({
      id: '',
      lastId: '',
      atBottom: true,
      height: 0,
      width: 0,
    });
  const [newMessages, setNewMessages] = useState(false);
  const [atLatest, setAtLatest] = useState(true);
  const [attachment, setAttachment] = useState<Message | null>(null);
  function jump() {
    // Frequent navigation should finish before keyboard/layout changes.
    scrollState.current.atBottom = true;
    if (transcript.current)
      transcript.current.scrollTo({
        top: transcript.current.scrollHeight,
        behavior: 'instant',
      });
    setNewMessages(false);
  }
  useLayoutEffect(() => {
    const state = scrollState.current;
    if (state.id !== activeId) {
      state.id = activeId;
      state.lastId = '';
      state.atBottom = true;
    }
    const last = messages.at(-1)?.id;
    if (!last) return;
    let reveal: boolean | undefined;
    if (state.atBottom) {
      if (transcript.current)
        transcript.current.scrollTop = transcript.current.scrollHeight;
      reveal = false;
    } else if (state.lastId && state.lastId !== last) reveal = true;
    state.lastId = last;
    if (reveal === undefined) return;
    const frame = requestAnimationFrame(() => setNewMessages(reveal));
    return () => cancelAnimationFrame(frame);
  }, [activeId, messages]);
  useEffect(() => {
    const el = transcript.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      scrollState.current.height = el.clientHeight;
      scrollState.current.width = el.clientWidth;
      if (scrollState.current.atBottom) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    const thread = el.querySelector('.thread');
    if (thread) observer.observe(thread);
    return () => observer.disconnect();
  }, []);
  return (
    <section className="conversation-layout" aria-label="Conversation">
      <div className="history-area">
        <div
          className="transcript"
          ref={transcript}
          onScroll={() => {
            const el = transcript.current;
            if (el) {
              // A resize can emit scroll before ResizeObserver. Keep the
              // prior reading intent until the new viewport is accounted for.
              if (
                el.clientHeight !== scrollState.current.height ||
                el.clientWidth !== scrollState.current.width
              )
                return;
              scrollState.current.atBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              setAtLatest(scrollState.current.atBottom);
              if (scrollState.current.atBottom) setNewMessages(false);
            }
          }}
        >
          <section aria-label="Message history" className="thread">
            <p className="history-hint sr">Recent messages · Times in Qatar</p>
            {messages.map((m, index) => (
              <div
                className={`message-group ${m.sender_type === 'customer' ? 'customer-group' : 'agent-group'} ${index > 0 && messages[index - 1].sender_type === m.sender_type && dayKey(messages[index - 1].created_at) === dayKey(m.created_at) ? 'continued-message' : ''}`}
                key={m.id}
              >
                {(index === 0 ||
                  dayKey(messages[index - 1].created_at) !==
                    dayKey(m.created_at)) && (
                  <p className="date">{dayLabel(m.created_at)}</p>
                )}
                <article
                  className={`message ${m.sender_type === 'customer' ? 'incoming' : 'outgoing'} ${m.content_type === 'image' ? 'photo-message' : ''} ${m.content_type === 'audio' ? 'voice-message' : ''}`}
                >
                  {m.content_type === 'image' && (
                    <InlinePhoto message={m} onOpen={() => setAttachment(m)} />
                  )}
                  {m.content_type === 'audio' && <InlineVoice message={m} />}
                  {m.content_type === 'document' && (
                    <AttachmentButton
                      message={m}
                      onOpen={() => setAttachment(m)}
                    />
                  )}
                  {((m.content_text && m.content_type !== 'document') ||
                    !['image', 'document', 'audio'].includes(
                      m.content_type
                    )) && (
                    <p dir="auto" lang={language(m.content_text)}>
                      {m.content_text || `[${m.content_type} attachment]`}
                    </p>
                  )}
                  <footer className="message-meta">
                    <time
                      dateTime={m.created_at}
                      title={fullTime(m.created_at)}
                      aria-label={fullTime(m.created_at)}
                    >
                      {shortTime(m.created_at)}
                    </time>
                    {['agent', 'bot'].includes(m.sender_type) && (
                      <DeliveryStatus status={m.status} />
                    )}
                  </footer>
                </article>
              </div>
            ))}
            {!busy && !error && !messages.length && (
              <div className="empty-state">
                <h2>Start the conversation</h2>
                <p>Your messages will appear here.</p>
              </div>
            )}
          </section>
        </div>
        {newMessages && (
          <button className="jump-latest" onClick={jump}>
            <ArrowDown size={15} />
            New messages
          </button>
        )}
      </div>
      {readStatus && (
        <ReadStatus
          conversation={readStatus.conversation}
          enabled={
            readStatus.canMark &&
            !busy &&
            !error &&
            messages.length > 0 &&
            atLatest &&
            !attachment
          }
          onRead={readStatus.onRead}
          onConflict={readStatus.onConflict}
        />
      )}
      <div className="reply-dock">{children}</div>
      {attachment && (
        <AttachmentViewer
          key={attachment.id}
          message={attachment}
          onClose={() => setAttachment(null)}
        />
      )}
    </section>
  );
}
