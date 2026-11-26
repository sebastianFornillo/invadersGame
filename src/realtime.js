// Cliente mínimo de Supabase Realtime (Broadcast) sobre WebSocket, sin librerías.
// Protocolo Phoenix 1.0.0: mensajes JSON { topic, event, payload, ref, join_ref }.
import { CONFIG } from './config.js';

const HEARTBEAT_MS = 25_000;
const JOIN_TIMEOUT_MS = 10_000;

export function realtimeUrl(supabaseUrl = CONFIG.supabaseUrl, key = CONFIG.supabaseKey) {
  const base = String(supabaseUrl || '').trim().replace(/\/+$/, '');
  if (!base || !key) return null;
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/realtime/v1/websocket?apikey=${encodeURIComponent(String(key).trim())}&vsn=1.0.0`;
}

/**
 * Se une a un canal de Broadcast público.
 * onMessage(event, payload) recibe lo que mandan los demás (no lo propio).
 * onStatus('joined' | 'error' | 'closed', detalle)
 */
export function joinChannel(name, { onMessage, onStatus = () => {}, url = realtimeUrl() } = {}) {
  if (!url) throw new Error('El modo online no está configurado');
  const topic = `realtime:${name}`;
  const ws = new WebSocket(url);
  let ref = 0;
  let joined = false;
  let closed = false;
  let heartbeat = 0;
  const nextRef = () => String(++ref);
  const joinRef = '1';

  const raw = (msg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); };

  const joinTimer = setTimeout(() => { if (!joined) fail('El servidor no respondió'); }, JOIN_TIMEOUT_MS);

  function fail(reason) {
    if (closed) return;
    onStatus('error', reason);
    close();
  }

  ws.addEventListener('open', () => {
    ref = 1;
    raw({
      topic,
      event: 'phx_join',
      payload: { config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: false } },
      ref: joinRef,
      join_ref: joinRef,
    });
    heartbeat = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() }), HEARTBEAT_MS);
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || msg.topic !== topic) return;
    if (msg.event === 'phx_reply' && msg.ref === joinRef) {
      const p = msg.payload || {};
      if (p.status === 'ok') {
        joined = true;
        clearTimeout(joinTimer);
        onStatus('joined');
      } else {
        fail((p.response && p.response.reason) || 'No se pudo entrar a la sala');
      }
    } else if (msg.event === 'broadcast' && msg.payload && msg.payload.type === 'broadcast') {
      onMessage(msg.payload.event, msg.payload.payload || {});
    } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
      if (!closed) fail('Se cortó la conexión con la sala');
    } else if (msg.event === 'system' && msg.payload && msg.payload.status === 'error') {
      fail(msg.payload.message || 'Error en la sala');
    }
  });

  ws.addEventListener('error', () => fail('Sin conexión con el servidor'));
  ws.addEventListener('close', () => {
    if (!closed) { closed = true; cleanup(); onStatus('closed'); }
  });

  function cleanup() {
    clearInterval(heartbeat);
    clearTimeout(joinTimer);
  }

  function close() {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      raw({ topic, event: 'phx_leave', payload: {}, ref: nextRef(), join_ref: joinRef });
      ws.close();
    } catch { /* ya cerrado */ }
    onStatus('closed');
  }

  return {
    send(event, payload) {
      if (!joined) return false;
      raw({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: nextRef(), join_ref: joinRef });
      return true;
    },
    close,
    get joined() { return joined; },
  };
}
