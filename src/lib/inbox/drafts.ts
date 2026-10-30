import type { SendRecovery } from './send-outcome';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
/** Device drafts are isolated by account, user and conversation. Never store File/blobs. */
export const DRAFT_PREFIX = 'wacrm:draft:v1:';
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MEDIA_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export interface ComposerAttachment {
  kind: 'image' | 'video' | 'document' | 'audio';
  mediaUrl: string;
  path: string;
  filename: string;
  caption: string;
  source: 'upload' | 'catalog';
}
export interface ComposerReply {
  id: string;
  authorLabel: string;
  preview: string;
}
export interface TemplateDraft {
  name: string;
  language: string;
  bodyText: string;
  values: {
    body: string[];
    headerText?: string;
    buttonParams?: Record<number, string>;
  };
}
export interface ConversationDraft {
  text: string;
  attachment: ComposerAttachment | null;
  attachmentAt: number | null;
  reply: ComposerReply | null;
  updatedAt: number;
  recovery: SendRecovery | null;
  interactive: InteractiveMessagePayload | null;
  template: TemplateDraft | null;
}
export const EMPTY_DRAFT: ConversationDraft = {
  text: '',
  attachment: null,
  attachmentAt: null,
  reply: null,
  updatedAt: 0,
  recovery: null,
  interactive: null,
  template: null,
};
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const epochs = new Map<string, number>();
let globalEpoch = 0;

export function draftScope(accountId: string, userId: string) {
  return `${DRAFT_PREFIX}${encodeURIComponent(accountId)}:${encodeURIComponent(userId)}:`;
}
export function draftKey(scope: string, conversationId: string) {
  return `${scope}${encodeURIComponent(conversationId)}`;
}
export function draftEpoch(scope: string) {
  return `${globalEpoch}:${epochs.get(scope) ?? 0}`;
}
function storage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
export function readDraftSnapshot(key: string): string {
  try {
    return memory.get(key) ?? storage()?.getItem(key) ?? '';
  } catch {
    return memory.get(key) ?? '';
  }
}
export function isDraftPersisted(key: string): boolean {
  try {
    return storage()?.getItem(key) === readDraftSnapshot(key);
  } catch {
    return false;
  }
}
export function parseDraft(raw: string, now = Date.now()): ConversationDraft {
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.text !== 'string' ||
      !Number.isFinite(value.updatedAt) ||
      value.updatedAt > now ||
      now - value.updatedAt >= DRAFT_TTL_MS
    )
      return EMPTY_DRAFT;
    const a = value.attachment;
    const attachment =
      a &&
      ['image', 'video', 'document', 'audio'].includes(a.kind) &&
      ['upload', 'catalog'].includes(a.source) &&
      ['mediaUrl', 'path', 'filename', 'caption'].every(
        (k) => typeof a[k] === 'string'
      ) &&
      Number.isFinite(value.attachmentAt) &&
      value.attachmentAt <= now &&
      now - value.attachmentAt < MEDIA_DRAFT_TTL_MS
        ? a
        : null;
    const r = value.reply;
    const reply =
      r &&
      ['id', 'authorLabel', 'preview'].every((k) => typeof r[k] === 'string')
        ? r
        : null;
    const op = value.recovery;
    const recovery =
      op &&
      typeof op.id === 'string' &&
      ['text', 'media', 'interactive', 'template'].includes(op.kind) &&
      ['sending', 'rejected', 'unknown'].includes(op.state)
        ? ({
            id: op.id,
            kind: op.kind,
            state: op.state,
            code: typeof op.code === 'string' ? op.code : undefined,
            original:
              op.original && typeof op.original === 'object'
                ? Object.fromEntries(
                    ['text', 'path', 'replyId', 'interactive', 'template']
                      .filter((key) => typeof op.original[key] === 'string')
                      .map((key) => [key, op.original[key]])
                  )
                : undefined,
          } as SendRecovery)
        : null;
    let interactive: InteractiveMessagePayload | null = null;
    const candidate = value.interactive;
    if (
      candidate &&
      typeof candidate.body === 'string' &&
      ((candidate.kind === 'buttons' && Array.isArray(candidate.buttons)) ||
        (candidate.kind === 'list' &&
          typeof candidate.button_label === 'string' &&
          Array.isArray(candidate.sections)))
    )
      interactive = candidate;
    const tp = value.template;
    const template: TemplateDraft | null =
      tp &&
      typeof tp.name === 'string' &&
      typeof tp.language === 'string' &&
      typeof tp.bodyText === 'string' &&
      tp.values &&
      Array.isArray(tp.values.body) &&
      tp.values.body.every((v: unknown) => typeof v === 'string')
        ? tp
        : null;
    return {
      recovery,
      interactive,
      template,
      text: value.text,
      attachment,
      attachmentAt: attachment ? value.attachmentAt : null,
      reply,
      updatedAt: value.updatedAt,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}
export function subscribeDrafts(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(DRAFT_PREFIX)) {
      // Storage events with removals must also evict an in-memory fallback.
      if (event.key) memory.delete(event.key);
      else memory.clear();
      listener();
    }
  };
  if (typeof window !== 'undefined')
    window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined')
      window.removeEventListener('storage', onStorage);
  };
}
function notify() {
  for (const listener of listeners) listener();
}
export function writeDraft(
  scope: string,
  key: string,
  epoch: string,
  update: (previous: ConversationDraft) => ConversationDraft
): boolean {
  if (epoch !== draftEpoch(scope)) return false;
  const previous = parseDraft(readDraftSnapshot(key));
  const next = update(previous);
  if (next === previous) return true;
  const raw =
    next.text ||
    next.attachment ||
    next.reply ||
    next.recovery ||
    next.interactive ||
    next.template
      ? JSON.stringify({ ...next, updatedAt: Date.now() })
      : '';
  // Keep an empty tombstone too: a failed removeItem must not resurrect old text.
  memory.set(key, raw);
  try {
    const target = storage();
    if (raw) target?.setItem(key, raw);
    else target?.removeItem(key);
  } catch {
    /* A full/disabled store still allows in-tab recovery. */
  }
  notify();
  return true;
}
/** Invalidates outstanding writers as well as clearing persisted customer content. */
export function clearDrafts(scope?: string) {
  if (scope) epochs.set(scope, (epochs.get(scope) ?? 0) + 1);
  else globalEpoch++;
  const prefix = scope ?? DRAFT_PREFIX;
  for (const key of memory.keys())
    if (key.startsWith(prefix)) memory.delete(key);
  try {
    const target = storage();
    if (target)
      for (const key of Object.keys(target)) {
        if (key.startsWith(prefix)) target.removeItem(key);
      }
  } catch {
    /* Best effort when the browser denies storage access. */
  }
  notify();
}
