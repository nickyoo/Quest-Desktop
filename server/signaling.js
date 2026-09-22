import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

/**
 * An SDP offer with a lot of ICE candidates is a few tens of kilobytes. A
 * quarter of a megabyte is generous for anything this protocol legitimately
 * carries, and it stops a peer from parking hundreds of megabytes of string in
 * this process's heap before we even look at `msg.type`.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Nothing here is a real session, so a peer is cheap — but unbounded. A client
 * reconnecting in a loop would grow the registry without limit; this is the
 * backstop. A real broadcast is one sender and a handful of headsets.
 */
const MAX_PEERS = 32;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Every non-internal IPv4 address this machine currently answers on. */
function currentLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

/**
 * Is this handshake coming from one of our own pages?
 *
 * THIS IS A SECURITY CHECK, NOT A TIDINESS ONE. A WebSocket handshake is NOT
 * subject to the same-origin policy: any page on the public internet may open
 * `ws://localhost:3001/ws` and the browser will happily perform the upgrade.
 * The server is the only thing that can say no. Without this check, any site
 * you visit while broadcasting can send `hello` + `request-stream`, and
 * `sender.js` will answer it with an SDP offer carrying your captured desktop.
 * The victim never sees a prompt, because they already granted the capture to
 * the page that is being impersonated.
 *
 * So: the origin's host must be this machine or one of its LAN addresses, AND
 * the port must be one we actually serve. A malicious page is neither.
 *
 * @param {string|undefined} origin  the handshake's `Origin` header
 * @param {number[]} ports           ports this hub is reachable on
 * @param {string[]} [lanAddresses]  overridable for tests
 */
export function isAllowedOrigin(origin, ports, lanAddresses = currentLanAddresses()) {
  // Browsers ALWAYS send `Origin` on a WebSocket handshake. A missing one is a
  // non-browser client — our own selftest, a CLI tool — which is not the threat
  // this check addresses and cannot be identified by an origin anyway.
  if (origin === undefined || origin === null) return true;

  let u;
  try {
    u = new URL(origin);
  } catch {
    return false; // "null" (sandboxed iframe, file://) and anything unparseable
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!ports.includes(port)) return false;

  return LOOPBACK.has(u.hostname) || lanAddresses.includes(u.hostname);
}

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
 *
 * @param {{ports?: number[]}} [options] ports this hub is served on. Pass them:
 *   they are what `isAllowedOrigin` checks against, and an empty list rejects
 *   every browser.
 */
export function createSignalingHub({ ports = [] } = {}) {
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
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'hello': {
          if (role !== null) return; // one hello per connection
          if (peers.size >= MAX_PEERS) {
            console.warn(`  [signal] refusing peer ${id}: ${MAX_PEERS}-peer cap reached`);
            ws.close();
            return;
          }
          role = msg.role === 'sender' ? 'sender' : 'viewer';
          peers.set(id, { ws, role });
          const counterparts = withRole(role === 'sender' ? 'viewer' : 'sender');
          send(ws, { type: 'welcome', id, peers: counterparts.map(([pid]) => pid) });
          for (const [, p] of counterparts) send(p.ws, { type: 'peer-join', id, role });
          console.log(`  [signal] ${role} ${id} connected (${peers.size} total)`);
          break;
        }

        // Everything below moves data between peers, so it requires a peer.
        // Without this an un-greeted socket could still drive the relay.
        case 'signal': {
          if (role === null) return;
          const target = peers.get(msg.to);
          if (target) send(target.ws, { type: 'signal', from: id, data: msg.data });
          break;
        }

        // A viewer that loaded before the Mac hit "Start Broadcast" pokes the
        // sender so it knows to build an offer for it.
        case 'request-stream': {
          if (role !== 'viewer') return;
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
      const wss = new WebSocketServer({
        server,
        path: '/ws',
        maxPayload: MAX_PAYLOAD_BYTES,
        verifyClient: ({ origin }) => {
          if (isAllowedOrigin(origin, ports)) return true;
          console.warn(`  [signal] rejected WebSocket handshake from origin: ${origin}`);
          return false;
        },
      });
      wss.on('connection', handleConnection);
      return wss;
    },
    get size() {
      return peers.size;
    },
  };
}
