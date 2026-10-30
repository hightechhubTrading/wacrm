'use client';

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  MessageSquareDashed,
  Zap,
  Languages,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { useBrowserOnline } from '@/hooks/use-browser-online';
import { type SendOutcome } from '@/lib/inbox/send-outcome';
import { useConversationDraft } from '@/hooks/use-conversation-draft';
import { useComposerSend } from '@/hooks/use-composer-send';
import {
  draftScope,
  type ComposerAttachment,
  type ComposerReply,
  type TemplateDraft,
} from '@/lib/inbox/drafts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ReplyQuote } from './reply-quote';
import { useLocale, useTranslations } from 'next-intl';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import type { InteractiveMessagePayload, QuickReply } from '@/types';
import { QuickReplyPicker } from './quick-reply-picker';
import { CatalogPickerDialog, type CatalogPick } from './catalog-picker-dialog';
import { TemplatePicker } from './template-picker';

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = 'image' | 'video' | 'document' | 'audio';

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = 'chat-media';

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
  /** 'upload' (chat-media bucket, GC'd on discard/failed-send) vs
   *  'catalog' (ai-media bucket, a shared/reusable asset — never GC'd
   *  through this flow). */
  source: 'upload' | 'catalog';
}

type ReplyDraft = ComposerReply;

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};

type MediaDraft = ComposerAttachment;

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (
    text: string,
    replyToId: string | undefined,
    operationId: string
  ) => Promise<SendOutcome>;
  onSendMedia: (
    payload: SendMediaPayload,
    operationId: string
  ) => Promise<SendOutcome>;
  onSendInteractive: (
    payload: InteractiveMessagePayload,
    replyToId: string | undefined,
    operationId: string
  ) => Promise<SendOutcome>;
  onOpenTemplates: () => void;
  templatePickerOpen?: boolean;
  onTemplatePickerOpenChange?: (open: boolean) => void;
  onSendTemplate?: (draft: TemplateDraft, id: string) => Promise<SendOutcome>;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  onDismissOperation?: (id: string) => void;
  onConfirmedOperation?: (
    id: string,
    result: Extract<SendOutcome, { state: 'accepted' }>
  ) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export function MessageComposer(props: MessageComposerProps) {
  const { accountId, user } = useAuth();
  if (!accountId || !user) return null;
  const scope = draftScope(accountId, user.id);
  return (
    <ScopedMessageComposer
      key={`${scope}${props.conversationId}`}
      {...props}
      scope={scope}
    />
  );
}

function ScopedMessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  templatePickerOpen = false,
  onTemplatePickerOpenChange,
  onSendTemplate,
  replyTo,
  onClearReply,
  onDismissOperation,
  onConfirmedOperation,
  scope,
}: MessageComposerProps & { scope: string }) {
  const t = useTranslations('Inbox.composer');
  const browserOnline = useBrowserOnline();
  const locale = useLocale();

  const {
    draft: savedDraft,
    update: updateDraft,
    persistent,
  } = useConversationDraft(scope, conversationId);
  const text = savedDraft.text;
  const textRef = useRef(text);
  const editVersion = useRef(0);
  const mounted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const pending = requests.current;
    return () => {
      mounted.current = false;
      for (const controller of pending) controller.abort();
      pending.clear();
    };
  }, []);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const setText = useCallback(
    (next: string | ((previous: string) => string)) => {
      editVersion.current++;
      updateDraft((previous) => {
        const value = typeof next === 'function' ? next(previous.text) : next;
        textRef.current = value;
        return { ...previous, text: value };
      });
    },
    [updateDraft]
  );
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const effectiveReply = replyTo ?? savedDraft.reply;
  useEffect(() => {
    if (replyTo) updateDraft((previous) => ({ ...previous, reply: replyTo }));
  }, [replyTo, updateDraft]);
  const clearReply = useCallback(() => {
    updateDraft((previous) => ({ ...previous, reply: null }));
    onClearReply?.();
  }, [updateDraft, onClearReply]);
  const recovery = savedDraft.recovery;
  const canSend = useCan('send-messages');
  const readOnly = !canSend;
  const { sending, deliveryLocked, checkingSend, runOperation, checkDelivery } =
    useComposerSend({
      recovery,
      updateDraft,
      mounted,
      readOnly,
      sessionExpired,
      browserOnline,
      onClearReply,
      onConfirmedOperation,
      onDismissOperation,
    });
  const [drafting, setDrafting] = useState(false);
  const [translatingDraft, setTranslatingDraft] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const interactivePayload = savedDraft.interactive ?? blankButtonsPayload();
  const setInteractivePayload = useCallback(
    (payload: InteractiveMessagePayload) => {
      updateDraft((previous) => ({ ...previous, interactive: payload }));
    },
    [updateDraft]
  );
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    const focus = () => textareaRef.current?.focus();
    window.addEventListener('focus-sales-composer', focus);
    return () => window.removeEventListener('focus-sales-composer', focus);
  }, []);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
  const draft = savedDraft.attachment;
  const setDraft = useCallback(
    (
      next:
        MediaDraft | null | ((previous: MediaDraft | null) => MediaDraft | null)
    ) => {
      return updateDraft((previous) => {
        const attachment =
          typeof next === 'function' ? next(previous.attachment) : next;
        return {
          ...previous,
          attachment,
          attachmentAt: attachment
            ? attachment.path === previous.attachment?.path
              ? previous.attachmentAt
              : Date.now()
            : null,
        };
      });
    },
    [updateDraft]
  );
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Latest staged object for replacement/discard cleanup. Draft ownership
  // survives navigation; an unfinished upload is cleaned up separately.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  // Never fires for a catalog pick — that file lives in the shared
  // `ai-media` bucket and must never be deleted through this flow.
  const removeStaged = useCallback(
    (path: string | undefined, source: 'upload' | 'catalog' | undefined) => {
      if (!path || source !== 'upload') return;
      void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
    },
    []
  );

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled =
    readOnly || sessionExpired || deliveryLocked || !browserOnline;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Release the microphone on navigation. Completed uploads stay attached
  // to this conversation's recoverable draft.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      // Staged attachments belong to their recoverable conversation draft.
    };
  }, [clearTimer]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || inputsDisabled) return;
    await runOperation(
      'text',
      (id) => onSend(trimmed, effectiveReply?.id, id),
      { text, replyId: effectiveReply?.id }
    );
    if (mounted.current) requestAnimationFrame(adjustHeight);
  }, [
    text,
    inputsDisabled,
    runOperation,
    onSend,
    effectiveReply?.id,
    adjustHeight,
  ]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight, setText]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting || inputsDisabled) return;
    setDrafting(true);
    const version = editVersion.current;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const res = await fetch('/api/ai/draft', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!mounted.current || controller.signal.aborted) return;
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(t('aiNotConfigured'));
        } else {
          toast.error(t('draftFailed'));
        }
        return;
      }
      const draftText = typeof data.draft === 'string' ? data.draft.trim() : '';
      if (!draftText) {
        toast.error(t('draftEmpty'));
        return;
      }
      if (textRef.current.trim() || editVersion.current !== version) {
        setSuggestion(draftText);
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      if (mounted.current && !controller.signal.aborted)
        toast.error(t('aiUnavailable'));
    } finally {
      requests.current.delete(controller);
      if (mounted.current) setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight, setText, t, inputsDisabled]);

  useEffect(() => {
    const prepare = (event: Event) => {
      if (
        (event as CustomEvent).detail?.conversationId === conversationId &&
        !readOnly &&
        !sessionExpired
      )
        void handleDraft();
    };
    window.addEventListener('draft-sales-reply', prepare);
    return () => window.removeEventListener('draft-sales-reply', prepare);
  }, [conversationId, readOnly, sessionExpired, handleDraft]);

  // Translate the composer's current text in place — agent types in
  // their own language, this replaces it with the target-language
  // version before sending. No per-agent locale exists, so the target
  // is simply whichever of the app's two shipped UI locales isn't the
  // build-time default (see message-actions.tsx for the same heuristic
  // on the inbound side).
  const handleTranslateDraft = useCallback(async () => {
    if (translatingDraft || !text.trim() || inputsDisabled) return;
    const targetLanguage = locale === 'ar' ? 'English' : 'Arabic';
    setTranslatingDraft(true);
    const version = editVersion.current;
    const original = text;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const res = await fetch('/api/ai/translate', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target_language: targetLanguage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!mounted.current || controller.signal.aborted) return;
      if (!res.ok) {
        toast.error(t('translationFailed'));
        return;
      }
      const translated =
        typeof data.translation === 'string' ? data.translation.trim() : '';
      if (!translated) {
        toast.error(t('translationEmpty'));
        return;
      }
      if (editVersion.current !== version || textRef.current !== original) {
        setSuggestion(translated);
        return;
      }
      setText(translated);
      requestAnimationFrame(() => adjustHeight());
    } catch {
      if (mounted.current && !controller.signal.aborted)
        toast.error(t('aiUnavailable'));
    } finally {
      requests.current.delete(controller);
      if (mounted.current) setTranslatingDraft(false);
    }
  }, [
    translatingDraft,
    text,
    adjustHeight,
    locale,
    setText,
    t,
    inputsDisabled,
  ]);

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      if (seed) setInteractivePayload(seed);
      else if (!savedDraft.interactive)
        setInteractivePayload(blankButtonsPayload());
      setInteractiveOpen(true);
    },
    [setInteractivePayload, savedDraft.interactive]
  );

  const sendInteractive = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await runOperation(
      'interactive',
      (id) => onSendInteractive(interactivePayload, effectiveReply?.id, id),
      {
        replyId: effectiveReply?.id,
        interactive: JSON.stringify(interactivePayload),
      }
    );
    if (mounted.current) setInteractiveOpen(false);
  }, [interactivePayload, onSendInteractive, effectiveReply?.id, runOperation]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window.prompt(t('quickReplyNamePrompt'))?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kind: 'interactive',
          interactive_payload: interactivePayload,
        }),
      });
      if (!res.ok) {
        toast.error(t('quickReplySaveError'));
        return;
      }
      toast.success(t('quickReplySaved'));
    } catch {
      toast.error(t('quickReplySaveError'));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === 'interactive' && qr.interactive_payload) {
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      const body = qr.content_text ?? '';
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight, setText]
  );

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          t('fileTooLarge', {
            size: (file.size / 1024 / 1024).toFixed(1),
            max: Math.round(max / 1024 / 1024),
            kind: t(
              kind === 'image' ? 'photo' : kind === 'audio' ? 'voiceNote' : kind
            ),
          })
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        if (!mounted.current) {
          removeStaged(path, 'upload');
          return;
        }
        const previous = draftRef.current;
        const staged = setDraft({
          kind,
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
          source: 'upload',
        });
        if (staged) removeStaged(previous?.path, previous?.source);
        else removeStaged(path, 'upload');
      } catch {
        if (mounted.current) toast.error(t('uploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, setDraft, t]
  );

  const handlePicked = useCallback(
    (kind: 'image' | 'video' | 'document', file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload]
  );

  // A catalog pick is already hosted publicly (ai-media bucket) — stage
  // it directly as a draft, no upload step, no GC of the shared asset.
  const handlePickCatalogItem = useCallback(
    (item: CatalogPick) => {
      removeStaged(draftRef.current?.path, draftRef.current?.source);
      setDraft({
        kind: item.kind,
        mediaUrl: item.mediaUrl,
        path: item.path,
        filename: item.filename,
        caption: '',
        source: 'catalog',
      });
    },
    [removeStaged, setDraft]
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error(t('recordingTooLarge'));
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        if (!mounted.current) {
          removeStaged(path, 'upload');
          return;
        }
        const previous = draftRef.current;
        const staged = setDraft({
          kind: 'audio',
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
          source: 'upload',
        });
        if (staged) removeStaged(previous?.path, previous?.source);
        else removeStaged(path, 'upload');
      } catch {
        if (mounted.current) toast.error(t('uploadFailed'));
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, setDraft, t]
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error(t('recordingUnavailable'));
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import('opus-recorder');
      if (!mounted.current) return;
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
      if (!mounted.current) {
        cancelledRef.current = true;
        await recorder.stop().catch(() => {});
        return;
      }
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      if (mounted.current) toast.error(t('microphoneUnavailable'));
    }
  }, [inputsDisabled, busy, recording, finalizeRecording, t]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  const sendTemplateDraft = useCallback(
    async (draft: TemplateDraft) => {
      if (deliveryLocked || readOnly || !browserOnline || !onSendTemplate)
        return;
      updateDraft((previous) => ({ ...previous, template: draft }));
      await runOperation('template', (id) => onSendTemplate(draft, id), {
        template: JSON.stringify(draft),
      });
    },
    [
      deliveryLocked,
      readOnly,
      browserOnline,
      onSendTemplate,
      updateDraft,
      runOperation,
    ]
  );

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(async () => {
    if (!draft || busy || inputsDisabled) return;
    await runOperation(
      'media',
      (id) =>
        onSendMedia(
          {
            kind: draft.kind,
            mediaUrl: draft.mediaUrl,
            path: draft.path,
            caption:
              draft.kind === 'audio'
                ? undefined
                : draft.caption.trim() || undefined,
            filename: draft.kind === 'document' ? draft.filename : undefined,
            replyToId: effectiveReply?.id,
            source: draft.source,
          },
          id
        ),
      { path: draft.path, replyId: effectiveReply?.id }
    );
  }, [
    draft,
    busy,
    inputsDisabled,
    runOperation,
    onSendMedia,
    effectiveReply?.id,
  ]);

  // Discard GCs the staged object — it was uploaded but never sent.
  // No-op for a catalog pick (see removeStaged).
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path, draft?.source);
    setDraft(null);
  }, [draft?.path, draft?.source, removeStaged, setDraft]);

  const setCaption = useCallback(
    (caption: string) => {
      setDraft((d) => (d ? { ...d, caption } : d));
    },
    [setDraft]
  );

  // ---- Render --------------------------------------------------------

  return (
    <div
      data-conversation-composer={conversationId}
      className="crm-composer border-border bg-card border-t p-3"
    >
      {effectiveReply && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={effectiveReply.authorLabel}
            preview={effectiveReply.preview}
            onDismiss={clearReply}
          />
        </div>
      )}
      {recovery && (
        <div
          role="status"
          aria-live="polite"
          className="border-border mb-3 rounded-lg border p-3 text-sm"
        >
          <p>
            {t(
              recovery.state === 'sending'
                ? 'sendPending'
                : recovery.state === 'rejected'
                  ? 'sendRejected'
                  : 'sendUnknown'
            )}
          </p>
          {recovery.state === 'rejected' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  readOnly ||
                  !browserOnline ||
                  (sessionExpired && recovery.kind !== 'template')
                }
                onClick={() => {
                  if (recovery.kind === 'template' && savedDraft.template)
                    void sendTemplateDraft(savedDraft.template);
                  else if (recovery.kind === 'media') void sendDraft();
                  else if (recovery.kind === 'interactive')
                    void sendInteractive();
                  else void handleSend();
                }}
              >
                {t('retryFailedMessage')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onDismissOperation?.(recovery.id);
                  updateDraft((previous) => ({ ...previous, recovery: null }));
                  if (recovery.kind === 'template') onOpenTemplates();
                  else if (recovery.kind === 'interactive')
                    setInteractiveOpen(true);
                  else
                    requestAnimationFrame(() => textareaRef.current?.focus());
                }}
              >
                {t('editFailedMessage')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onDismissOperation?.(recovery.id);
                  if (draft && recovery.kind === 'media')
                    removeStaged(draft.path, draft.source);
                  updateDraft((previous) => ({
                    ...previous,
                    recovery: null,
                    text: recovery.kind === 'text' ? '' : previous.text,
                    attachment:
                      recovery.kind === 'media' ? null : previous.attachment,
                    attachmentAt:
                      recovery.kind === 'media' ? null : previous.attachmentAt,
                    interactive:
                      recovery.kind === 'interactive'
                        ? null
                        : previous.interactive,
                    template:
                      recovery.kind === 'template' ? null : previous.template,
                    reply:
                      previous.reply?.id === recovery.original?.replyId
                        ? null
                        : previous.reply,
                  }));
                  onClearReply?.();
                }}
              >
                {t('discardFailedMessage')}
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={checkingSend}
              onClick={checkDelivery}
            >
              {t('checkDelivery')}
            </Button>
          )}
        </div>
      )}
      {(text || draft) && (
        <p
          className="crm-draft-status text-muted-foreground mb-2 text-xs"
          role="status"
        >
          {t(persistent ? 'draftSaved' : 'draftMemory')}
        </p>
      )}
      {suggestion !== null && (
        <section
          className="border-border mb-3 rounded-lg border p-3"
          aria-label={t('suggestionTitle')}
        >
          <p className="mb-2 text-sm font-medium">{t('suggestionTitle')}</p>
          <p
            className="mb-3 max-h-40 overflow-y-auto text-sm whitespace-pre-wrap"
            dir="auto"
          >
            {suggestion}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={deliveryLocked}
              onClick={() => {
                setText(suggestion);
                setSuggestion(null);
                requestAnimationFrame(adjustHeight);
              }}
            >
              {t('replaceDraft')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={deliveryLocked}
              onClick={() => {
                setText((previous) =>
                  previous ? `${previous}\n${suggestion}` : suggestion
                );
                setSuggestion(null);
                requestAnimationFrame(adjustHeight);
              }}
            >
              {t('insertSuggestion')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSuggestion(null)}
            >
              {t('dismissSuggestion')}
            </Button>
          </div>
        </section>
      )}
      {sessionExpired && (
        <div className="crm-session-notice bg-warning/10 mb-2 flex items-center justify-between rounded-lg px-3 py-2">
          <p className="text-warning text-xs">{t('sessionExpiredHint')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="text-warning hover:text-warning h-7 text-xs"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="me-1 h-3 w-3" />
            {t('templates')}
          </Button>
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked('image', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked('video', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked('document', e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {draft ? (
        <MediaDraftPreview
          draft={draft}
          busy={busy || deliveryLocked}
          readOnly={readOnly || sessionExpired}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onSend={sendDraft}
          t={t}
        />
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="border-border bg-muted flex items-center gap-3 rounded-xl border px-4 py-2.5">
          <span className="bg-destructive flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" />
          <span className="text-foreground flex-1 text-sm">
            {t('recording', {
              current: formatDuration(recordSeconds),
              max: formatDuration(MAX_RECORDING_SECONDS),
            })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="text-muted-foreground hover:bg-card hover:text-foreground rounded-md px-2 py-1 text-xs"
          >
            {t('cancel')}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0"
            title={t('stopAndAttach')}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="crm-compose-row flex items-end gap-2">
          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={inputsDisabled || busy}
            onClick={() => setCatalogOpen(true)}
            className="crm-product-library-action text-primary hover:bg-primary/10 h-9 shrink-0 gap-2 rounded-lg px-3"
          >
            <ImageIcon className="h-4 w-4" />
            <span>{t('catalog')}</span>
          </GatedButton>
          {/* New uploads and reply tools are separate from saved product assets. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              aria-label={t('attachMedia')}
              title={
                readOnly
                  ? t('readOnlyTitle')
                  : inputsDisabled
                    ? undefined
                    : t('attachMedia')
              }
              className="text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('uploadFromDevice')}</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="me-2 h-4 w-4" />
                  {t('photo')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => videoInputRef.current?.click()}
                >
                  <Video className="me-2 h-4 w-4" />
                  {t('video')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => documentInputRef.current?.click()}
                >
                  <FileText className="me-2 h-4 w-4" />
                  {t('document')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void startRecording()}>
                  <Mic className="me-2 h-4 w-4" />
                  {t('voiceNote')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('replyTools')}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                  <MessageSquareDashed className="me-2 h-4 w-4" />
                  {t('interactiveMessage')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                  <Zap className="me-2 h-4 w-4" />
                  {t('quickReplies')}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={deliveryLocked || !browserOnline}
            aria-label={t('sendTemplate')}
            title={readOnly ? undefined : t('sendTemplate')}
            className={cn(
              'crm-template-action text-muted-foreground hover:text-foreground h-9 shrink-0 px-2',
              sessionExpired && 'hidden'
            )}
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="h-4 w-4" />
            <span>{t('templates')}</span>
          </GatedButton>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting || inputsDisabled}
            aria-label={t('draftWithAI')}
            title={readOnly ? undefined : t('draftWithAI')}
            className="crm-draft-action text-primary hover:bg-primary/10 h-9 shrink-0 px-3"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span>{t('draftWithAI')}</span>
          </GatedButton>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={translatingDraft || !text.trim() || inputsDisabled}
            aria-label={t('translateDraft')}
            title={readOnly ? undefined : t('translateDraft')}
            className="text-muted-foreground hover:text-primary h-9 w-9 shrink-0 p-0"
            onClick={handleTranslateDraft}
          >
            {translatingDraft ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Languages className="h-4 w-4" />
            )}
          </GatedButton>

          <textarea
            aria-label={t('typeMessagePlaceholder')}
            ref={textareaRef}
            dir="auto"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              readOnly
                ? t('readOnlyPlaceholder')
                : sessionExpired
                  ? t('sessionExpiredPlaceholder')
                  : t('typeMessagePlaceholder')
            }
            disabled={inputsDisabled}
            rows={1}
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t('readOnlyTitle') : t('keyboardHint')}
            className={cn(
              'border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none',
              (sessionExpired || readOnly) && 'cursor-not-allowed opacity-50'
            )}
          />

          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || inputsDisabled || sending}
            aria-label={t('sendMessage')}
            onClick={handleSend}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </GatedButton>
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Indented to line up
          under the textarea left edge. */}
      {!draft && !recording && (
        <p className="crm-draft-hint text-muted-foreground">{t('draftHint')}</p>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('interactiveMessage')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="me-1 h-4 w-4" />
              )}
              {t('saveAsQuickReply')}
            </Button>
            <Button onClick={sendInteractive} disabled={inputsDisabled}>
              <Send className="me-1 h-4 w-4" />
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={templatePickerOpen}
        onOpenChange={(open) => onTemplatePickerOpenChange?.(open)}
        initialDraft={savedDraft.template}
        onSelect={(template, values) =>
          void sendTemplateDraft({
            name: template.name,
            language: template.language ?? 'en_US',
            bodyText: template.body_text,
            values,
          })
        }
      />
      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />

      {/* Product-catalog picker. */}
      <CatalogPickerDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        onPick={handlePickCatalogItem}
      />
    </div>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  t,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="border-border bg-muted/40 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === 'video' && (
            <video
              src={draft.mediaUrl}
              controls
              className="max-h-40 rounded-lg"
            />
          )}
          {draft.kind === 'audio' && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === 'document' && (
            <div className="text-foreground flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          disabled={busy || readOnly}
          aria-label={t('removeAttachment')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {draft.kind !== 'audio' && (
          <input
            value={draft.caption}
            aria-label={t('addCaption')}
            disabled={busy || readOnly}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t('addCaption')}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none"
          />
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          aria-label={t('sendMessage')}
          className={cn(
            'bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40',
            draft.kind === 'audio' && 'ms-auto'
          )}
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}
