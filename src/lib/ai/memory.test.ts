import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConversationMemory, memoryPrompt } from './memory';
const h = vi.hoisted(() => ({ context: vi.fn(), work: vi.fn() }));
vi.mock('./context', () => ({ buildConversationContext: h.context }));
vi.mock('./followups', () => ({ loadFollowups: h.work }));
describe('source-backed conversation memory', () => {
  it('preserves older customer corrections with source IDs and excludes assistant guesses and image observations', async () => {
    h.context.mockResolvedValue([
      { role: 'assistant', content: 'Five windows', sourceMessageId: 'bot' },
      {
        role: 'user',
        content: 'Four windows\n[Image: a mansion]',
        sourceMessageId: 'old',
      },
      {
        role: 'user',
        content: 'Actually five including stairs',
        sourceMessageId: 'new',
      },
      {
        role: 'user',
        content: '[File sent: plan.dwg]',
        sourceMessageId: 'file',
      },
    ]);
    h.work.mockResolvedValue([]);
    const memory = await loadConversationMemory(
      {} as SupabaseClient,
      'a',
      'c',
      [
        {
          role: 'user',
          content: 'Actually five including stairs',
          sourceMessageId: 'new',
        },
      ]
    );
    expect(memory.statements).toEqual([
      { source: 'old', text: 'Four windows' },
    ]);
    expect(memoryPrompt(memory)).toContain(
      'latest explicit customer correction'
    );
  });
  it('does not convert summaries, unavailable media or receipts into factual statements', async () => {
    h.context.mockResolvedValue([
      {
        role: 'user',
        content: '[Audio received; not transcribed]',
        sourceMessageId: 'audio',
      },
      {
        role: 'user',
        content: '[Extracted document text: confidential]',
        sourceMessageId: 'doc',
      },
    ]);
    h.work.mockResolvedValue([]);
    expect(
      (await loadConversationMemory({} as SupabaseClient, 'a', 'c', []))
        .statements
    ).toEqual([]);
  });
});
