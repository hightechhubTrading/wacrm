import React, { useEffect, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import './style.css';

const conversations = [
  {
    id: 'measurement',
    name: 'Demo · Villa measurement',
    initials: 'VM',
    preview: 'Can we arrange a site measurement?',
    time: '09:42',
    messages: [
      {
        id: 1,
        incoming: true,
        text: 'Hello, I would like a shutter for the garage.',
        time: '09:38',
      },
      {
        id: 2,
        incoming: false,
        text: 'Could you share the approximate opening width and height?',
        time: '09:40',
      },
      {
        id: 3,
        incoming: true,
        text: 'Can we arrange a site measurement?',
        time: '09:42',
      },
    ],
  },
  {
    id: 'pergola',
    name: 'Demo · Pergola enquiry',
    initials: 'PE',
    preview: 'هل تتوفر خيارات لسقف متحرك؟',
    time: '09:15',
    messages: [
      {
        id: 1,
        incoming: true,
        text: 'مرحبا، هل تتوفر خيارات لسقف متحرك؟',
        time: '09:15',
      },
    ],
  },
];
export function DemoApp() {
  const [entered, setEntered] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const active = conversations.find((c) => c.id === activeId);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => {
      if (activeId) setActiveId(null);
      else if (entered) {
        setEntered(false);
        setSearch('');
      } else void NativeApp.exitApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [activeId, entered]);
  useEffect(() => {
    document.querySelector<HTMLElement>('h1')?.focus();
  }, [entered, activeId]);
  return (
    <div className="shell">
      <aside className="demo">
        DEMO · Synthetic conversations · No live connection
      </aside>
      {!entered ? (
        <main className="welcome">
          <div className="wordmark">HIGH TECH HUB</div>
          <h1 tabIndex={-1}>
            Your customer work.
            <br />
            Within reach.
          </h1>
          <p>Inbox and conversation history, built for your phone.</p>
          <button className="primary" onClick={() => setEntered(true)}>
            Explore demo inbox
          </button>
          <p className="muted">
            This preview uses sample records. Account sign-in and sending will
            follow after test-backend setup.
          </p>
        </main>
      ) : (
        <>
          <header>
            {active ? (
              <button
                className="back"
                aria-label="Back to inbox"
                onClick={() => setActiveId(null)}
              >
                ←
              </button>
            ) : (
              <div className="wordmark">HTH / CRM</div>
            )}
            <div>
              <h1 tabIndex={-1}>{active ? active.name : 'Inbox'}</h1>
              <p>
                {active
                  ? 'Sample conversation'
                  : 'Your conversations, in one place'}
              </p>
            </div>
            {!active && (
              <button
                className="text"
                onClick={() => {
                  setEntered(false);
                  setSearch('');
                }}
              >
                Exit demo
              </button>
            )}
          </header>
          <main>
            {!active ? (
              <>
                <label className="search">
                  Search conversations
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name or message"
                    type="search"
                  />
                </label>
                <p className="count">
                  {
                    conversations.filter((c) =>
                      `${c.name} ${c.preview}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    ).length
                  }{' '}
                  conversations
                </p>
                <ul className="list">
                  {conversations
                    .filter((c) =>
                      `${c.name} ${c.preview}`
                        .toLowerCase()
                        .includes(search.toLowerCase())
                    )
                    .map((c) => (
                      <li key={c.id}>
                        <button
                          className="conversation"
                          onClick={() => setActiveId(c.id)}
                        >
                          <span className="avatar" aria-hidden="true">
                            {c.initials}
                          </span>
                          <span className="summary">
                            <strong>{c.name}</strong>
                            <span dir="auto">{c.preview}</span>
                          </span>
                          <time>{c.time}</time>
                        </button>
                      </li>
                    ))}
                </ul>
                {!conversations.some((c) =>
                  `${c.name} ${c.preview}`
                    .toLowerCase()
                    .includes(search.toLowerCase())
                ) && (
                  <p className="empty">No conversations match your search.</p>
                )}
              </>
            ) : (
              <section aria-label="Message history" className="thread">
                <p className="date">Sample day</p>
                {active.messages.map((m) => (
                  <article
                    className={`message ${m.incoming ? 'incoming' : 'outgoing'}`}
                    key={m.id}
                  >
                    <span className="sr">
                      {m.incoming ? 'Customer' : 'Agent'}:{' '}
                    </span>
                    <p dir="auto">{m.text}</p>
                    <time>{m.time}</time>
                  </article>
                ))}
                <p className="readonly">
                  Read-only preview. No messages can be sent from this demo.
                </p>
              </section>
            )}
          </main>
        </>
      )}
    </div>
  );
}
