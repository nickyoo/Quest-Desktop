#!/usr/bin/env node
/**
 * Everything that can be verified without a headset. Run it after any change
 * before you put the Quest on — the round trip of "push, unplug, wear, fail"
 * is slow enough that catching a typo here is worth a lot.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { createSignalingHub, isAllowedOrigin } from '../server/signaling.js';
import { mungeBitrate } from '../public/js/lib/rtc.js';

let failed = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- 1. import graph

console.log('\n  module graph');
const importmap = JSON.parse(
  fs.readFileSync('public/index.html', 'utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/)[1],
).imports;

const modules = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) modules.push(p);
  }
})('public/js');

let unresolved = 0;
for (const file of modules) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*import\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      if (!fs.existsSync(path.resolve(path.dirname(file), spec))) {
        console.log(`        ${file} -> ${spec} (missing)`);
        unresolved++;
      }
    } else if (!importmap[spec] && !Object.keys(importmap).some((k) => k.endsWith('/') && spec.startsWith(k))) {
      console.log(`        ${file} -> bare "${spec}" not in importmap`);
      unresolved++;
    }
  }
}
check(`all imports resolve across ${modules.length} modules`, unresolved === 0);

for (const [spec, target] of Object.entries(importmap)) {
  if (spec.endsWith('/')) continue;
  const onDisk = path.join('node_modules/three/build', path.basename(target));
  check(`importmap "${spec}" exists on disk`, fs.existsSync(onDisk));
}

// A hardcoded wss:// silently breaks the entire USB path, so guard it.
const signalSrc = fs.readFileSync('public/js/lib/signal.js', 'utf8');
check('signaling follows page protocol (no hardcoded wss)', !/['"`]wss:\/\//.test(signalSrc));

// display:none stops Chromium decoding the stream. Guard that too.
const indexSrc = fs.readFileSync('public/index.html', 'utf8');
check('stream video is not hidden', /<video[^>]*id="stream"[^>]*>/.test(indexSrc) && !/<video[^>]*id="stream"[^>]*\shidden/.test(indexSrc));

// --------------------------------------------------------- 2. SDP bitrate

console.log('\n  sdp munger');
const sdp = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 0.0.0.0', 'a=rtpmap:111 opus/48000/2',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97', 'c=IN IP4 0.0.0.0', 'b=AS:2000',
  'a=rtpmap:96 H264/90000',
  'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f',
  'a=rtpmap:97 VP9/90000',
].join('\r\n');

const out = mungeBitrate(sdp, { maxBitrateMbps: 40, startBitrateMbps: 20 });
const lines = out.split('\r\n');
const vIdx = lines.findIndex((l) => l.startsWith('m=video'));
const aIdx = lines.findIndex((l) => l.startsWith('m=audio'));
const audio = lines.slice(aIdx, vIdx);
const video = lines.slice(vIdx);

check('b=AS:40000 present in video section', video.includes('b=AS:40000'));
check('b=TIAS present in video section', video.includes('b=TIAS:40000000'));
check('b= line directly follows c=', lines[vIdx + 1].startsWith('c=') && lines[vIdx + 2] === 'b=AS:40000');
check('browser default b=AS:2000 stripped', !out.includes('b=AS:2000'));
check('audio section left alone', !audio.some((l) => l.startsWith('b=')));
check('x-google-start-bitrate applied', /a=fmtp:96 .*x-google-start-bitrate=20000/.test(out));
check('x-google-max-bitrate applied', /x-google-max-bitrate=40000/.test(out));
check('existing fmtp params preserved', /profile-level-id=640c1f;x-google/.test(out));
check('exactly one video m-line', lines.filter((l) => l.startsWith('m=video')).length === 1);

// ------------------------------------------------------- 3. screen geometry

console.log('\n  screen geometry');
const radius = 1.6, height = 0.9, aspect = 3840 / 1600;
const centralAngle = (aspect * height) / radius;
const arc = radius * centralAngle;
check('curved screen preserves source aspect ratio', Math.abs(arc / height - aspect) < 1e-9);
console.log(`        ${arc.toFixed(3)}m x ${height}m arc = ${(centralAngle * 180 / Math.PI).toFixed(1)} deg`);

// ----------------------------------------------------------- 4. signaling

console.log('\n  signaling relay');
const hub = createSignalingHub();
const server = http.createServer((req, res) => res.end('ok'));
hub.attach(server);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `ws://127.0.0.1:${server.address().port}/ws`;

function client(role) {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d)));
  const ready = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role })); r(); }));
  return { ws, inbox, ready, send: (m) => ws.send(JSON.stringify(m)) };
}

const viewer = client('viewer');
await viewer.ready;
await wait(100);
const sender = client('sender');
await sender.ready;
await wait(200);

const vw = viewer.inbox.find((m) => m.type === 'welcome');
const sw = sender.inbox.find((m) => m.type === 'welcome');
check('viewer gets an id', !!vw?.id);
check('sender gets an id', !!sw?.id);
check('sender learns about the waiting viewer', sw?.peers?.includes(vw.id) || sender.inbox.some((m) => m.type === 'peer-join'));

viewer.send({ type: 'request-stream' });
await wait(150);
check('request-stream reaches the sender', sender.inbox.some((m) => m.type === 'request-stream' && m.from === vw.id));

sender.send({ type: 'signal', to: vw.id, data: { sdp: { type: 'offer', sdp: 'OFFER' } } });
await wait(150);
check('offer relayed sender -> viewer', viewer.inbox.some((m) => m.type === 'signal' && m.data?.sdp?.sdp === 'OFFER' && m.from === sw.id));

viewer.send({ type: 'signal', to: sw.id, data: { sdp: { type: 'answer', sdp: 'ANSWER' } } });
await wait(150);
check('answer relayed viewer -> sender', sender.inbox.some((m) => m.type === 'signal' && m.data?.sdp?.sdp === 'ANSWER'));

viewer.send({ type: 'signal', to: sw.id, data: { candidate: { candidate: 'ICE' } } });
await wait(150);
check('ice candidate relayed', sender.inbox.some((m) => m.type === 'signal' && m.data?.candidate?.candidate === 'ICE'));

viewer.ws.close();
await wait(250);
check('peer-leave delivered on disconnect', sender.inbox.some((m) => m.type === 'peer-leave' && m.id === vw.id));

// The USB case: Mac on loopback HTTP, headset on LAN HTTPS. Different servers,
// one hub. If these two cannot see each other, USB mode is silently broken.
console.log('\n  shared hub across transports');
const serverB = http.createServer((req, res) => res.end('ok'));
hub.attach(serverB);
await new Promise((r) => serverB.listen(0, '127.0.0.1', r));
const urlB = `ws://127.0.0.1:${serverB.address().port}/ws`;

function clientOn(u, role) {
  const ws = new WebSocket(u);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d)));
  const ready = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ type: 'hello', role })); r(); }));
  return { ws, inbox, ready, send: (m) => ws.send(JSON.stringify(m)) };
}

const macSide = clientOn(url, 'sender');
await macSide.ready;
await wait(100);
const questSide = clientOn(urlB, 'viewer');
await questSide.ready;
await wait(200);

const qw = questSide.inbox.find((m) => m.type === 'welcome');
check('viewer on transport B sees sender from transport A', qw?.peers?.length > 0);
check('sender on transport A is told about viewer on transport B', macSide.inbox.some((m) => m.type === 'peer-join'));

macSide.send({ type: 'signal', to: qw.id, data: { sdp: { type: 'offer', sdp: 'CROSS' } } });
await wait(150);
check('offer crosses transports', questSide.inbox.some((m) => m.type === 'signal' && m.data?.sdp?.sdp === 'CROSS'));

sender.ws.close();
macSide.ws.close();
questSide.ws.close();
server.close();
serverB.close();

// ------------------------------------------------------- 5. origin policy

// A WebSocket handshake is not bound by the same-origin policy, so the server
// is the only thing standing between a random webpage and your desktop stream.
// These are the cases that matter; if one of them flips, that is a screen leak,
// not a style regression.
console.log('\n  websocket origin policy');
const PORTS = [3000, 3001];
const LAN = ['192.168.1.42'];
const allow = (o) => isAllowedOrigin(o, PORTS, LAN);

check('loopback sender origin allowed', allow('http://localhost:3001'));
check('loopback by IP allowed', allow('http://127.0.0.1:3001'));
check('LAN https origin allowed', allow('https://192.168.1.42:3000'));
check('non-browser client (no Origin) allowed', allow(undefined));

check('remote site rejected', !allow('https://evil.example.com'));
check('remote site on our port rejected', !allow('https://evil.example.com:3000'));
check('sandboxed/file origin ("null") rejected', !allow('null'));
check('loopback on a foreign port rejected', !allow('http://localhost:8080'));
check('LAN address we do not hold rejected', !allow('https://192.168.1.99:3000'));
check('hostname merely CONTAINING localhost rejected', !allow('http://localhost.evil.com:3001'));
check('non-http scheme rejected', !allow('ws://localhost:3001'));

// And the same policy, live, through an actual handshake.
const guarded = createSignalingHub({ ports: [] });
const guardedServer = http.createServer((req, res) => res.end('ok'));
guarded.attach(guardedServer);
await new Promise((r) => guardedServer.listen(0, '127.0.0.1', r));
const guardedUrl = `ws://127.0.0.1:${guardedServer.address().port}/ws`;

const rejected = await new Promise((resolve) => {
  const ws = new WebSocket(guardedUrl, { origin: 'https://evil.example.com' });
  ws.on('open', () => { ws.close(); resolve(false); });
  ws.on('error', () => resolve(true));
});
check('handshake from a foreign origin is refused', rejected);
guardedServer.close();

console.log(failed ? `\n  ${failed} check(s) FAILED\n` : '\n  all checks passed\n');
process.exit(failed ? 1 : 0);
