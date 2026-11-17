import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { db } from './client';
import { nativePersistence, sessionStorage } from './session-storage';
import { DemoApp } from './Demo';
import { TextComposer, clearComposerDrafts } from './text-composer';
import { useLiveUpdates } from './use-live-updates';
import { clearAttachmentFiles } from './attachment-viewer';
import { ChatMediaProvider } from './chat-media';
import { clearContactPhotos } from './contact-photo';
import { ContactDetails } from './contact-details';
import { TodayView } from './today';
import { QuotationsView } from './quotations';
import { MessageSquare, CalendarDays, FileText } from 'lucide-react';
import './style.css';
import {
  WorkspaceHeader,
  ConnectionLine,
  InboxView,
  ConversationView,
  type Conversation,
  type Message,
} from './workspace-ui';
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
function App() {
  const [view, setView] = useState<'chats' | 'today' | 'quotations'>('chats');
  const todayScroll = useRef(0);
  const [focused, setFocused] = useState<Conversation | null>(null);
  const [demo, setDemo] = useState(false),
    [signed, setSigned] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [rows, setRows] = useState<Conversation[]>([]),
    [messages, setMessages] = useState<Message[]>([]);
  const [active, setActive] = useState<Conversation | null>(null),
    [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [inboxFilter, setInboxFilter] = useState('all');
  const inboxScroll = useRef(0);
  const [contactOpen, setContactOpen] = useState(false);
  const [canMarkRead, setCanMarkRead] = useState(false);
  const scopeRef = useRef<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const connection = useLiveUpdates(
    signed && !demo,
    accountId,
    active?.id ?? null,
    () => setRevision((n) => n + 1)
  );
  function clear() {
    setView('chats');
    setFocused(null);
    todayScroll.current = 0;
    clearContactPhotos();
    void clearAttachmentFiles().catch(() => {});
    clearComposerDrafts();
    setInboxFilter('all');
    inboxScroll.current = 0;
    scopeRef.current = null;
    setAccountId(null);
    setUserId(null);
    setRows([]);
    setMessages([]);
    setActive(null);
    setContactOpen(false);
    setCanMarkRead(false);
    setSearch('');
  }
  function refresh() {
    setRows([]);
    setMessages([]);
    setRevision((n) => n + 1);
  }
  useEffect(() => {
    const { data } = db.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        setSigned(!!session);
        setRestoring(false);
      }
      if (event === 'SIGNED_OUT') {
        setSigned(false);
        clear();
        setError('');
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!signed) return;
    let cancelled = false;
    setBusy(true);
    setError('');
    async function load() {
      try {
        const { data: user, error: authError } = await db.auth.getUser();
        if (authError || !user.user) {
          if (
            authError?.status === 401 ||
            authError?.status === 403 ||
            authError?.name === 'AuthSessionMissingError' ||
            (!authError && !user.user)
          ) {
            if (cancelled) return;
            db.auth.stopAutoRefresh();
            if (nativePersistence)
              for (const key of [
                'hth-mobile-session',
                'hth-mobile-session-user',
                'hth-mobile-session-code-verifier',
                'hth-mobile-pending-send',
              ])
                await sessionStorage.removeItem(key);
            clear();
            setSigned(false);
          }
          throw new Error(
            'Could not verify your session. Check your connection or sign in again.'
          );
        }
        const { data: profile, error: profileError } = await db
          .from('profiles')
          .select('account_id,account_role')
          .eq('user_id', user.user.id)
          .single();
        if (
          profileError ||
          !profile?.account_id ||
          !['owner', 'admin', 'agent', 'viewer'].includes(profile.account_role)
        ) {
          if (!cancelled) {
            setAccountId(null);
            setView('chats');
            setActive(null);
            setContactOpen(false);
          }
          throw new Error('Your account access is unavailable.');
        }
        if (cancelled) return;
        const scope = `${user.user.id}:${profile.account_id}:${profile.account_role}`;
        if (scopeRef.current && scopeRef.current !== scope) {
          setRows([]);
          setMessages([]);
          setActive(null);
          setContactOpen(false);
          setView('chats');
        }
        scopeRef.current = scope;
        setAccountId(profile.account_id);
        setUserId(user.user.id);
        setCanMarkRead(profile.account_role !== 'viewer');
        const list = await db
          .from('conversations')
          .select(
            'id,last_message_text,last_message_at,unread_count,assigned_agent_id,status,contact:contacts(id,name,phone,avatar_url)'
          )
          .eq('account_id', profile.account_id)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .order('id')
          .limit(100);
        if (list.error)
          throw new Error(
            'Could not load conversations. Check your connection and retry.'
          );
        if (cancelled) return;
        const data = list.data as unknown as Conversation[];
        setRows(data);
        if (active) {
          // Recheck visibility before loading history; RLS is authoritative on both reads.
          let permitted = data.find((c) => c.id === active.id);
          if (!permitted) {
            const exact = await db
              .from('conversations')
              .select(
                'id,last_message_text,last_message_at,unread_count,assigned_agent_id,status,contact:contacts(id,name,phone,avatar_url)'
              )
              .eq('id', active.id)
              .eq('account_id', profile.account_id)
              .maybeSingle();
            if (cancelled) return;
            if (exact.error)
              throw new Error(
                'Could not verify conversation access. Please retry.'
              );
            permitted = exact.data as unknown as Conversation | undefined;
          }
          if (!permitted) {
            setActive(null);
            setContactOpen(false);
            return;
          }
          setFocused(permitted);
          const history = await db
            .from('messages')
            .select(
              'id,sender_type,status,content_text,content_type,media_url,created_at'
            )
            .eq('conversation_id', active.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(50);
          if (history.error)
            throw new Error('Could not load message history. Please retry.');
          if (!cancelled) setMessages((history.data as Message[]).reverse());
        }
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setMessages([]);
          setActive(null);
          setContactOpen(false);
          setView('chats');
          setError(
            e instanceof Error ? e.message : 'Could not load your account.'
          );
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [signed, revision, active]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || demo) return;
    const listener = NativeApp.addListener('backButton', () => {
      const viewer = [...document.querySelectorAll('dialog[open]')].at(-1);
      if (viewer) {
        viewer.dispatchEvent(new Event('cancel', { cancelable: true }));
        return;
      }
      const menu = document.querySelector('details.account-menu[open]');
      if (menu) {
        menu.removeAttribute('open');
        return;
      }
      if (active) {
        setActive(null);
        setContactOpen(false);
        setMessages([]);
      } else if (view !== 'chats') setView('chats');
      else void NativeApp.exitApp();
    });
    return () => {
      void listener.then((h) => h.remove());
    };
  }, [active, demo, view]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () =>
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${Math.round(viewport?.height ?? window.innerHeight)}px`
      );
    resize();
    viewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--viewport-height');
    };
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await db.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error || !result.data.user) {
        setError('Unable to sign in. Check your credentials and connection.');
        return;
      }
      db.auth.startAutoRefresh();
      setSigned(true);
    } catch {
      setError('Unable to sign in. Check your connection and retry.');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    clear();
    setSigned(false);
    setPassword('');
    try {
      await db.auth.signOut({ scope: 'local' }).catch(() => {});
      db.auth.stopAutoRefresh();
      await clearAttachmentFiles();
      if (nativePersistence) {
        for (const key of [
          'hth-mobile-session',
          'hth-mobile-session-user',
          'hth-mobile-session-code-verifier',
          'hth-mobile-pending-send',
        ])
          await sessionStorage.removeItem(key);
      }
      // Reset SDK memory even when server revocation was unavailable offline.
      window.location.reload();
    } catch {
      setSigned(true);
      setError('Saved sign-in could not be removed. Please retry Sign out.');
      setBusy(false);
    }
  }
  if (restoring)
    return (
      <main className="welcome">
        <p role="status">Restoring session…</p>
      </main>
    );
  if (demo)
    return (
      <>
        <button className="demo-return" onClick={() => setDemo(false)}>
          Return to sign in
        </button>
        <DemoApp />
      </>
    );
  return (
    <div className={`shell ${signed ? 'workspace' : 'auth-shell'}`}>
      {!signed ? (
        <main className="welcome">
          <div className="wordmark">HIGH TECH HUB</div>
          <h1>Sign in to your CRM</h1>
          <p>Use the same account as the website.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="muted">
            {nativePersistence
              ? 'Your session is saved using Android secure storage. Sign out to remove it.'
              : 'Browser preview sessions stay in memory.'}
          </p>
          <button className="text" onClick={() => setDemo(true)}>
            Explore demo inbox
          </button>
        </main>
      ) : (
        <>
          <WorkspaceHeader
            active={
              active
                ? focused?.id === active.id
                  ? focused
                  : (rows.find((c) => c.id === active.id) ?? active)
                : null
            }
            title={
              view === 'today'
                ? 'Today'
                : view === 'quotations'
                  ? 'Quotations'
                  : 'Chats'
            }
            rows={rows}
            busy={busy}
            onBack={() => {
              setActive(null);
              setContactOpen(false);
              setMessages([]);
            }}
            onRefresh={refresh}
            onLogout={() => void logout()}
            onContact={
              active
                ? () => {
                    window.dispatchEvent(new Event('hth:cancel-recording'));
                    setContactOpen(true);
                  }
                : undefined
            }
          />
          {contactOpen && active && (
            <ContactDetails
              key={active.id}
              conversation={active}
              onClose={() => setContactOpen(false)}
            />
          )}
          <ConnectionLine connection={connection} />
          {busy && (
            <p role="status" className="sr">
              {active ? 'Updating messages…' : 'Updating inbox…'}
            </p>
          )}
          <main className="workspace-main">
            {!active && view === 'quotations' && accountId && userId ? (
              <QuotationsView
                key={`${userId}:${accountId}`}
                revision={revision}
                onOpen={(conversation) => {
                  setMessages([]);
                  setFocused(null);
                  setContactOpen(false);
                  setActive(conversation);
                }}
              />
            ) : !active && view === 'today' && accountId && userId ? (
              <TodayView
                key={`${userId}:${accountId}`}
                revision={revision}
                initialScroll={todayScroll.current}
                onScrollPosition={(position) => {
                  todayScroll.current = position;
                }}
                onOpen={(conversation) => {
                  setMessages([]);
                  setFocused(null);
                  setContactOpen(false);
                  setActive(conversation);
                }}
              />
            ) : !active ? (
              <InboxView
                filter={inboxFilter}
                onFilter={(value) => {
                  inboxScroll.current = 0;
                  setInboxFilter(value);
                }}
                initialScroll={inboxScroll.current}
                onScrollPosition={(value) => {
                  inboxScroll.current = value;
                }}
                rows={rows}
                busy={busy}
                error={error}
                userId={userId}
                search={search}
                onSearch={setSearch}
                onSelect={(c) => {
                  setMessages([]);
                  setFocused(null);
                  setContactOpen(false);
                  setActive(c);
                }}
              />
            ) : (
              <ChatMediaProvider key={active.id}>
                <ConversationView
                  key={active.id}
                  activeId={active.id}
                  readStatus={{
                    conversation:
                      focused?.id === active.id
                        ? focused
                        : (rows.find((c) => c.id === active.id) ?? active),
                    canMark: canMarkRead && !contactOpen,
                    onRead: (snapshot) => {
                      setFocused((previous) =>
                        previous?.id === snapshot.id &&
                        previous.unread_count === snapshot.unread_count &&
                        previous.last_message_at === snapshot.last_message_at
                          ? { ...previous, unread_count: 0 }
                          : previous
                      );
                      setRows((previous) =>
                        previous.map((c) =>
                          c.id === snapshot.id &&
                          c.last_message_at === snapshot.last_message_at &&
                          c.unread_count === snapshot.unread_count
                            ? { ...c, unread_count: 0 }
                            : c
                        )
                      );
                    },
                    onConflict: () => setRevision((n) => n + 1),
                  }}
                  messages={messages}
                  busy={busy}
                  error={error}
                >
                  {userId && accountId && (
                    <TextComposer
                      key={active.id}
                      conversationId={active.id}
                      userId={userId}
                      accountId={accountId}
                      onAccepted={() => setRevision((n) => n + 1)}
                    />
                  )}
                </ConversationView>
              </ChatMediaProvider>
            )}
          </main>
          {!active && (
            <nav className="mobile-tabs" aria-label="Main navigation">
              <button
                aria-current={view === 'chats' ? 'page' : undefined}
                onClick={() => setView('chats')}
              >
                <MessageSquare size={21} />
                Chats
              </button>
              <button
                aria-current={view === 'today' ? 'page' : undefined}
                onClick={() => setView('today')}
              >
                <CalendarDays size={21} />
                Today
              </button>
              <button
                aria-current={view === 'quotations' ? 'page' : undefined}
                onClick={() => setView('quotations')}
              >
                <FileText size={21} />
                Quotations
              </button>
            </nav>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="error-banner">
          {error}
          {signed && (
            <button className="text" onClick={refresh}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
