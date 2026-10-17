import { describe, expect, it } from 'vitest';
import type { CallRecord } from './types';
import { sameCalls } from './snapshots';
const call = { id: 'call-1', state: 'ringing', remote_sdp: null } as CallRecord;
describe('call polling snapshots', () => {
  it('recognizes idle polls and unchanged snapshots', () => {
    expect(sameCalls([], [])).toBe(true);
    expect(sameCalls([call], [{ ...call }])).toBe(true);
  });
  it('publishes incoming calls, transitions and remote SDP updates', () => {
    expect(sameCalls([], [call])).toBe(false);
    expect(sameCalls([call], [])).toBe(false);
    expect(sameCalls([call], [{ ...call, state: 'active' }])).toBe(false);
    expect(sameCalls([call], [{ ...call, remote_sdp: 'answer' }])).toBe(false);
    expect(sameCalls([call], [{ ...call, agent_user_id: 'agent-1' }])).toBe(
      false
    );
  });
});
