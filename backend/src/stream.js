// WebSocket on /stream.
// Client → {type:'auth', token} | {type:'subscribe'|'unsubscribe', asset}
// Server → {type:'tick'|'momentum'} for subscribed assets, {type:'trade_closed', trade} to the trade owner.
import { WebSocketServer } from 'ws';
import { isActiveUser, verifyToken } from './auth.js';

export function createStream(server, engine, assetIds) {
  const wss = new WebSocketServer({ server, path: '/stream', maxPayload: 4096 });
  const byUser = new Map();   // userId → Set<ws>

  wss.on('connection', (ws) => {
    ws.assets = new Set();
    ws.on('close', () => byUser.get(ws.userId)?.delete(ws));
    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return send(ws, { type: 'error', message: 'Invalid JSON' }); }

      if (msg.type === 'auth') {
        const userId = (await verifyToken(String(msg.token ?? '')))?.id;
        if (!userId || !(await isActiveUser(userId))) return send(ws, { type: 'error', message: 'Invalid token' });
        byUser.get(ws.userId)?.delete(ws);
        ws.userId = userId;
        if (!byUser.has(userId)) byUser.set(userId, new Set());
        byUser.get(userId).add(ws);
        return send(ws, { type: 'authed' });
      }
      if (msg.type === 'subscribe' || msg.type === 'unsubscribe') {
        if (!engine.has(msg.asset)) return send(ws, { type: 'error', message: 'Unknown asset' });
        if (msg.type === 'subscribe') ws.assets.add(msg.asset);
        else ws.assets.delete(msg.asset);
        return;
      }
      send(ws, { type: 'error', message: 'Unknown message type' });
    });
  });

  function send(ws, payload) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  function broadcast(asset, payload) {
    const text = JSON.stringify(payload);
    for (const ws of wss.clients) {
      if (ws.readyState === ws.OPEN && ws.assets.has(asset)) ws.send(text);
    }
  }

  engine.on('tick', (t) => broadcast(t.asset, { type: 'tick', ...t }));
  setInterval(() => {
    for (const id of assetIds) broadcast(id, { type: 'momentum', asset: id, up: engine.getMomentum(id) });
  }, 1000);

  return {
    online: () => wss.clients.size,   // real live connections right now
    push(userId, payload) {
      for (const ws of byUser.get(userId) ?? []) send(ws, payload);
    },
  };
}
