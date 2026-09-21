import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

/**
 * Dumb relay. One sender (the Mac), N viewers (headsets, or a second browser
 * tab for testing). The sender opens a separate RTCPeerConnection per viewer,
 * so a viewer reconnecting never disturbs the others.
 *
 * Everything is host-candidate-only over the LAN: no STUN, no TURN, nothing
 * that costs money or leaves the building.
 */
export function attachSignaling(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const peers = new Map(); // id -> { ws, role }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const senders = () => [...peers.entries()].filter(([, p]) => p.role === 'sender');
  const viewers = () => [...peers.entries()].filter(([, p]) => p.role === 'viewer');

  wss.on('connection', (ws) => {
    const id = randomUUID().slice(0, 8);
    let role = null;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'hello': {
          role = msg.role === 'sender' ? 'sender' : 'viewer';
          peers.set(id, { ws, role });
          send(ws, {
            type: 'welcome',
            id,
            peers: (role === 'sender' ? viewers() : senders()).map(([pid]) => pid),
          });
          // Tell the other side someone showed up.
          const others = role === 'sender' ? viewers() : senders();
          for (const [pid, p] of others) send(p.ws, { type: 'peer-join', id, role });
          console.log(`  [signal] ${role} ${id} connected (${peers.size} total)`);
          break;
        }

        case 'signal': {
          const target = peers.get(msg.to);
          if (target) send(target.ws, { type: 'signal', from: id, data: msg.data });
          break;
        }

        // A viewer that loaded before the Mac hit "Start Broadcast" pokes the
        // sender so it knows to build an offer for it.
        case 'request-stream': {
          for (const [, p] of senders()) send(p.ws, { type: 'request-stream', from: id });
          break;
        }

        default:
          break;
      }
    });

    ws.on('close', () => {
      if (!peers.has(id)) return;
      peers.delete(id);
      for (const [, p] of peers) send(p.ws, { type: 'peer-leave', id });
      console.log(`  [signal] ${role || 'peer'} ${id} disconnected`);
    });

    ws.on('error', () => ws.close());
  });

  return wss;
}
