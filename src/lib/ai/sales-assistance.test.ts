import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  ask: vi.fn(),
  generate: vi.fn(),
  config: vi.fn(),
}));
vi.mock('./typesafe/client', () => ({
  askJev: h.ask,
  salesAssistanceMode: () => process.env.TYPESAFE_MODE ?? 'enforce',
}));
vi.mock('./typesafe/audit', () => ({ logJevCheck: vi.fn() }));
vi.mock('./admin-client', () => ({ supabaseAdmin: vi.fn() }));
vi.mock('./generate', () => ({ generateReply: h.generate }));
vi.mock('./config', () => ({ loadAiConfig: h.config }));
import {
  parseAssistanceProposal,
  verifyAssistance,
  validFieldValue,
  dispatchSalesAssistance,
} from './sales-assistance';
const tag = '11111111-1111-4111-8111-111111111111',
  field = '22222222-2222-4222-8222-222222222222';
const tags = [
    {
      id: tag,
      name: 'Shutters',
      ai_rule: 'Customer is requesting automatic shutters.',
    },
  ],
  fields = [
    { id: field, name: 'Quantity', scope: 'contact' as const, type: 'number' },
  ];
const statements = [{ id: 'source', text: 'I need 3 shutters.' }];
const proposal = {
  summary: 'Customer needs shutters.',
  action: 'prepare_quote' as const,
  tags: [tag],
  fields: [{ id: field, value: '3', source: 'source' }],
};
function answers(values: Record<string, number>) {
  return {
    answers: Object.fromEntries(
      Object.entries(values).map(([key, noul]) => [key, { type: 'noul', noul }])
    ),
  };
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('TYPESAFE_API_KEY', 'synthetic-verifier-key');
  h.ask.mockReset();
  h.generate.mockReset();
  h.config.mockReset();
  h.ask.mockResolvedValue(
    answers({ brief: 0.99, action: 0.99, tag_0: 0.99, field_0: 0.99 })
  );
});
it('accepts fenced JSON but rejects fabricated action names and invalid shapes', () => {
  expect(
    parseAssistanceProposal('```json\n' + JSON.stringify(proposal) + '\n```')
  ).toEqual(proposal);
  expect(() =>
    parseAssistanceProposal(
      JSON.stringify({ ...proposal, action: 'mark_paid' })
    )
  ).toThrow();
  expect(() =>
    parseAssistanceProposal(
      JSON.stringify({ ...proposal, fields: [{ id: field, value: 4 }] })
    )
  ).toThrow();
});
it('requires known tag/field IDs and verbatim customer evidence', async () => {
  const result = await verifyAssistance(
    {
      ...proposal,
      tags: [tag, tag, 'unknown'],
      fields: [
        ...proposal.fields,
        { id: field, value: '99', source: 'source' },
        { id: 'unknown', value: '3', source: 'source' },
      ],
    },
    tags,
    fields,
    statements
  );
  expect(result.tags).toEqual([
    { id: tag, name: 'Shutters', rule: tags[0].ai_rule },
  ]);
  expect(result.fields).toEqual([
    {
      id: field,
      name: 'Quantity',
      scope: 'contact',
      value: '3',
      source: 'source',
    },
  ]);
  expect(Object.keys(h.ask.mock.calls[0][1])).toEqual([
    'brief',
    'action',
    'tag_0',
    'field_0',
  ]);
});
it('does not capture invented or assistant-only values', async () => {
  const result = await verifyAssistance(
    { ...proposal, fields: [{ id: field, value: '99', source: 'source' }] },
    tags,
    fields,
    statements
  );
  expect(result.fields).toEqual([]);
});
it('filters uncertain tags and unsupported field semantics independently', async () => {
  h.ask.mockResolvedValue(
    answers({ brief: 0.99, action: 0.99, tag_0: 0.7, field_0: 0.2 })
  );
  const result = await verifyAssistance(proposal, tags, fields, statements);
  expect(result.tags).toEqual([]);
  expect(result.fields).toEqual([]);
});
it.each([NaN, Infinity, 1.01, undefined, 0.5])(
  'fails closed on invalid or uncertain brief probability %s',
  async (noul) => {
    h.ask.mockResolvedValue({
      answers: { brief: { noul }, action: { noul: 0.99 } },
    });
    await expect(
      verifyAssistance(proposal, tags, fields, statements)
    ).rejects.toThrow();
  }
);
it('rejects invalid calendar dates and non-numeric number fields', () => {
  expect(validFieldValue('date', '2026-99-99')).toBe(false);
  expect(validFieldValue('date', '2026-02-30')).toBe(false);
  expect(validFieldValue('date', '2026-10-14')).toBe(true);
  expect(validFieldValue('number', 'three shutters')).toBe(false);
  expect(validFieldValue('url', 'javascript:alert(1)')).toBe(false);
});
it('off mode makes no database or provider calls', async () => {
  vi.stubEnv('TYPESAFE_MODE', 'off');
  const db = { from: vi.fn(), rpc: vi.fn() };
  await dispatchSalesAssistance({
    accountId: 'a',
    conversationId: 'c',
    triggerMessageId: 'm',
    db: db as never,
  });
  expect(db.from).not.toHaveBeenCalled();
  expect(h.generate).not.toHaveBeenCalled();
});
it('disabled settings do not claim or generate', async () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { sales_assistance_enabled: false, is_active: true },
    }),
  };
  const db = { from: () => query, rpc: vi.fn() };
  await dispatchSalesAssistance({
    accountId: 'a',
    conversationId: 'c',
    triggerMessageId: 'm',
    db: db as never,
  });
  expect(db.rpc).not.toHaveBeenCalled();
  expect(h.generate).not.toHaveBeenCalled();
});

