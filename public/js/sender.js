import { Signal } from './lib/signal.js';
import { preferCodec, tuneSender, mungeBitrate, readSenderStats } from './lib/rtc.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  stream: null,
  peers: new Map(), // viewerId -> { pc, sender, statsPrev }
  signal: null,
  pendingViewers: new Set(),
};

const settings = () => ({
  width: Number($('#width').value),
  height: Number($('#height').value),
  fps: Number($('#fps').value),
  maxBitrateMbps: Number($('#bitrate').value),
  codec: $('#codec').value,
  contentHint: $('#hint').value,
});

function log(msg) {
  const el = $('#log');
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  el.prepend(line);
  while (el.childElementCount > 60) el.lastElementChild.remove();
}

function setStatus(text, tone = 'idle') {
  const el = $('#status');
  el.textContent = text;
  el.dataset.tone = tone;
}

// ---------------------------------------------------------------- capture

async function startBroadcast() {
  const s = settings();
  try {
    state.stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: s.width },
        height: { ideal: s.height },
        frameRate: { ideal: s.fps, max: s.fps },
        displaySurface: 'monitor',
      },
      audio: false,
    });
  } catch (err) {
    log(`capture cancelled: ${err.message}`);
    return;
  }

  const track = state.stream.getVideoTracks()[0];

  // Tells the encoder this is sharp-edged text, not camera footage. Without it
  // the encoder smooths high-frequency detail and your font hinting dissolves.
  track.contentHint = s.contentHint;

  const cap = track.getSettings();
  log(`capturing ${cap.width}x${cap.height} @ ${Math.round(cap.frameRate)}fps, hint="${track.contentHint}"`);
  $('#preview').srcObject = state.stream;

  track.addEventListener('ended', stopBroadcast);

  $('#start').hidden = true;
  $('#stop').hidden = false;
  setStatus('broadcasting', 'live');

  // Serve anyone who was already waiting on the headset.
  for (const viewerId of state.pendingViewers) openPeer(viewerId);
  state.pendingViewers.clear();

  state.signal.post({ type: 'ready' });
}

function stopBroadcast() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  $('#preview').srcObject = null;
  for (const [id] of state.peers) closePeer(id);
  $('#start').hidden = false;
  $('#stop').hidden = true;
  setStatus('idle', 'idle');
  log('broadcast stopped');
}

// ------------------------------------------------------------ peer plumbing

async function openPeer(viewerId) {
  if (!state.stream) {
    state.pendingViewers.add(viewerId);
    log(`viewer ${viewerId} is waiting — press Start Broadcast`);
    return;
  }
  if (state.peers.has(viewerId)) closePeer(viewerId);

  const s = settings();

  // No STUN, no TURN. Host candidates only: the fastest possible path on a LAN
  // and it never touches the internet.
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  const entry = { pc, sender: null, statsPrev: {} };
  state.peers.set(viewerId, entry);

  const track = state.stream.getVideoTracks()[0];
  const transceiver = pc.addTransceiver(track, {
    direction: 'sendonly',
    streams: [state.stream],
    sendEncodings: [
      {
        maxBitrate: s.maxBitrateMbps * 1_000_000,
        maxFramerate: s.fps,
        networkPriority: 'high',
      },
    ],
  });
  entry.sender = transceiver.sender;

  const chosen = preferCodec(transceiver, s.codec);
  if (chosen) log(`codec preference: ${chosen.mimeType} ${chosen.sdpFmtpLine || ''}`);

  pc.addEventListener('icecandidate', (ev) => {
    if (ev.candidate) state.signal.signal(viewerId, { candidate: ev.candidate });
  });

  pc.addEventListener('connectionstatechange', () => {
    log(`viewer ${viewerId}: ${pc.connectionState}`);
    renderPeers();
    if (pc.connectionState === 'failed') closePeer(viewerId);
  });

  const offer = await pc.createOffer();
  offer.sdp = mungeBitrate(offer.sdp, {
    maxBitrateMbps: s.maxBitrateMbps,
    startBitrateMbps: Math.round(s.maxBitrateMbps / 2),
  });
  await pc.setLocalDescription(offer);
  state.signal.signal(viewerId, { sdp: pc.localDescription });

  await tuneSender(entry.sender, { maxBitrateMbps: s.maxBitrateMbps, maxFramerate: s.fps });
  log(`offered stream to viewer ${viewerId}`);
  renderPeers();
}

