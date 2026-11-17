import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './client';
import { VoiceRecorder } from './voice-recorder';
import { Send, Clock3, Paperclip, X, FileText } from 'lucide-react';
import {
  attachmentAccept,
  attachmentType,
  attachmentLimit,
} from '../../src/lib/inbox/attachment-types';
import { nativePersistence, sessionStorage } from './session-storage';
import {
  sendTrackedMessage,
  reconcileSend,
  type SendOutcome,
} from '../../src/lib/inbox/send-outcome';
const endpoint =
  (import.meta.env.VITE_CRM_API_URL ?? '').replace(/\/$/, '') +
  '/api/mobile/messages';
type Pending = {
  userId: string;
  accountId: string;
  conversationId: string;
  operationId: string;
  text: string;
  draftVersion?: string;
  media?: {
    kind: 'image' | 'document' | 'audio';
    mediaUrl: string;
    filename: string;
  };
};
let browserPending: string | null = null;
let composerGeneration = 0;
let sendInFlight = false;
const drafts = new Map<string, string>();
const draftKey = (u: string, a: string, c: string) => `${u}:${a}:${c}`;
export function clearComposerDrafts() {
  composerGeneration++;
  drafts.clear();
}
async function store(p: Pending | null) {
  const value = p ? JSON.stringify(p) : null;
  if (nativePersistence) {
    if (value) await sessionStorage.setItem('hth-mobile-pending-send', value);
    else await sessionStorage.removeItem('hth-mobile-pending-send');
  } else browserPending = value;
}
async function saved() {
  const value = nativePersistence
    ? await sessionStorage.getItem('hth-mobile-pending-send')
    : browserPending;
  return value ? (JSON.parse(value) as Pending) : null;
}
const userTransport =
  (userId: string, generation: number): typeof fetch =>
  async (input, init) => {
    const {
      data: { session },
    } = await db.auth.getSession();
    if (
      !session ||
      session.user.id !== userId ||
      generation !== composerGeneration
    )
      throw new Error('Sign in required');
    return fetch(input, {
      ...init,
      credentials: 'omit',
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  };
export function TextComposer({
  conversationId,
  userId,
  accountId,
  onAccepted,
}: {
  conversationId: string;
  userId: string;
  accountId: string;
  onAccepted: () => void;
}) {
  const generation = useRef(composerGeneration).current;
  const transport = useMemo(
    () => userTransport(userId, generation),
    [userId, generation]
  );
  const [mediaEnabled, setMediaEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<Pending['media']>();
  const [preview, setPreview] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const draftVersion = useRef<string>(crypto.randomUUID());
  const [text, setText] = useState(
      () => drafts.get(draftKey(userId, accountId, conversationId)) ?? ''
    ),
    [enabled, setEnabled] = useState(false),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [notice, setNotice] = useState('Checking reply availability…');
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (
      !file ||
      !['image', 'audio'].includes(
        attachmentType(file.name, file.type)?.kind ?? ''
      )
    )
      return;
    const url = URL.createObjectURL(file);
    const frame = requestAnimationFrame(() => setPreview(url));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    const key = draftKey(userId, accountId, conversationId);
    if (text) drafts.set(key, text);
    else drafts.delete(key);
    if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 140)}px`;
    }
  }, [text, userId, accountId, conversationId]);
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    async function init() {
      try {
        const existing = await saved();
        const response = await transport(endpoint, {
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (disposed) return;
        setPending(existing);
        setReady(true);
        setEnabled(
          response.ok && data.protocol === 1 && data.textReplies === true
        );
        setVoiceEnabled(
          response.ok && data.protocol === 1 && data.voiceReplies === true
        );
        setMediaEnabled(
          response.ok && data.protocol === 1 && data.mediaReplies === true
        );
        setNotice(
          response.ok && data.textReplies
            ? ''
            : 'Replies are not available for this account yet.'
        );
        if (
          existing?.userId === userId &&
          existing.accountId === accountId &&
          existing.conversationId === conversationId
        ) {
          setText(existing.text);
          setUploaded(existing.media);
          if (existing.draftVersion)
            draftVersion.current = existing.draftVersion;
        }
      } catch {
        if (!disposed) {
          setReady(true);
          setNotice('Replies are not available yet.');
        }
      }
    }
    void init();
    return () => {
      disposed = true;
      alive.current = false;
    };
  }, [conversationId, userId, accountId, transport]);
  async function settle(result: SendOutcome, operation: Pending) {
    if (generation !== composerGeneration) return;
    if (result.state === 'unknown') {
      if (alive.current) {
        setPending(operation);
        setNotice(
          'Delivery is not confirmed. Check status before sending again.'
        );
      }
      return;
    }
    await store(null);
    const key = draftKey(
      operation.userId,
      operation.accountId,
      operation.conversationId
    );
    if (
      result.state === 'accepted' &&
      drafts.get(key)?.trim() === operation.text
    )
      drafts.delete(key);
    if (alive.current) {
      setPending(null);
      if (result.state === 'accepted') {
        if (operation.conversationId === conversationId) {
          setText((current) =>
            current.trim() === operation.text ? '' : current
          );
          if (operation.draftVersion === draftVersion.current) {
            setFile(null);
            setUploaded(undefined);
            if (fileInput.current) fileInput.current.value = '';
          }
        }
        setNotice('Reply accepted by WhatsApp.');
        onAccepted();
      } else
        setNotice('Reply was not sent. Review your message and try again.');
    }
  }
  async function send() {
    if (sendInFlight) {
      setNotice('Another reply is finishing. Please wait before sending.');
      return;
    }
    if (
      lock.current ||
      !enabled ||
      recording ||
      pending ||
      (!text.trim() && !file && !uploaded) ||
      ((file || uploaded) && !mediaEnabled) ||
      (uploaded?.kind === 'audio' ||
      (file && attachmentType(file.name, file.type)?.kind === 'audio')
        ? text.length > 0
        : text.length > (file || uploaded ? 1024 : 4096))
    )
      return;
    lock.current = true;
    sendInFlight = true;
    setBusy(true);
    try {
      const unresolved = await saved();
      if (unresolved) {
        if (alive.current) {
          setPending(unresolved);
          setBusy(false);
          setNotice(
            'A reply has an unresolved status. Check it before sending.'
          );
        }
        lock.current = false;
        sendInFlight = false;
        return;
      }
    } catch {
      lock.current = false;
      sendInFlight = false;
      if (alive.current) {
        setBusy(false);
        setNotice('Could not check pending replies. Nothing was sent.');
      }
      return;
    }
    let media = uploaded;
    if (file && !media) {
      try {
        setNotice('Uploading attachment…');
        const form = new FormData();
        form.append('file', file);
        form.append('conversation_id', conversationId);
        const response = await transport(
          endpoint.replace(/messages$/, 'uploads'),
          { method: 'POST', body: form, signal: AbortSignal.timeout(60000) }
        );
        const data = await response.json().catch(() => ({}));
        if (
          !response.ok ||
          !['image', 'document', 'audio'].includes(data.kind) ||
          typeof data.mediaUrl !== 'string' ||
          typeof data.filename !== 'string'
        )
          throw new Error(
            data.error || 'Upload did not finish. No message was sent.'
          );
        media = {
          kind: data.kind,
          mediaUrl: data.mediaUrl,
          filename: data.filename,
        };
        if (alive.current) setUploaded(media);
      } catch (e) {
        lock.current = false;
        sendInFlight = false;
        if (alive.current) {
          setBusy(false);
          setNotice(
            e instanceof Error
              ? e.message
              : 'Upload did not finish. No message was sent.'
          );
        }
        return;
      }
    }
    const operation: Pending = {
      userId,
      accountId,
      conversationId,
      operationId: crypto.randomUUID(),
      text: text.trim(),
      draftVersion: draftVersion.current,
      ...(media ? { media } : {}),
    };
    let persisted = false;
    try {
      if (generation !== composerGeneration) throw new Error('Session changed');
      await store(operation);
      if (generation !== composerGeneration) {
        const current = await saved();
        if (current?.operationId === operation.operationId) await store(null);
        throw new Error('Session changed');
      }
      persisted = true;
      if (alive.current) setPending(operation);
      await settle(
        await sendTrackedMessage(
          {
            conversation_id: conversationId,
            message_type: operation.media?.kind ?? 'text',
            content_text: operation.text,
            ...(operation.media
              ? {
                  media_url: operation.media.mediaUrl,
                  filename: operation.media.filename,
                }
              : {}),
          },
          operation.operationId,
          transport,
          endpoint
        ),
        operation
      );
    } catch {
      if (alive.current) {
        setPending(persisted ? operation : null);
        setNotice(
          persisted
            ? 'Could not confirm this reply. Check status before sending again.'
            : 'Could not securely save your reply. Nothing was sent.'
        );
      }
    } finally {
      lock.current = false;
      sendInFlight = false;
      if (alive.current) setBusy(false);
    }
  }
  async function check() {
    if (!pending || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await settle(
        await reconcileSend(pending.operationId, transport, endpoint),
        pending
      );
    } catch {
      setNotice('Status is unavailable. Keep this reply pending.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const owns = pending?.userId === userId && pending?.accountId === accountId;
  const selection =
    uploaded ||
    (file
      ? {
          filename: file.name,
          kind: attachmentType(file.name, file.type)?.kind,
        }
      : undefined);
  const captionLimit =
    selection?.kind === 'audio' ? 0 : selection ? 1024 : 4096;
  function chooseFile(chosen?: File) {
    if (!chosen || lock.current || pending) return;
    const type = attachmentType(chosen.name, chosen.type);
    if (!type || !chosen.size) {
      setNotice('Choose a JPG/PNG photo, PDF, Office document or text file.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (chosen.size > attachmentLimit(type.kind)) {
      setNotice(
        type.kind === 'image'
          ? 'Photos must be 5 MB or smaller.'
          : 'Documents must be 16 MB or smaller.'
      );
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFile(chosen);
    draftVersion.current = crypto.randomUUID();
    setUploaded(undefined);
    setNotice('');
  }
  return (
    <section className="composer" aria-label="Reply">
      {selection && (
        <div className="selected-attachment">
          {file && selection.kind === 'audio' && preview ? (
            <audio controls src={preview} aria-label="Recorded voice preview" />
          ) : file && selection.kind === 'image' && preview ? (
            <>
              {/* Local file preview in the Vite app. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Selected photo preview" />
            </>
          ) : (
            <FileText size={24} aria-hidden="true" />
          )}
          <span>
            <strong dir="auto">{selection.filename}</strong>
            <small>
              {selection.kind === 'image'
                ? 'Photo'
                : selection.kind === 'audio'
                  ? 'Voice message'
                  : 'Document'}
              {file ? ` · ${(file.size / 1024).toFixed(0)} KB` : ''}
            </small>
          </span>
          <button
            className="icon-button"
            aria-label="Remove attachment"
            disabled={busy || !!pending}
            onClick={() => {
              draftVersion.current = crypto.randomUUID();
              setFile(null);
              setUploaded(undefined);
              if (fileInput.current) fileInput.current.value = '';
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {text.length > captionLimit && (
        <p className="compose-notice">
          Attachment captions must be {captionLimit} characters or shorter.
        </p>
      )}
      <div className="compose-row">
        <input
          ref={fileInput}
          type="file"
          className="file-picker"
          accept={attachmentAccept}
          aria-label="Choose photo or document"
          disabled={!mediaEnabled || busy || !!pending || recording}
          onChange={(e) => chooseFile(e.target.files?.[0])}
        />
        <button
          className="icon-button attach-button"
          aria-label="Attach photo or document"
          title={
            mediaEnabled
              ? 'Attach photo or document'
              : 'Attachments are not available yet'
          }
          disabled={!mediaEnabled || busy || !!pending || recording}
          onClick={() => fileInput.current?.click()}
        >
          <Paperclip size={21} />
        </button>
        {!selection && !text.trim() && (
          <VoiceRecorder
            disabled={!voiceEnabled || busy || !!pending}
            onRecording={setRecording}
            onRecorded={chooseFile}
          />
        )}
        <label className="sr" htmlFor="reply-text">
          Text reply
        </label>
        <textarea
          ref={textarea}
          id="reply-text"
          maxLength={captionLimit}
          value={text}
          disabled={
            busy || !!pending || recording || selection?.kind === 'audio'
          }
          hidden={recording || selection?.kind === 'audio'}
          placeholder={selection ? 'Add a caption…' : 'Write a reply…'}
          dir="auto"
          onChange={(e) => setText(e.target.value)}
          rows={1}
          aria-describedby={notice ? 'reply-status' : undefined}
        />
        <button
          className="send-button"
          aria-label={busy ? 'Checking…' : 'Send reply'}
          disabled={
            !ready ||
            !enabled ||
            recording ||
            busy ||
            !!pending ||
            (!text.trim() && !selection) ||
            text.length > captionLimit ||
            (!!selection && !mediaEnabled) ||
            (selection?.kind === 'audio' && !voiceEnabled)
          }
          onClick={() => void send()}
        >
          {busy ? (
            <Clock3 size={20} aria-hidden="true" />
          ) : (
            <Send size={20} aria-hidden="true" />
          )}
          <span className="sr">{busy ? 'Checking…' : 'Send reply'}</span>
        </button>
      </div>
      {text.length > captionLimit - 200 && (
        <p className="character-count">
          {text.length}/{captionLimit}
        </p>
      )}
      {pending && owns && (
        <button className="text" disabled={busy} onClick={() => void check()}>
          Check delivery status
        </button>
      )}
      {pending && !owns && (
        <p>Another account has a pending reply. Resolve it before sending.</p>
      )}
      {notice && (
        <p id="reply-status" className="compose-notice" aria-live="polite">
          {notice}
        </p>
      )}
    </section>
  );
}