it.each(
  ['enforce', 'shadow'].flatMap((mode) =>
    ['text', 'location'].map((kind) => [mode, kind])
  )
)(
  'runs internal preparation with auto-reply off and a human owning the chat (%s, %s)',
  async (mode, kind) => {
    vi.stubEnv('TYPESAFE_MODE', mode);
    const query = (data: unknown) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
      };
      return builder;
    };
    const tables: Record<string, unknown> = {
      ai_configs: {
        sales_assistance_enabled: true,
        is_active: true,
        auto_reply_enabled: false,
      },
      conversations: {
        contact_id: 'contact',
        assigned_agent_id: 'human',
        ai_autoreply_disabled: true,
      },
      tags: [],
      messages: [
        {
          message_id: 'source',
          content_text:
            kind === 'location'
              ? 'Office\nhttps://www.google.com/maps?q=25.3,51.5'
              : 'Please send a quotation.',
          content_type: kind,
          sender_type: 'customer',
        },
      ],
      deals: null,
      custom_fields:
        kind === 'location'
          ? [
              {
                id: field,
                field_name: 'Location',
                field_type: 'url',
                ai_collectible: true,
                group_id: null,
              },
            ]
          : [],
    };
    const db = {
      from: vi.fn((table: string) => query(tables[table] ?? [])),
      rpc: vi.fn(async (name: string) => ({
        data:
          name === 'claim_sales_assistance'
            ? 'token'
            : { summary: 'Quotation requested', action: 'prepare_quote' },
        error: null,
      })),
    };
    h.config.mockResolvedValue({ provider: 'openai', model: 'test' });
    h.generate.mockResolvedValue({
      text: JSON.stringify({
        ...proposal,
        tags: [],
        fields:
          kind === 'location'
            ? [
                {
                  id: field,
                  value: 'https://www.google.com/maps?q=25.3,51.5',
                  source: 'source',
                },
              ]
            : [],
      }),
      usage: null,
    });
    await dispatchSalesAssistance({
      accountId: `test-${mode}`,
      conversationId: 'chat',
      triggerMessageId: 'source',
      db: db as never,
    });
    expect(h.generate).toHaveBeenCalledOnce();
    const evidenceQuery =
      db.from.mock.results[
        db.from.mock.calls.findIndex(([table]) => table === 'messages')
      ].value;
    expect(evidenceQuery.in).toHaveBeenCalledWith('content_type', [
      'text',
      'audio',
      'location',
    ]);
    if (kind === 'location') {
      expect(
        JSON.parse(h.generate.mock.calls[0][0].messages[0].content)
          .statements[0]
      ).toMatchObject({
        kind: 'location',
        text: expect.stringContaining(
          'https://www.google.com/maps?q=25.3,51.5'
        ),
      });
      expect(db.rpc).toHaveBeenCalledWith(
        'apply_sales_assistance',
        expect.objectContaining({
          p_analysis: expect.objectContaining({
            fields: [
              expect.objectContaining({
                name: 'Location',
                value: 'https://www.google.com/maps?q=25.3,51.5',
                source: 'source',
              }),
            ],
          }),
        })
      );
    }
    expect(db.rpc).toHaveBeenCalledWith(
      'apply_sales_assistance',
      expect.objectContaining({
        p_apply: mode === 'enforce',
        p_analysis: expect.objectContaining({ action: 'prepare_quote' }),
        p_deal: null,
      })
    );
    expect(db.from.mock.calls.map(([table]) => table)).not.toContain(
      'contact_tags'
    );
  }
);

afterEach(() => vi.unstubAllEnvs());

it('defaults the new workflow to preview without weakening existing reply checks', async () => {
  const { salesAssistanceMode } =
    await vi.importActual<typeof import('./typesafe/client')>(
      './typesafe/client'
    );
  vi.stubEnv('TYPESAFE_MODE', 'enforce');
  vi.stubEnv('TYPESAFE_SALES_ASSISTANCE_MODE', '');
  expect(salesAssistanceMode()).toBe('shadow');
  vi.stubEnv('TYPESAFE_SALES_ASSISTANCE_MODE', 'enforce');
  expect(salesAssistanceMode()).toBe('enforce');
  vi.stubEnv('TYPESAFE_MODE', 'shadow');
  expect(salesAssistanceMode()).toBe('shadow');
  vi.stubEnv('TYPESAFE_MODE', 'off');
  expect(salesAssistanceMode()).toBe('off');
});

it('shares saved details with verification without allowing them as new field sources', async () => {
  const knownFields = [{ name: 'Quantity', value: '8' }];
  const result = await verifyAssistance(
    {
      ...proposal,
      summary: 'Saved quantity is 8.',
      fields: [{ id: field, value: '8', source: 'saved' }],
    },
    tags,
    fields,
    statements,
    undefined,
    [],
    knownFields
  );
  expect(h.ask.mock.calls[0][0]).toMatchObject({ knownFields });
  expect(result.summary).toBe('Saved quantity is 8.');
  expect(result.fields).toEqual([]);
});
