import * as THREE from 'three';
import { Signal } from './lib/signal.js';
import { CurvedScreen } from './xr/screen.js';
import { createEnvironment, nextEnvironmentId } from './env/registry.js';
import { DeskPortal } from './env/desk-portal.js';
import { StatusPanel } from './ui/panel.js';

const video = document.getElementById('stream');
const enterBtn = document.getElementById('enter-xr');
const statusEl = document.getElementById('xr-status');

const app = {
  renderer: null,
  scene: null,
  camera: null,
  screen: null,
  env: null,
  envId: 'void',
  portal: null,
  panel: null,
  panelVisible: true,
  session: null,
  sessionMode: null,
  refSpace: null,
  signal: null,
  pc: null,
  senderId: null,
  stats: {},
  connection: 'waiting for broadcast',
  clock: new THREE.Clock(),
};

function status(text) {
  statusEl.textContent = text;
}

// =========================================================== WebRTC (viewer)

function resetPeer() {
  app.pc?.close();
  app.pc = null;
}

function createPeer(senderId) {
  resetPeer();
  app.senderId = senderId;

  // Host candidates only. On a LAN this connects in a couple of round trips
  // and never contacts an external server.
  const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
  app.pc = pc;

  pc.addEventListener('track', (ev) => {
    video.srcObject = ev.streams[0];
    video.play().catch(() => { /* resumed by the enter-XR gesture */ });
    app.connection = 'streaming';
    // The media layer needs real frames before it will accept the element.
    video.addEventListener('loadeddata', () => attemptLayer(), { once: true });
  });

  pc.addEventListener('icecandidate', (ev) => {
    if (ev.candidate) app.signal.signal(senderId, { candidate: ev.candidate });
  });

  pc.addEventListener('connectionstatechange', () => {
    app.connection = pc.connectionState;
    status(`peer: ${pc.connectionState}`);
  });

  return pc;
}

async function onSignal({ from, data }) {
  if (data.sdp) {
    const pc = app.pc && app.senderId === from ? app.pc : createPeer(from);
    await pc.setRemoteDescription(data.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    app.signal.signal(from, { sdp: pc.localDescription });
  } else if (data.candidate && app.pc) {
    try {
      await app.pc.addIceCandidate(data.candidate);
    } catch { /* candidate arrived before the description; harmless */ }
  }
}

function connectSignaling() {
  app.signal = new Signal('viewer')
    .on('welcome', ({ peers }) => {
      status(peers.length ? 'found broadcast, negotiating…' : 'waiting for the Mac to start broadcasting');
      app.signal.post({ type: 'request-stream' });
    })
    .on('peer-join', () => app.signal.post({ type: 'request-stream' }))
    .on('peer-leave', ({ id }) => {
      if (id === app.senderId) {
        resetPeer();
        app.connection = 'sender disconnected';
      }
    })
    .on('signal', onSignal)
    .on('disconnected', () => { app.connection = 'signaling lost'; })
    .connect();
}

// ================================================================= XR setup

async function pickSessionMode() {
  if (!navigator.xr) return null;
  // AR first, always: passthrough where we draw nothing means one code path
  // serves both the enclosed environments and the desk cutout.
  if (await navigator.xr.isSessionSupported('immersive-ar')) return 'immersive-ar';
  if (await navigator.xr.isSessionSupported('immersive-vr')) return 'immersive-vr';
  return null;
}

function buildScene() {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Any tone mapping would recolour the desktop stream. Leave it alone.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  // Supersample a little: the scene is trivially cheap and this visibly helps
  // the textured-mesh fallback. Harmless when the media layer is doing the work.
  renderer.xr.setFramebufferScaleFactor(1.2);
  // Off-screen rather than display:none, for the same reason as the video:
  // a detached-looking canvas invites the compositor to deprioritise it.
  canvas.className = 'offscreen';
  document.body.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 260);

  app.renderer = renderer;
  app.scene = scene;
  app.camera = camera;

  app.screen = new CurvedScreen({ video, radius: 1.6, height: 0.9, aspect: 3840 / 1600, eyeHeight: 1.3 });
  scene.add(app.screen.group);

  app.panel = new StatusPanel();
  app.panel.mesh.position.set(0, -0.68, -1.42);
  app.panel.mesh.rotation.x = 0.25;
  app.screen.group.add(app.panel.mesh);

  app.portal = new DeskPortal();
  scene.add(app.portal.group);

  setEnvironment('void');
}

