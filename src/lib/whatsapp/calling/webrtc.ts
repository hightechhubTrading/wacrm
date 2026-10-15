// Meta exchanges one complete SDP, without a separate trickle-ICE endpoint.
export function waitForIce(
  peer: RTCPeerConnection,
  timeoutMs = 45_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (peer.iceGatheringState !== 'complete') return;
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', finish);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) reject(new Error('No local audio description.'));
      else resolve(sdp);
    };
    const timer = setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', finish);
      reject(
        new Error(
          'Could not establish an audio route. Check your network or TURN configuration.'
        )
      );
    }, timeoutMs);
    peer.addEventListener('icegatheringstatechange', finish);
    finish();
  });
}
export function waitForConnection(
  peer: RTCPeerConnection,
  timeoutMs = 18_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (peer.connectionState === 'connected') {
        cleanup();
        resolve();
      } else if (['failed', 'closed'].includes(peer.connectionState)) {
        cleanup();
        reject(new Error('The audio connection failed.'));
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      peer.removeEventListener('connectionstatechange', check);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The audio connection timed out.'));
    }, timeoutMs);
    peer.addEventListener('connectionstatechange', check);
    check();
  });
}
