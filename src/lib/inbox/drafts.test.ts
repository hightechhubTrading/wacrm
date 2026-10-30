import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDrafts,
  draftScope,
  draftKey,
  draftEpoch,
  EMPTY_DRAFT,
  writeDraft,
  readDraftSnapshot,
  parseDraft,
  DRAFT_TTL_MS,
  MEDIA_DRAFT_TTL_MS,
} from './drafts';

afterEach(() => {
  clearDrafts();
  vi.unstubAllGlobals();
});
describe('recoverable conversation drafts', () => {
  it('isolates users, tenants and conversations, including delimiter-like IDs', () => {
    const scope = draftScope('account', 'user');
    writeDraft(scope, draftKey(scope, 'A'), draftEpoch(scope), (d) => ({
      ...d,
      text: 'Customer A',
    }));
    expect(parseDraft(readDraftSnapshot(draftKey(scope, 'A'))).text).toBe(
      'Customer A'
    );
    for (const [a, u, c] of [
      ['account', 'user', 'B'],
      ['other', 'user', 'A'],
      ['account', 'other', 'A'],
    ]) {
      expect(readDraftSnapshot(draftKey(draftScope(a, u), c))).toBe('');
    }
    expect(draftScope('a:b', 'c')).not.toBe(draftScope('a', 'b:c'));
  });
  it('expires text after seven days and media after one without extending media on text edits', () => {
    const now = Date.now();
    const draft = {
      ...EMPTY_DRAFT,
      text: 'still useful',
      updatedAt: now,
      attachmentAt: now - MEDIA_DRAFT_TTL_MS,
      attachment: {
        kind: 'image',
        source: 'upload',
        mediaUrl: 'https://example.test/photo',
        path: 'photo',
        filename: 'photo.jpg',
        caption: '',
      },
    };
    expect(parseDraft(JSON.stringify(draft), now)).toMatchObject({
      text: 'still useful',
      attachment: null,
    });
    expect(parseDraft(JSON.stringify(draft), now + DRAFT_TTL_MS)).toBe(
      EMPTY_DRAFT
    );
    expect(parseDraft('{broken')).toBe(EMPTY_DRAFT);
    expect(
      parseDraft(JSON.stringify({ ...draft, updatedAt: now + 1 }), now)
    ).toBe(EMPTY_DRAFT);
  });
  it('invalidates delayed writers on logout and account changes', () => {
    const scope = draftScope('account', 'user'),
      other = draftScope('other', 'user');
    const epoch = draftEpoch(scope),
      otherEpoch = draftEpoch(other);
    const key = draftKey(scope, 'A');
    writeDraft(scope, key, epoch, (d) => ({ ...d, text: 'private' }));
    clearDrafts(scope);
    expect(readDraftSnapshot(key)).toBe('');
    expect(
      writeDraft(scope, key, epoch, (d) => ({ ...d, text: 'late response' }))
    ).toBe(false);
    expect(
      writeDraft(other, draftKey(other, 'A'), otherEpoch, (d) => ({
        ...d,
        text: 'other',
      }))
    ).toBe(true);
    clearDrafts();
    expect(
      writeDraft(other, draftKey(other, 'A'), otherEpoch, (d) => ({
        ...d,
        text: 'late',
      }))
    ).toBe(false);
  });
  it('falls back to current in-memory text when browser storage is full', () => {
    const scope = draftScope('account', 'user'),
      key = draftKey(scope, 'A');
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () =>
          JSON.stringify({
            ...EMPTY_DRAFT,
            text: 'old',
            updatedAt: Date.now(),
          }),
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
      },
    });
    writeDraft(scope, key, draftEpoch(scope), (d) => ({ ...d, text: 'new' }));
    expect(parseDraft(readDraftSnapshot(key)).text).toBe('new');
  });
  it('removes scoped persisted drafts while retaining unrelated settings', () => {
    const scope = draftScope('account', 'user'),
      other = draftScope('other', 'user');
    const values: Record<string, string> = {};
    const store = new Proxy(values, {
      get(target, key) {
        if (key === 'getItem') return (k: string) => target[k] ?? null;
        if (key === 'setItem')
          return (k: string, v: string) => {
            target[k] = v;
          };
        if (key === 'removeItem')
          return (k: string) => {
            delete target[k];
          };
        return target[key as string];
      },
    });
    vi.stubGlobal('window', { localStorage: store });
    values.theme = 'dark';
    writeDraft(scope, draftKey(scope, 'A'), draftEpoch(scope), (d) => ({
      ...d,
      text: 'private',
    }));
    writeDraft(other, draftKey(other, 'A'), draftEpoch(other), (d) => ({
      ...d,
      text: 'other',
    }));
    clearDrafts(scope);
    expect(Object.keys(values)).toEqual(['theme', draftKey(other, 'A')]);
  });
});
