// Servidor de Supabase Realtime simulado para los tests: reenvía los Broadcast
// de cada sala a los demás conectados (como el real con self: false).
export function createRelay() {
  const rooms = new Map();
  const log = [];
  const send = (ws, msg) => ws.send(JSON.stringify(msg));

  async function attach(page) {
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      log.push({ url: ws.url() });
      const joined = new Set();
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw));
        log.push(m);
        if (m.event === 'heartbeat') {
          send(ws, { topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref });
        } else if (m.event === 'phx_join') {
          if (!rooms.has(m.topic)) rooms.set(m.topic, new Set());
          rooms.get(m.topic).add(ws);
          joined.add(m.topic);
          send(ws, { topic: m.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: m.ref, join_ref: m.join_ref });
        } else if (m.event === 'broadcast' && joined.has(m.topic)) {
          for (const other of rooms.get(m.topic)) {
            if (other !== ws) send(other, { topic: m.topic, event: 'broadcast', payload: m.payload, ref: null, join_ref: null });
          }
        } else if (m.event === 'phx_leave') {
          const r = rooms.get(m.topic);
          if (r) r.delete(ws);
          joined.delete(m.topic);
        }
      });
      ws.onClose(() => { for (const t of joined) rooms.get(t).delete(ws); });
    });
  }
  return { attach, log };
}
