/** Synthetic Phoenix transport; never opens a connection to a real server. */
export async function mockMobileRealtime(page) {
  const peers = [];
  await page.routeWebSocket('wss://**/*', (socket) => {
    const peer = {
      socket,
      topic: null,
      join: null,
      filters: [],
      closed: false,
      array: false,
    };
    peers.push(peer);
    socket.onClose(() => {
      peer.closed = true;
    });
    socket.onMessage((raw) => {
      const parsed = JSON.parse(String(raw));
      peer.array = Array.isArray(parsed);
      const m = peer.array
        ? {
            join_ref: parsed[0],
            ref: parsed[1],
            topic: parsed[2],
            event: parsed[3],
            payload: parsed[4],
          }
        : parsed;
      const send = (event, payload) =>
        socket.send(
          JSON.stringify(
            peer.array
              ? [m.join_ref, m.ref, m.topic, event, payload]
              : {
                  join_ref: m.join_ref,
                  ref: m.ref,
                  topic: m.topic,
                  event,
                  payload,
                }
          )
        );
      if (m.event === 'phx_join') {
        peer.topic = m.topic;
        peer.join = m.join_ref;
        peer.filters = (m.payload.config?.postgres_changes ?? []).map(
          (filter, i) => ({ ...filter, id: i + 1 })
        );
        send('phx_reply', {
          status: 'ok',
          response: { postgres_changes: peer.filters },
        });
      } else if (m.event === 'heartbeat' || m.event === 'phx_leave')
        send('phx_reply', { status: 'ok', response: {} });
    });
  });
  return {
    get peers() {
      return peers;
    },
    emit(table = 'conversations') {
      for (const peer of peers) {
        if (peer.closed || !peer.topic) continue;
        const ids = peer.filters
          .filter((f) => f.table === table)
          .map((f) => f.id);
        if (!ids.length) continue;
        const payload = {
          ids,
          data: {
            schema: 'public',
            table,
            type: 'UPDATE',
            columns: [],
            record: { id: 'fixture' },
            old_record: {},
            commit_timestamp: new Date().toISOString(),
          },
        };
        peer.socket.send(
          JSON.stringify(
            peer.array
              ? [peer.join, null, peer.topic, 'postgres_changes', payload]
              : {
                  join_ref: peer.join,
                  ref: null,
                  topic: peer.topic,
                  event: 'postgres_changes',
                  payload,
                }
          )
        );
      }
    },
  };
}
