import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForConnection, waitForIce } from './webrtc';

class Peer extends EventTarget {
  iceGatheringState = 'gathering';
  connectionState = 'new';
  localDescription = { sdp: 'complete-audio-sdp' };
  asRtc() {
    return this as unknown as RTCPeerConnection;
  }
}
afterEach(() => vi.useRealTimers());
describe('non-trickle WebRTC signaling', () => {
  it('waits for complete candidate gathering before sending SDP', async () => {
    const peer = new Peer();
    const ready = vi.fn();
    const result = waitForIce(peer.asRtc()).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    peer.iceGatheringState = 'complete';
    peer.dispatchEvent(new Event('icegatheringstatechange'));
    await result;
    expect(ready).toHaveBeenCalledWith('complete-audio-sdp');
  });
  it('times out gathering without submitting an incomplete offer', async () => {
    vi.useFakeTimers();
    const result = expect(waitForIce(new Peer().asRtc(), 100)).rejects.toThrow(
      'audio route'
    );
    await vi.advanceTimersByTimeAsync(101);
    await result;
  });
  it('waits for the media connection before accepting an incoming call', async () => {
    const peer = new Peer();
    const result = waitForConnection(peer.asRtc());
    peer.connectionState = 'connected';
    peer.dispatchEvent(new Event('connectionstatechange'));
    await expect(result).resolves.toBeUndefined();
  });
  it('rejects a failed connection', async () => {
    const peer = new Peer();
    const result = waitForConnection(peer.asRtc());
    peer.connectionState = 'failed';
    peer.dispatchEvent(new Event('connectionstatechange'));
    await expect(result).rejects.toThrow('connection failed');
  });
});
