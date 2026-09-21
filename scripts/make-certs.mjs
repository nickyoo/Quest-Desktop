#!/usr/bin/env node
/**
 * Generates a self-signed cert covering localhost plus every LAN IPv4 address
 * this machine currently holds, so the same cert works from the Quest browser.
 *
 * Written against a config file rather than `-addext` because macOS ships
 * LibreSSL, whose flag support differs from OpenSSL's.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_DIR = path.join(ROOT, 'certs');
const DAYS = 3650;

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);

// Anything extra you want on the cert: `npm run certs -- quest.local 10.0.0.5`
const extra = process.argv.slice(2);
const extraHosts = extra.filter((a) => !/^\d+\.\d+\.\d+\.\d+$/.test(a));
const extraIps = extra.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));

const dns = ['localhost', os.hostname(), `${os.hostname()}.local`, ...extraHosts];
const allIps = [...new Set(['127.0.0.1', ...ips, ...extraIps])];

const altNames = [
  ...dns.map((d, i) => `DNS.${i + 1} = ${d}`),
  ...allIps.map((ip, i) => `IP.${i + 1} = ${ip}`),
].join('\n');

const config = `
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[dn]
CN = HyperCanvas Local

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}
`.trim();

fs.mkdirSync(CERT_DIR, { recursive: true });
const cnfPath = path.join(CERT_DIR, 'openssl.cnf');
fs.writeFileSync(cnfPath, config);

execFileSync(
  'openssl',
  [
    'req', '-x509', '-nodes',
    '-newkey', 'rsa:2048',
    '-keyout', path.join(CERT_DIR, 'key.pem'),
    '-out', path.join(CERT_DIR, 'cert.pem'),
    '-days', String(DAYS),
    '-config', cnfPath,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

console.log('\n  Certificate written to ./certs\n');
console.log('  Valid for:');
for (const d of dns) console.log(`      ${d}`);
for (const ip of allIps) console.log(`      ${ip}`);
console.log('\n  If your Mac changes networks, re-run this so the new IP is covered.\n');
