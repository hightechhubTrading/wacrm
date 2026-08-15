import { describe, expect, it, vi, beforeEach } from 'vitest';

// resolveConversationByPhone's real return shape is
// `{ conversationId, contactId, contactCreated }` (see
// src/lib/whatsapp/resolve-conversation.ts) — not `{ id, accountId }`.
// Mocked here with the real field names so this test would catch the
// route reading the wrong property, which `/inbox?c=undefined` in
// production would not otherwise surface until a rep clicked "Send".
//
// vi.hoisted() (not a bare top-level const) because vi.mock() factories
// are hoisted above every other top-level statement, including consts
// that textually precede them — see src/lib/quotations/pdf.test.ts.
const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveConversationByPhone: vi.fn().mockResolvedValue({
    conversationId: 'conv-1',
    contactId: 'contact-1',
    contactCreated: false,
  }),
}));

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: h.resolveConversationByPhone,
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 401 }),
}));

import { POST } from './route';

const resolveConversationByPhone = h.resolveConversationByPhone;

beforeEach(() => {
  vi.clearAllMocks();
  resolveConversationByPhone.mockResolvedValue({
    conversationId: 'conv-1',
    contactId: 'contact-1',
    contactCreated: false,
  });
});

function fakeSupabase(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }) }),
    },
  };
}

describe('POST /api/quotations/[id]/send', () => {
  it('resolves the conversation and returns an inbox deep link, without sending anything itself', async () => {
    const supabase = fakeSupabase({
      id: 'q-1', account_id: 'acc-1', reference: 'HT-26-RSD-015',
      client_name: 'Ahmed', client_phone: '+97455509200', pdf_storage_path: 'q-1/rev-0.pdf',
    });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });

    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    const body = await res.json();

    expect(resolveConversationByPhone).toHaveBeenCalledWith(
      supabase, 'acc-1', '+97455509200', 'Ahmed',
    );
    expect(body.inboxUrl).toBe('/inbox?c=conv-1');
    expect(body.pdfUrl).toContain('q-1/rev-0.pdf');
    expect(res.status).toBe(200);
  });

  it('returns 400 if no PDF has been generated yet', async () => {
    const supabase = fakeSupabase({ id: 'q-1', pdf_storage_path: null });
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 if the quotation is not visible to the caller', async () => {
    const supabase = fakeSupabase(null);
    h.requireRole.mockResolvedValue({ accountId: 'acc-1', supabase });
    const req = new Request('http://test', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(404);
  });
});
