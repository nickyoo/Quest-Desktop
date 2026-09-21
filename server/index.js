import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSignalingHub } from './signaling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);          // HTTPS, on the LAN
const HTTP_PORT = Number(process.env.HTTP_PORT || 3001); // HTTP, loopback only
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

// no-store because the Quest browser will otherwise serve you yesterday's
// JavaScript for an hour while you wonder why your fix did nothing.
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'xr-spatial-tracking=(self)');
  next();
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.get('/api/host', (req, res) => {
  res.json({ addresses: lanAddresses(), port: PORT, httpPort: HTTP_PORT });
});

function loadCerts() {
  const key = path.join(CERT_DIR, 'key.pem');
  const cert = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) return null;
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

// One hub, both transports. See the comment in signaling.js for why this is
// not two independent relays.
const hub = createSignalingHub();

/**
 * Loopback HTTP. This is the USB path and it is the good one.
 *
 * `http://localhost` is a secure context in Chromium, so WebXR and
 * getDisplayMedia both work over it with no certificate at all. Forward this
 * port onto the headset with `npm run usb` and neither end ever sees a
 * certificate warning.
 *
 * Bound to 127.0.0.1 deliberately: adb forwards to the host's loopback, so
 * there is no reason to expose an unencrypted server to the rest of the LAN.
 */
const httpServer = http.createServer(app);
hub.attach(httpServer);
httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log('\n  HyperCanvas is up.\n');
  console.log('  USB (recommended — no certificates, lower jitter, charges the headset):');
  console.log(`      Mac:    http://localhost:${HTTP_PORT}/sender`);
  console.log(`      Quest:  run "npm run usb", then open http://localhost:${HTTP_PORT}/\n`);
});

// HTTPS over the LAN, for when you would rather not be tethered.
const creds = loadCerts();
if (creds) {
  const httpsServer = https.createServer(creds, app);
  hub.attach(httpsServer);
  httpsServer.listen(PORT, '0.0.0.0', () => {
    const addrs = lanAddresses();
    console.log('  Wi-Fi (self-signed certificate — accept the warning once):');
    if (addrs.length === 0) {
      console.log('      no LAN address detected');
    } else {
      for (const a of addrs) console.log(`      Quest:  https://${a}:${PORT}/`);
    }
    console.log('');
  });
} else {
  console.log('  Wi-Fi mode is off: no certificate in ./certs — run "npm run certs" to enable it.');
  console.log('  USB mode needs no certificate, so you can ignore this.\n');
}