function closePeer(viewerId) {
  const entry = state.peers.get(viewerId);
  if (!entry) return;
  entry.pc.close();
  state.peers.delete(viewerId);
  renderPeers();
}

async function onSignal({ from, data }) {
  const entry = state.peers.get(from);
  if (!entry) return;
  if (data.sdp) {
    await entry.pc.setRemoteDescription(data.sdp);
    // Re-apply after negotiation: Chrome resets encodings on remote description.
    const s = settings();
    await tuneSender(entry.sender, { maxBitrateMbps: s.maxBitrateMbps, maxFramerate: s.fps });
  } else if (data.candidate) {
    try {
      await entry.pc.addIceCandidate(data.candidate);
    } catch (err) {
      log(`ice error: ${err.message}`);
    }
  }
}

// ------------------------------------------------------------------- stats

function renderPeers() {
  $('#peer-count').textContent = String(state.peers.size);
}

async function pollStats() {
  const rows = [];
  for (const [id, entry] of state.peers) {
    const stats = await readSenderStats(entry.pc, entry.statsPrev);
    entry.statsPrev = stats;
    rows.push({ id, stats });
  }

  const body = $('#stats tbody');
  body.textContent = '';
  for (const { id, stats } of rows) {
    const tr = document.createElement('tr');
    const cells = [
      id,
      stats.width && stats.height ? `${stats.width}x${stats.height}` : '—',
      stats.fps != null ? `${Math.round(stats.fps)}` : '—',
      stats.mbps != null ? `${stats.mbps.toFixed(1)}` : '—',
      stats.codec || '—',
      stats.currentRttMs != null ? `${stats.currentRttMs.toFixed(1)}` : '—',
      stats.packetsLost ?? '—',
      stats.qualityLimitation || 'none',
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = String(c);
      tr.append(td);
    }
    body.append(tr);
  }
}

// --------------------------------------------------------------------- init

function init() {
  state.signal = new Signal('sender')
    .on('welcome', ({ id, peers }) => {
      log(`signaling connected as ${id}`);
      setStatus(state.stream ? 'broadcasting' : 'idle', state.stream ? 'live' : 'idle');
      for (const p of peers) openPeer(p);
    })
    .on('peer-join', ({ id }) => openPeer(id))
    .on('request-stream', ({ from }) => openPeer(from))
    .on('peer-leave', ({ id }) => {
      state.pendingViewers.delete(id);
      closePeer(id);
    })
    .on('signal', onSignal)
    .on('disconnected', () => setStatus('signaling lost — reconnecting', 'warn'))
    .connect();

  $('#start').addEventListener('click', startBroadcast);
  $('#stop').addEventListener('click', stopBroadcast);

  // Live-apply encoder changes without renegotiating.
  for (const id of ['bitrate', 'fps']) {
    $(`#${id}`).addEventListener('change', async () => {
      const s = settings();
      for (const [, entry] of state.peers) {
        await tuneSender(entry.sender, { maxBitrateMbps: s.maxBitrateMbps, maxFramerate: s.fps });
      }
      log(`encoder retuned: ${s.maxBitrateMbps} Mbps / ${s.fps} fps`);
    });
  }

  $('#hint').addEventListener('change', () => {
    const track = state.stream?.getVideoTracks()[0];
    if (track) {
      track.contentHint = settings().contentHint;
      log(`contentHint = "${track.contentHint}"`);
    }
  });

  $('#bitrate').addEventListener('input', () => {
    $('#bitrate-val').textContent = `${$('#bitrate').value} Mbps`;
  });

  setInterval(pollStats, 1000);

  fetch('/api/host')
    .then((r) => r.json())
    .then(({ addresses, port, httpPort }) => {
      const usb = [
        'USB  (no certificate needed)',
        `  run: npm run usb`,
        `  then open on the headset:  http://localhost:${httpPort}/`,
      ];
      const wifi = addresses.length
        ? ['', 'Wi-Fi  (accept the certificate warning once)',
           ...addresses.map((a) => `  https://${a}:${port}/`)]
        : ['', 'Wi-Fi  no LAN address detected'];
      $('#urls').textContent = [...usb, ...wifi].join('\n');
    });
}

init();