function setEnvironment(id) {
  if (app.env) {
    app.scene.remove(app.env.group);
    app.env.dispose();
  }
  app.env = createEnvironment(id);
  app.envId = id;
  app.scene.add(app.env.group);
  app.scene.fog = app.env.fog;
  // In AR the enclosing geometry *is* the background; a scene background would
  // paint over the whole framebuffer and kill passthrough everywhere.
  app.scene.background = app.sessionMode === 'immersive-ar' ? null : app.env.background;
}

async function attemptLayer() {
  if (!app.session || !app.screen) return;
  const ok = await app.screen.tryEnableLayer(app.renderer, app.session, app.refSpace);
  status(ok ? 'compositor layer active' : `textured mesh (${app.screen.layerError})`);
}

async function enterXR() {
  const mode = await pickSessionMode();
  if (!mode) {
    status('no immersive session available in this browser');
    return;
  }

  // Unlock playback while we still hold the user gesture.
  video.play().catch(() => {});

  const required = ['local-floor'];
  const optional = ['layers', 'plane-detection', 'anchors', 'hand-tracking', 'bounded-floor'];

  let session;
  try {
    session = await navigator.xr.requestSession(mode, {
      requiredFeatures: required,
      optionalFeatures: optional,
    });
  } catch (err) {
    status(`could not start session: ${err.message}`);
    return;
  }

  app.session = session;
  app.sessionMode = mode;
  enterBtn.disabled = true;

  session.addEventListener('end', () => {
    app.session = null;
    app.refSpace = null;
    app.screen.layerActive = false;
    app.screen._syncMeshVisibility();
    enterBtn.disabled = false;
    status('session ended');
  });

  await app.renderer.xr.setSession(session);
  app.refSpace = app.renderer.xr.getReferenceSpace();
  app.scene.background = mode === 'immersive-ar' ? null : app.env.background;

  // Foveated rendering blurs the periphery. That is fine for a game and
  // actively bad for a wide monitor you read across.
  try { app.renderer.xr.setFoveation(0); } catch { /* not all runtimes expose it */ }

  await attemptLayer();
  app.renderer.setAnimationLoop(onFrame);
}

// ================================================================== input

const prevButtons = new Map();

function pollInput(session) {
  const out = { pressed: {}, held: {}, axes: { left: [0, 0, 0, 0], right: [0, 0, 0, 0] } };
  if (!session) return out;

  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
    const hand = src.handedness;

    gp.buttons.forEach((b, i) => {
      const key = `${hand}:${i}`;
      const was = prevButtons.get(key) || false;
      if (b.pressed && !was) out.pressed[key] = true;
      out.held[key] = b.pressed;
      prevButtons.set(key, b.pressed);
    });

    out.axes[hand] = gp.axes;
  }
  return out;
}

const DEAD = 0.18;
const axis = (v) => (Math.abs(v ?? 0) < DEAD ? 0 : v);

