/** Local synthetic Supabase transport for production Next UI checks.
 * This is a fixture, not an authentication or PostgREST implementation.
 * Database semantics and RLS are verified separately by check-*-db.mjs. */
import http from 'node:http';
import { createRequire } from 'node:module';
import { createCipheriv, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('next/dist/compiled/ws');
export const fixtureIds = {
  account: '10000000-0000-0000-0000-000000000001',
  user: '20000000-0000-0000-0000-000000000001',
  profile: '30000000-0000-0000-0000-000000000001',
  pipeline: '40000000-0000-0000-0000-000000000001',
};
const uuid = (prefix, n) =>
  `${prefix}000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const fixtureEncryptionKey = '0'.repeat(64);
function encryptedToken() {
  const iv = randomBytes(12),
    cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(fixtureEncryptionKey, 'hex'),
      iv
    );
  return `${iv.toString('hex')}:${Buffer.concat([cipher.update('synthetic-token'), cipher.final()]).toString('hex')}:${cipher.getAuthTag().toString('hex')}`;
}
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString();
export async function startSupabaseFixture({
  latency = 25,
  size = 1500,
  port = 0,
} = {}) {
  const { account, user, profile, pipeline } = fixtureIds;
  const userRecord = {
    id: user,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'fixture@example.test',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Fixture operator' },
    created_at: iso(-86400000),
    updated_at: iso(),
  };
  const profiles = [
    {
      id: profile,
      user_id: user,
      account_id: account,
      account_role: 'owner',
      role: 'admin',
      full_name: 'Fixture operator',
      email: 'fixture@example.test',
      avatar_url: null,
      phone: null,
      beta_features: [],
      theme: 'violet',
      mode: 'light',
      locale: 'en',
      created_at: iso(-86400000),
    },
  ];
  const tags = [0, 1, 2].map((n) => ({
    id: uuid('7', n + 1),
    account_id: account,
    user_id: user,
    name: `Family ${n + 1}`,
    color: ['#8b5cf6', '#0284c7', '#059669'][n],
    created_at: iso(-86400000),
  }));
  const contacts = Array.from({ length: size }, (_, n) => ({
    id: uuid('6', n + 1),
    account_id: account,
    user_id: user,
    name: `Fixture Customer ${n + 1}`,
    phone: `+1555${String(n + 1).padStart(7, '0')}`,
    company: n % 2 ? 'Fixture Company' : null,
    email: null,
    avatar_url: null,
    opted_out: false,
    created_at: iso(-86400000),
    updated_at: iso(),
  }));
  const conversations = contacts.map((c, n) => ({
    id: uuid('8', n + 1),
    account_id: account,
    user_id: user,
    contact_id: c.id,
    status: 'open',
    assigned_agent_id: n % 3 ? user : null,
    last_message_text: `Fixture customer message ${n + 1}`,
    last_message_at: iso(-n * 1000 - 3600000),
    unread_count: n % 2,
    created_at: iso(-86400000),
    updated_at: iso(),
    ai_autoreply_disabled: true,
    ai_reply_count: 0,
    ai_priority: n % 20 === 0 ? 'urgent' : 'normal',
    ai_priority_reason: null,
    ai_context_summary: null,
    ai_context_summary_at: null,
    ai_handoff_summary: null,
    ad_source_id: null,
    ad_headline: null,
    ad_clicked_at: null,
  }));
  const stages = Array.from({ length: 6 }, (_, n) => ({
    id: uuid('5', n + 1),
    pipeline_id: pipeline,
    user_id: user,
    name: `Stage ${n + 1}`,
    position: n,
    color: '#8b5cf6',
    created_at: iso(-86400000),
  }));
  const deals = contacts.map((c, n) => ({
    id: uuid('9', n + 1),
    account_id: account,
    user_id: user,
    pipeline_id: pipeline,
    stage_id: stages[n % 6].id,
    contact_id: c.id,
    conversation_id: conversations[n].id,
    assigned_to: profile,
    title: `Fixture Deal ${n + 1}`,
    notes: `Editor notes for ${n + 1}`,
    value: 100,
    currency: 'QAR',
    status: 'open',
    expected_close_date: null,
    created_at: iso(-n * 1000 - 86400000),
    updated_at: iso(-n * 1000),
  }));
  const messages = conversations.flatMap((c, n) =>
    Array.from({ length: n === 0 ? 600 : n === 1 ? 50 : 1 }, (_, i) => ({
      id: uuid('a', n * 1000 + i + 1),
      message_id: `fixture-message-${n}-${i}`,
      conversation_id: c.id,
      sender_type: i % 2 === 0 ? 'agent' : 'customer',
      sender_id: i % 2 === 0 ? user : null,
      content_type: 'text',
      content_text: `Fixture transcript ${n + 1} message ${i + 1}`,
      status: 'delivered',
      created_at: iso(
        -3600000 - (n === 0 ? 600 : n === 1 ? 50 : 1) * 60000 + i * 60000
      ),
      media_url: null,
      media_caption: null,
      reply_to_message_id: null,
      ai_generated: false,
    }))
  );
  messages.find(
    (message) =>
      message.conversation_id === conversations[0].id &&
      message.content_text.endsWith('message 600')
  ).reply_to_message_id = messages.find(
    (message) => message.conversation_id === conversations[0].id
  ).id;
  const quotations = contacts.map((c, n) => ({
    id: uuid('b', n + 1),
    account_id: account,
    reference: `FIX-26-${String(n + 1).padStart(4, '0')}`,
    revision: 1,
    status: 'draft',
    client_name: c.name,
    client_phone: c.phone,
    client_company: c.company,
    project_name: null,
    location: null,
    subject: null,
    currency: 'QAR',
    contact_id: c.id,
    deal_id: deals[n].id,
    assigned_to: profile,
    subtotal: 100,
    discount_type: null,
    discount_value: 0,
    discount_amount: 0,
    total: 100,
    valid_until: null,
    pdf_storage_path: null,
    created_at: iso(-n * 1000),
    updated_at: iso(-n * 1000),
  }));
  const tables = {
    profiles,
    accounts: [
      {
        id: account,
        name: 'Fixture Workspace',
        default_currency: 'QAR',
        owner_user_id: user,
      },
    ],
    pipelines: [
      {
        id: pipeline,
        account_id: account,
        user_id: user,
        name: 'Fixture Pipeline',
        created_at: iso(-86400000),
      },
    ],
    pipeline_stages: stages,
    contacts,
    conversations,
    deals,
    messages,
    tags,
    quotations,
    contact_tags: contacts
      .filter((_, n) => n % 3 === 0)
      .map((c, n) => ({ contact_id: c.id, tag_id: tags[n % 3].id })),
    whatsapp_config: [
      {
        id: uuid('c', 1),
        account_id: account,
        user_id: user,
        status: 'connected',
        phone_number_id: 'fixture-number',
        phone_number: '+15550000000',
        business_account_id: 'fixture-business',
        access_token: encryptedToken(),
        calling_enabled: true,
      },
    ],
    member_presence: [],
    quotation_product_codes: [
      {
        account_id: account,
        code: 'FIX',
        label: 'Fixture',
        active: true,
        position: 0,
      },
    ],
    notifications: [],
    whatsapp_calls: [],
    ai_configs: [],
    ai_sales_assistance: [],
    ai_followups: [],
    group_handoffs: [],
    contact_notes: [],
    contact_custom_values: [],
    custom_fields: [],
    custom_field_groups: [],
    message_reactions: [],
    message_translations: [],
    message_templates: [],
    broadcasts: [],
    automations: [],
    automation_logs: [],
    account_invitations: [],
    quick_replies: [],
    catalog_items: [],
  };
  const requests = [],
    subscriptions = new Map();
  let binding = 0;
  const hydratedContact = (id) => {
    const c = contacts.find((row) => row.id === id);
    return c
      ? {
          ...c,
          tags: tables.contact_tags
            .filter((link) => link.contact_id === id)
            .map((link) => tags.find((t) => t.id === link.tag_id)),
          contact_tags: tables.contact_tags
            .filter((link) => link.contact_id === id)
            .map((link) => ({ tags: tags.find((t) => t.id === link.tag_id) })),
          contact_custom_values: [],
        }
      : null;
  };
  const hydratedConversation = (c) => ({
    ...c,
    contact: hydratedContact(c.contact_id),
  });
  const hydratedDeal = (d) => ({
    ...d,
    contact: hydratedContact(d.contact_id),
    assignee: profiles[0],
    customerConversationId: d.conversation_id,
    conversationOwner: {
      userId: conversations.find((c) => c.id === d.conversation_id)
        ?.assigned_agent_id,
      profileId: profile,
      fullName: profiles[0].full_name,
      avatarUrl: null,
    },
    aiSummary: null,
  });
  function inbox(args) {
    let base = conversations.filter(
      (c) =>
        !args.p_search ||
        `${hydratedContact(c.contact_id)?.name} ${hydratedContact(c.contact_id)?.phone} ${c.last_message_text}`
          .toLowerCase()
          .includes(args.p_search.toLowerCase())
    );
    if (args.p_agent)
      base = base.filter((c) =>
        args.p_agent === '__unassigned__'
          ? !c.assigned_agent_id
          : c.assigned_agent_id === args.p_agent
      );
    if (args.p_company)
      base = base.filter(
        (c) => hydratedContact(c.contact_id)?.company === args.p_company
      );
    if (args.p_tags?.length)
      base = base.filter((c) =>
        hydratedContact(c.contact_id)?.tags.some((t) =>
          args.p_tags.includes(t.id)
        )
      );
    const counts = {
      all: base.length,
      unread: base.filter((c) => c.unread_count > 0).length,
      mine: base.filter((c) => c.assigned_agent_id === user).length,
      open: base.length,
      pending: 0,
      closed: 0,
      priority: base.filter((c) => c.ai_priority === 'urgent').length,
      unassigned: base.filter((c) => !c.assigned_agent_id).length,
      needs_reply: base.length,
      followup_today: 0,
    };
    let filtered = base.filter(
      (c) =>
        !args.p_view ||
        args.p_view === 'all' ||
        args.p_view === 'open' ||
        args.p_view === 'needs_reply' ||
        (args.p_view === 'unread' && c.unread_count > 0) ||
        (args.p_view === 'mine' && c.assigned_agent_id === user) ||
        (args.p_view === 'priority' && c.ai_priority === 'urgent')
    );
    filtered.sort((a, b) =>
      args.p_sort === 'oldest'
        ? a.last_message_at.localeCompare(b.last_message_at)
        : args.p_sort === 'priority'
          ? Number(b.ai_priority === 'urgent') -
              Number(a.ai_priority === 'urgent') ||
            Number(b.unread_count > 0) - Number(a.unread_count > 0) ||
            b.last_message_at.localeCompare(a.last_message_at)
          : b.last_message_at.localeCompare(a.last_message_at)
    );
    const offset = args.p_cursor?.kt ?? 0,
      items = filtered.slice(offset, offset + (args.p_limit || 50));
    return {
      items: args.p_metadata_only ? [] : items.map(hydratedConversation),
      total: filtered.length,
      counts,
      companies: ['Fixture Company'],
      nextCursor:
        offset + items.length < filtered.length
          ? { k1: 0, k2: 0, kt: offset + items.length, id: items.at(-1).id }
          : null,
    };
  }
  function pipelinePage(args) {
    const f = args.p_filters || {};
    let candidates = deals.filter(
      (d) =>
        (!f.query ||
          `${d.title} ${hydratedContact(d.contact_id)?.name} ${d.notes}`
            .toLowerCase()
            .includes(f.query.toLowerCase())) &&
        (!f.status || f.status === 'all' || f.status === d.status) &&
        (!f.stage || d.stage_id === f.stage)
    );
    const filtered = candidates.filter(
      (d) =>
        !f.tag ||
        (f.tag === '__untagged__'
          ? !hydratedContact(d.contact_id)?.tags.length
          : hydratedContact(d.contact_id)?.tags.some((t) => t.id === f.tag))
    );
    const stageCounts = Object.fromEntries(
      stages.map((s) => [
        s.id,
        filtered.filter((d) => d.stage_id === s.id).length,
      ])
    );
    const stagePages = Object.fromEntries(
      stages.map((s) => [
        s.id,
        Math.min(
          args.p_stage_pages?.[s.id] || 0,
          Math.max(0, Math.ceil(stageCounts[s.id] / 6) - 1)
        ),
      ])
    );
    const pageSize =
        args.p_view === 'list' ? 25 : args.p_view === 'export' ? 100 : 6,
      page = Math.min(
        args.p_page || 0,
        Math.max(0, Math.ceil(filtered.length / pageSize) - 1)
      );
    const items =
      args.p_view === 'board'
        ? stages.flatMap((s) =>
            filtered
              .filter((d) => d.stage_id === s.id)
              .slice(stagePages[s.id] * 6, (stagePages[s.id] + 1) * 6)
          )
        : filtered.slice(page * pageSize, (page + 1) * pageSize);
    const tagGroups = tags.map((tag) => ({
      id: tag.id,
      tag,
      total: candidates.filter((d) =>
        hydratedContact(d.contact_id)?.tags.some((t) => t.id === tag.id)
      ).length,
      open: 1,
      overdue: 0,
    }));
    tagGroups.push({
      id: '__untagged__',
      tag: null,
      total: candidates.filter(
        (d) => !hydratedContact(d.contact_id)?.tags.length
      ).length,
      open: 1,
      overdue: 0,
    });
    return {
      items: items.map(hydratedDeal),
      total: filtered.length,
      pipelineTotal: deals.length,
      page,
      stageCounts,
      stagePages,
      summary: { open: filtered.length, won: 0, overdue: 0, unassigned: 0 },
      tagSummary: {
        total: candidates.length,
        open: candidates.length,
        overdue: 0,
      },
      tags,
      owners: [[profile, profiles[0].full_name]],
      tagGroups,
    };
  }
  function rpc(name, args) {
    if (name === 'account_profile')
      return { profile: profiles[0], account: tables.accounts[0] };
    if (name === 'inbox_list') return inbox(args);
    if (name === 'pipeline_list') return pipelinePage(args);
    if (name === 'inbox_sales_context')
      return (args.p_ids || []).map((id) => ({
        conversation_id: id,
        last_sender: 'customer',
        followups: [],
        work: [],
      }));
    if (name === 'sales_today_replies')
      return {
        items: conversations.slice(0, 5).map(hydratedConversation),
        count: size,
      };
    if (name === 'dashboard_metrics')
      return {
        activeConversations: { current: size, previous: 0 },
        newContactsToday: { current: 0, previous: size },
        openDealsCount: size,
        openDealsValue: size * 100,
        messagesSentToday: { current: 300, previous: 0 },
      };
    if (name === 'dashboard_message_series')
      return Array.from({ length: args.p_days }, (_, i) => ({
        day: new Date(Date.parse(args.p_start) + i * 86400000)
          .toISOString()
          .slice(0, 10),
        incoming: i === args.p_days - 1 ? size : 0,
        outgoing: 0,
      }));
    if (name === 'dashboard_pipeline_summary')
      return {
        stages: stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          dealCount: size / 6,
          totalValue: (size / 6) * 100,
        })),
        totalValue: size * 100,
      };
    if (name === 'dashboard_response_time')
      return {
        buckets: Array.from({ length: 7 }, (_, dow) => ({
          dow,
          avgMinutes: 5,
          samples: 10,
        })),
        thisWeekAvg: 5,
        lastWeekAvg: null,
      };
    return [];
  }
  function matches(row, key, expression) {
    const dot = expression.indexOf('.'),
      op = expression.slice(0, dot),
      value = expression.slice(dot + 1),
      actual = row[key];
    if (op === 'eq') return String(actual) === value;
    if (op === 'neq') return String(actual) !== value;
    if (op === 'is')
      return value === 'null' ? actual == null : String(actual) === value;
    if (op === 'in')
      return value
        .slice(1, -1)
        .split(',')
        .map((v) => v.replaceAll('"', ''))
        .includes(String(actual));
    if (op === 'gt') return actual > value;
    if (op === 'gte') return actual >= value;
    if (op === 'lt') return actual < value;
    if (op === 'lte') return actual <= value;
    return true;
  }
  function clauses(value) {
    const result = [];
    let depth = 0,
      quoted = false,
      escaped = false,
      start = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\' && quoted) {
        escaped = true;
        continue;
      }
      if (c === '"') {
        quoted = !quoted;
        continue;
      }
      if (!quoted) {
        if (c === '(') depth++;
        if (c === ')') depth--;
        if (c === ',' && depth === 0) {
          result.push(value.slice(start, i));
          start = i + 1;
        }
      }
    }
    result.push(value.slice(start));
    return result;
  }
  function predicate(row, value) {
    for (const op of ['and', 'or'])
      if (value.startsWith(op + '(') && value.endsWith(')')) {
        const children = clauses(value.slice(op.length + 1, -1));
        return op === 'and'
          ? children.every((child) => predicate(row, child))
          : children.some((child) => predicate(row, child));
      }
    const match = value.match(
      /^([a-zA-Z0-9_]+)\.(eq|neq|lt|lte|gt|gte|is|in|ilike)\.(.*)$/
    );
    if (!match) return true;
    let literal = match[3];
    try {
      if (literal.startsWith('"')) literal = JSON.parse(literal);
    } catch {}
    if (match[2] === 'ilike')
      return String(row[match[1]] ?? '')
        .toLowerCase()
        .includes(literal.replace(/^%|%$/g, '').toLowerCase());
    return matches(row, match[1], match[2] + '.' + literal);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,HEAD,POST,PATCH,DELETE,OPTIONS'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const url = new URL(req.url, 'http://fixture'),
      entry = { path: url.pathname, method: req.method, started: Date.now() };
    requests.push(entry);
    let body = '';
    for await (const part of req) body += part;
    let input = {};
    try {
      input = body ? JSON.parse(body) : {};
    } catch {}
    if (latency) await new Promise((resolve) => setTimeout(resolve, latency));
    const send = (value, status = 200) => {
      const serialized = JSON.stringify(value);
      entry.bytes = req.method === 'HEAD' ? 0 : Buffer.byteLength(serialized);
      entry.durationMs = Date.now() - entry.started;
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(status);
      res.end(req.method === 'HEAD' ? undefined : serialized);
    };
    if (url.pathname === '/auth/v1/user') return send(userRecord);
    if (url.pathname === '/auth/v1/token') return send(session());
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      entry.rpc = input;
      return send(rpc(url.pathname.split('/').at(-1), input));
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      let source = tables[table] || [];
      let rows = source.filter((row) =>
        [...url.searchParams].every(
          ([key, value]) =>
            ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(
              key
            ) ||
            (key === 'or' || key === 'and'
              ? predicate(row, key + value)
              : matches(row, key, value))
        )
      );
      if (req.method === 'PATCH') {
        for (const row of rows) Object.assign(row, input);
        return send(
          req.headers.prefer?.includes('return=representation') ? rows : null
        );
      }
      if (req.method === 'POST') {
        const inserted = Array.isArray(input) ? input : [input];
        if (table === 'member_presence') tables[table] = inserted;
        return send(
          req.headers.prefer?.includes('return=representation')
            ? inserted
            : null,
          201
        );
      }
      if (req.method === 'DELETE') return send(null);
      const order = url.searchParams.get('order');
      if (order) {
        const parts = order.split(',');
        rows.sort((a, b) => {
          for (const part of parts) {
            const [key, direction] = part.split('.');
            const delta = String(a[key] ?? '').localeCompare(
              String(b[key] ?? '')
            );
            if (delta) return direction === 'desc' ? -delta : delta;
          }
          return 0;
        });
      }
      const total = rows.length,
        offset = Number(url.searchParams.get('offset') || 0),
        limit = Math.min(Number(url.searchParams.get('limit') || 1000), 1000);
      rows = rows.slice(offset, offset + limit);
      if (table === 'conversations') rows = rows.map(hydratedConversation);
      if (table === 'deals') rows = rows.map(hydratedDeal);
      if (table === 'contact_tags')
        rows = rows.map((link) => ({
          ...link,
          tags: tags.find((tag) => tag.id === link.tag_id),
        }));
      if (
        table === 'messages' &&
        url.searchParams.get('select')?.includes('conversations(')
      )
        rows = rows.map((row) => ({
          ...row,
          conversations: hydratedConversation(
            conversations.find((c) => c.id === row.conversation_id)
          ),
        }));
      res.setHeader(
        'Content-Range',
        total ? `${offset}-${offset + rows.length - 1}/${total}` : `*/0`
      );
      if (req.headers.accept?.includes('vnd.pgrst.object+json'))
        return rows.length === 1
          ? send(rows[0])
          : send({ code: 'PGRST116', message: 'Expected one row' }, 406);
      return send(rows);
    }
    return send({ error: 'Unknown fixture endpoint' }, 404);
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => {
    subscriptions.set(socket, new Map());
    socket.on('message', (buffer, isBinary) => {
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(String(buffer));
      } catch {
        return;
      }
      const [joinRef, ref, topic, event, payload] = Array.isArray(message)
        ? message
        : [
            message.join_ref,
            message.ref,
            message.topic,
            message.event,
            message.payload,
          ];
      const send = (event, payload) =>
        socket.send(JSON.stringify([joinRef, ref, topic, event, payload]));
      if (event === 'phx_join') {
        const changes = (payload?.config?.postgres_changes || []).map(
          (filter) => ({ ...filter, id: ++binding })
        );
        subscriptions.get(socket).set(topic, { joinRef, changes });
        send('phx_reply', {
          status: 'ok',
          response: { postgres_changes: changes },
        });
      } else if (event === 'heartbeat' || event === 'phx_leave')
        send('phx_reply', { status: 'ok', response: {} });
    });
    socket.on('close', () => subscriptions.delete(socket));
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function session() {
    const encode = (value) =>
        Buffer.from(JSON.stringify(value)).toString('base64url'),
      exp = Math.floor(Date.now() / 1000) + 3600;
    return {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user, role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600, iss: origin + '/auth/v1', email: userRecord.email })}.fixture-signature`,
      refresh_token: 'fixture-refresh',
      expires_in: 3600,
      expires_at: exp,
      token_type: 'bearer',
      user: userRecord,
    };
  }
  return {
    origin,
    requests,
    tables,
    session,
    ids: fixtureIds,
    emit(table, type, row, old = {}) {
      for (const [socket, channels] of subscriptions)
        for (const [topic, channel] of channels) {
          const ids = channel.changes
            .filter(
              (filter) =>
                filter.table === table &&
                (filter.event === '*' || filter.event === type)
            )
            .map((filter) => filter.id);
          if (ids.length)
            socket.send(
              JSON.stringify([
                channel.joinRef,
                null,
                topic,
                'postgres_changes',
                {
                  ids,
                  data: {
                    schema: 'public',
                    table,
                    type,
                    record: row,
                    old_record: old,
                    columns: Object.keys(row).map((name) => ({
                      name,
                      type: 'text',
                    })),
                    commit_timestamp: iso(),
                    errors: [],
                  },
                },
              ])
            );
        }
    },
    disconnectRealtime() {
      for (const socket of wss.clients) socket.close(1012, 'fixture reconnect');
    },
    get subscriptions() {
      return [...subscriptions.values()].reduce(
        (n, channels) => n + channels.size,
        0
      );
    },
    async close() {
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
