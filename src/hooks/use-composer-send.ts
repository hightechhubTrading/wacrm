'use client';

import { useCallback, useRef, useState, type RefObject } from 'react';
import type { ConversationDraft } from '@/lib/inbox/drafts';
import {
  reconcileSend,
  type SendOutcome,
  type SendRecovery,
  type SendDraftSnapshot,
} from '@/lib/inbox/send-outcome';

type Options = {
  recovery: SendRecovery | null;
  updateDraft: (
    change: (previous: ConversationDraft) => ConversationDraft
  ) => boolean;
  mounted: RefObject<boolean>;
  readOnly: boolean;
  sessionExpired: boolean;
  browserOnline: boolean;
  onClearReply?: () => void;
  onDismissOperation?: (id: string) => void;
  onConfirmedOperation?: (
    id: string,
    result: Extract<SendOutcome, { state: 'accepted' }>
  ) => void;
};
/** Coordinates durable recovery without sharing mutable state across conversations. */
export function useComposerSend({
  recovery,
  updateDraft,
  mounted,
  readOnly,
  sessionExpired,
  browserOnline,
  onClearReply,
  onDismissOperation,
  onConfirmedOperation,
}: Options) {
  const [checkingSend, setCheckingSend] = useState(false);
  const inFlight = useRef(false);
  const sending = recovery?.state === 'sending';
  const deliveryLocked = !!recovery && recovery.state !== 'rejected';
  const finishOperation = useCallback(
    (
      id: string,
      kind: SendRecovery['kind'],
      result: SendOutcome,
      original: SendDraftSnapshot = {}
    ) => {
      let matched = false;
      let clearReplyAfter = false;
      const applied = updateDraft((previous) => {
        if (previous.recovery?.id !== id) return previous;
        matched = true;
        const snapshot = previous.recovery.original ?? original;
        clearReplyAfter = previous.reply?.id === snapshot.replyId;
        if (result.state !== 'accepted')
          return {
            ...previous,
            recovery: {
              id,
              kind,
              state: result.state,
              code: result.code,
              original: snapshot,
            },
          };
        return {
          ...previous,
          recovery: null,
          text:
            kind === 'text' && previous.text === snapshot.text
              ? ''
              : previous.text,
          attachment:
            kind === 'media' && previous.attachment?.path === snapshot.path
              ? null
              : previous.attachment,
          attachmentAt:
            kind === 'media' && previous.attachment?.path === snapshot.path
              ? null
              : previous.attachmentAt,
          interactive:
            kind === 'interactive' &&
            JSON.stringify(previous.interactive) === snapshot.interactive
              ? null
              : previous.interactive,
          template:
            kind === 'template' &&
            JSON.stringify(previous.template) === snapshot.template
              ? null
              : previous.template,
          reply: clearReplyAfter ? null : previous.reply,
        };
      });
      if (
        applied &&
        matched &&
        mounted.current &&
        result.state === 'accepted'
      ) {
        if (clearReplyAfter) onClearReply?.();
        onConfirmedOperation?.(id, result);
      }
    },
    [updateDraft, onClearReply, onConfirmedOperation, mounted]
  );

  const runOperation = useCallback(
    async (
      kind: SendRecovery['kind'],
      send: (operationId: string) => Promise<SendOutcome>,
      original: SendDraftSnapshot
    ) => {
      if (
        inFlight.current ||
        deliveryLocked ||
        readOnly ||
        (sessionExpired && kind !== 'template') ||
        !browserOnline
      )
        return;
      inFlight.current = true;
      if (recovery?.state === 'rejected') onDismissOperation?.(recovery.id);
      const id = crypto.randomUUID();
      const stored = updateDraft((previous) => ({
        ...previous,
        recovery: { id, kind, state: 'sending', original },
      }));
      if (!stored) {
        inFlight.current = false;
        return;
      }
      let result: SendOutcome;
      try {
        result = await send(id);
      } catch {
        result = await reconcileSend(id);
      }
      finishOperation(id, kind, result, original);
      inFlight.current = false;
    },
    [
      deliveryLocked,
      readOnly,
      sessionExpired,
      updateDraft,
      finishOperation,
      recovery,
      onDismissOperation,
      browserOnline,
    ]
  );

  const checkDelivery = useCallback(async () => {
    if (!recovery || checkingSend || recovery.code === 'operation_conflict')
      return;
    setCheckingSend(true);
    const result = await reconcileSend(recovery.id);
    finishOperation(recovery.id, recovery.kind, result);
    if (mounted.current) setCheckingSend(false);
  }, [recovery, checkingSend, finishOperation, mounted]);

  return { sending, deliveryLocked, checkingSend, runOperation, checkDelivery };
}
