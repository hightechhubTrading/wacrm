import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    account: null as Record<string, unknown> | null,
    admins: [] as { user_id: string }[],
    agentProfile: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    conversationUpdates: [] as Record<string, unknown>[],
    notificationInserts: [] as Record<string, unknown>[],
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      if (table === 'accounts') {
        // .select('business_hours, timezone').eq('id', accountId).maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: h.state.account, error: null }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        // Two shapes used: .select('user_id').eq(...).in('account_role', [...])
        // (admin lookup) and .select('phone').eq('user_id', ...).maybeSingle()
        // (assigned-agent phone lookup).
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: h.state.admins, error: null }),
          maybeSingle: () =>
            Promise.resolve({ data: h.state.agentProfile, error: null }),
        }
        return chain
      }
      if (table === 'notifications') {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            h.state.notificationInserts.push(...rows)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          h.state.conversationUpdates.push(payload)
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    lastKeyError: null,
    lastKeyErrorAt: null,
    transcribeVoiceMessages: false,
    afterHoursTakeoverEnabled: false,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_context_summary: null,
    ai_context_summary_at: null,
    ai_priority: null,
  }
  h.state.account = null
  h.state.admins = []
  h.state.agentProfile = null
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.conversationUpdates = []
  h.state.notificationInserts = []
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and sends only the fixed closing message', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    // The model's own text is never sent on handoff -- only the fixed
    // closing message (never the model's own words) goes out.
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText.mock.calls[0][0]).toMatchObject({
      text: expect.stringContaining('team members will follow up'),
    })
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

const CLOSED_HOURS = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }

describe('dispatchInboundToAiReply — after-hours takeover', () => {
  it('skips a human-assigned conversation when takeover is off', async () => {
    h.state.conv = { ...h.state.conv, assigned_agent_id: 'human-1' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('skips a human-assigned conversation when takeover is on but within business hours', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ afterHoursTakeoverEnabled: true }))
    h.state.conv = { ...h.state.conv, assigned_agent_id: 'human-1' }
    h.state.account = { business_hours: null, timezone: 'UTC' } // null = always open
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('replies to a human-assigned conversation when takeover is on and outside business hours', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ afterHoursTakeoverEnabled: true }))
    h.state.conv = { ...h.state.conv, assigned_agent_id: 'human-1' }
    h.state.account = { business_hours: CLOSED_HOURS, timezone: 'UTC' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('still respects a prior explicit handoff even after hours', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ afterHoursTakeoverEnabled: true }))
    h.state.conv = {
      ...h.state.conv,
      assigned_agent_id: 'human-1',
      ai_autoreply_disabled: true,
    }
    h.state.account = { business_hours: CLOSED_HOURS, timezone: 'UTC' }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — AI priority', () => {
  it('always persists the priority, even "normal"', async () => {
    h.generateReply.mockResolvedValue({
      text: 'Sure!',
      handoff: false,
      priority: 'normal',
      priorityReason: 'routine question',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.conversationUpdates).toContainEqual({
      ai_priority: 'normal',
      ai_priority_reason: 'routine question',
    })
    expect(h.state.notificationInserts).toHaveLength(0)
  })

  it('notifies the assigned agent on a transition into urgent', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ afterHoursTakeoverEnabled: true }))
    h.state.conv = {
      ...h.state.conv,
      assigned_agent_id: 'human-1',
      ai_priority: 'normal',
    }
    h.state.account = { business_hours: CLOSED_HOURS, timezone: 'UTC' }
    h.generateReply.mockResolvedValue({
      text: 'On it',
      handoff: false,
      priority: 'urgent',
      priorityReason: 'threatened to cancel',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toHaveLength(1)
    expect(h.state.notificationInserts[0]).toMatchObject({
      type: 'urgent_lead',
      user_id: 'human-1',
      body: 'threatened to cancel',
    })
  })

  it('falls back to admins when no agent is assigned', async () => {
    h.state.admins = [{ user_id: 'admin-1' }, { user_id: 'admin-2' }]
    h.generateReply.mockResolvedValue({
      text: 'On it',
      handoff: false,
      priority: 'urgent',
      priorityReason: 'high value lead',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toHaveLength(2)
  })

  it('does not re-notify when the conversation is already urgent', async () => {
    h.state.conv = { ...h.state.conv, ai_priority: 'urgent' }
    h.generateReply.mockResolvedValue({
      text: 'Still on it',
      handoff: false,
      priority: 'urgent',
      priorityReason: 'same issue',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.notificationInserts).toHaveLength(0)
  })
})
