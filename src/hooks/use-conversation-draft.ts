'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  isDraftPersisted,
  draftEpoch,
  draftKey,
  parseDraft,
  readDraftSnapshot,
  subscribeDrafts,
  writeDraft,
  type ConversationDraft,
} from '@/lib/inbox/drafts';

/** Mounted beneath an identity/conversation key; writes cannot survive an auth reset. */
export function useConversationDraft(scope: string, conversationId: string) {
  const key = draftKey(scope, conversationId);
  const [epoch] = useState(() => draftEpoch(scope));
  const getSnapshot = useCallback(() => readDraftSnapshot(key), [key]);
  const raw = useSyncExternalStore(subscribeDrafts, getSnapshot, () => '');
  const draft = useMemo(() => parseDraft(raw), [raw]);
  const update = useCallback(
    (change: (previous: ConversationDraft) => ConversationDraft) =>
      writeDraft(scope, key, epoch, change),
    [scope, key, epoch]
  );
  return { draft, update, persistent: isDraftPersisted(key) };
}
