import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

/**
 * Dumb relay. One sender (the Mac), N viewers (headsets, or a second browser
 * tab for testing). The sender opens a separate RTCPeerConnection per viewer,
 * so a viewer reconnecting never disturbs the others.
 *
 * Everything is host-candidate-only over the LAN or the USB cable: no STUN,
 * no TURN, nothing that costs money or leaves the building.
 *
 * The hub owns ONE peer registry shared across every transport it is attached
 * to. That matters: the Mac usually connects over plain HTTP on loopback while
 * the headset comes in over HTTPS on the LAN, and those are two different
 * servers. Give each its own registry and the two ends never see each other.
 */
export function createSignalingHub() {
  const peers = new Map(); // id -> { ws, role }

  const send = (ws, msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  const withRole = (role) => [...peers.entries()].filter(([, p]) => p.role === role);

  function handleConnection(ws) {
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
          const counterparts = withRole(role === 'sender' ? 'viewer' : 'sender');
          send(ws, { type: 'welcome', id, peers: counterparts.map(([pid]) => pid) });
          for (const [, p] of counterparts) send(p.ws, { type: 'peer-join', id, role });
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
          for (const [, p] of withRole('sender')) send(p.ws, { type: 'request-stream', from: id });
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
  }

  return {
    /** Attach the hub to an http(s) server. Safe to call more than once. */
    attach(server) {
      const wss = new WebSocketServer({ server, path: '/ws' });
      wss.on('connection', handleConnection);
      return wss;
    },
    get size() {
      return peers.size;
    },
  };
}
