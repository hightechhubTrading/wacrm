import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { ThreadPreviewCache } from './thread-previews';
const message = (id: string) => ({ id }) as Message;
describe('recent thread previews', () => {
  it('retains only the latest 50 messages, including known-empty threads', () => {
    const cache = new ThreadPreviewCache();
    cache.set(
      'chat',
      Array.from({ length: 120 }, (_, i) => message(String(i)))
    );
    expect(cache.get('chat')?.map((row) => row.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 70))
    );
    cache.set('empty', []);
    expect(cache.get('empty')).toEqual([]);
  });
  it('evicts the least recently used preview to bound memory', () => {
    const cache = new ThreadPreviewCache(2);
    cache.set('a', [message('a')]);
    cache.set('b', [message('b')]);
    cache.get('a');
    cache.set('c', [message('c')]);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual([message('a')]);
    expect(cache.get('c')).toEqual([message('c')]);
  });
  it('expires old previews and does not share data between cache instances', () => {
    const cache = new ThreadPreviewCache(10, 1000);
    cache.set('chat', [message('a')], 100);
    expect(cache.get('chat', 1099)).toBeDefined();
    expect(cache.get('chat', 1100)).toBeUndefined();
    cache.set('chat', [message('b')]);
    expect(new ThreadPreviewCache().get('chat')).toBeUndefined();
  });
});