function handleInput(input, dt) {
  const { pressed, held, axes } = input;
  const grip = held['right:1'];

  // -------- calibration mode: right grip held --------
  if (grip) {
    app.portal.setCalibrating(true);
    const rx = axis(axes.right[2]);
    const rz = axis(axes.right[3]);
    const ly = axis(axes.left[3]);
    if (rx || rz) app.portal.nudge(rx * dt * 0.6, 0, rz * dt * 0.6);
    if (ly) app.portal.nudge(0, -ly * dt * 0.25, 0);
    if (pressed['right:4']) app.portal.requestAutoFit();
    if (pressed['left:4']) app.portal.resize(0.1, 0);
    if (pressed['left:5']) app.portal.resize(-0.1, 0);
    return;
  }
  app.portal.setCalibrating(false);

  // -------- normal bindings --------
  if (pressed['right:4']) setEnvironment(nextEnvironmentId(app.envId));       // A
  if (pressed['right:5']) app.portal.setEnabled(!app.portal.enabled);          // B
  if (pressed['left:4']) app.screen.toggleMode(app.renderer, app.session);     // X
  if (pressed['left:5']) {                                                     // Y
    app.panelVisible = !app.panelVisible;
    app.panel.mesh.visible = app.panelVisible;
  }
  if (pressed['left:3']) app.screen.recenter(app.camera);                      // stick click

  const dist = axis(axes.right[3]);
  if (dist) app.screen.nudgeDistance(dist * dt * 0.8);

  const rise = axis(axes.left[3]);
  if (rise) app.screen.nudgeHeight(-rise * dt * 0.5);
}

// ================================================================== stats

let lastStatsAt = 0;
let lastBytes = 0;

async function pollStats(t) {
  if (!app.pc || t - lastStatsAt < 1.0) return;
  const dt = t - lastStatsAt;
  lastStatsAt = t;

  const report = await app.pc.getStats();
  const s = {};
  report.forEach((r) => {
    if (r.type === 'inbound-rtp' && r.kind === 'video') {
      s.width = r.frameWidth;
      s.height = r.frameHeight;
      s.fps = r.framesPerSecond;
      s.dropped = r.framesDropped;
      s.decoder = r.decoderImplementation;
      s.jitter = r.jitter;
      s.lost = r.packetsLost;
      if (lastBytes && r.bytesReceived) s.mbps = ((r.bytesReceived - lastBytes) * 8) / dt / 1e6;
      lastBytes = r.bytesReceived || lastBytes;
    }
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) {
      s.rtt = r.currentRoundTripTime != null ? r.currentRoundTripTime * 1000 : undefined;
    }
    if (r.type === 'codec' && r.mimeType?.startsWith('video/')) s.codec = r.mimeType.split('/')[1];
  });
  app.stats = s;
}

function panelLines() {
  const s = app.stats;
  const fmt = (v, d = 0, suffix = '') => (v == null ? '—' : `${v.toFixed(d)}${suffix}`);
  return [
    '-- stream',
    `link: ${app.connection}`,
    `source: ${s.width ? `${s.width}x${s.height}` : '—'}  ${s.codec || ''}`,
    `rate: ${fmt(s.fps, 0)} fps   ${fmt(s.mbps, 1, ' Mbps')}`,
    `latency: ${fmt(s.rtt, 1, ' ms rtt')}   dropped ${s.dropped ?? '—'}`,
    '-- workspace',
    `screen: ${app.screen.layerActive ? 'compositor layer' : 'textured mesh'}`,
    `distance: ${app.screen.radius.toFixed(2)} m`,
    `environment: ${app.envId}`,
    `desk portal: ${app.portal.enabled ? app.portal.summary : 'off'}`,
    '-- controls',
    'A env   B portal   X sharpness   Y panel',
    'stick click recenter · grip+stick calibrate desk',
  ];
}

// ============================================================== main loop

function onFrame(timeMs, frame) {
  const dt = Math.min(app.clock.getDelta(), 0.1);
  const t = timeMs / 1000;

  const input = pollInput(app.session);
  handleInput(input, dt);

  if (frame && app.refSpace) app.portal.updateFromFrame(frame, app.refSpace, t);

  app.env?.update(t, dt, app.camera);
  app.panel.set(panelLines());
  app.panel.update(t);
  pollStats(t);

  app.renderer.render(app.scene, app.camera);
}

// ==================================================================== init

async function init() {
  buildScene();
  connectSignaling();

  const mode = await pickSessionMode();
  if (!mode) {
    enterBtn.disabled = true;
    status('WebXR not available — open this page in Meta Quest Browser over HTTPS');
    return;
  }
  status(`${mode === 'immersive-ar' ? 'passthrough' : 'immersive'} session ready`);
  enterBtn.disabled = false;
  enterBtn.addEventListener('click', enterXR);
}

init();
