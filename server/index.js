import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachSignaling } from './signaling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const CERT_DIR = path.join(ROOT, 'certs');

/** All non-internal IPv4 addresses, so we can print usable LAN URLs. */
export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

const app = express();
app.disable('x-powered-by');

// Vendored Three.js. Keeping it local means the headset never needs internet
// and never pays a CDN round-trip on cold load.
app.use('/vendor/three/addons', express.static(path.join(ROOT, 'node_modules/three/examples/jsm')));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three/build')));

// WebXR + getDisplayMedia both demand a secure context. These headers keep the
// isolation state predictable and stop the Quest browser from caching stale JS
// between iterations, which will otherwise cost you an hour of confusion.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'xr-spatial-tracking=(self)');
  next();
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/api/host', (req, res) => {
  res.json({ addresses: lanAddresses(), port: PORT });
});

function loadCerts() {
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) return null;
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

const creds = loadCerts();
if (!creds) {
  console.error('\n  No TLS certificate found in ./certs');
  console.error('  WebXR and getDisplayMedia both require HTTPS. Run:\n');
  console.error('      npm run certs\n');
  process.exit(1);
}

const server = https.createServer(creds, app);
attachSignaling(server);

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n  HyperCanvas is up.\n');
  console.log('  On the Mac (start the broadcast here):');
  console.log(`      https://localhost:${PORT}/sender\n`);
  console.log('  On the Quest 3 (open in Meta Quest Browser):');
  if (addrs.length === 0) {
    console.log('      no LAN address detected — check your Wi-Fi connection');
  } else {
    for (const a of addrs) console.log(`      https://${a}:${PORT}/`);
  }
  console.log('\n  The certificate is self-signed, so the Quest will warn you once.');
  console.log('  Tap "Advanced" then "Proceed" — WebXR still gets a secure context.\n');
});

// A plain HTTP listener on PORT+1 that does nothing but redirect, so a mistyped
// http:// URL on the headset does not look like the server is down.
http
  .createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
    res.end();
  })
  .listen(PORT + 1, '0.0.0.0');
