#!/usr/bin/env node
/**
 * Forwards the local HTTP server onto a USB-connected Quest.
 *
 * `adb reverse` opens a listening socket on the headset that tunnels back to
 * the Mac's loopback interface. The headset then loads the workspace from
 * http://localhost:<port>, and because Chromium treats localhost as a secure
 * context, WebXR works with no certificate involved at all.
 *
 * Bonus that matters more than it sounds: the cable charges the headset, so
 * you are no longer working against a two-hour battery.
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const PORT = Number(process.env.HTTP_PORT || 3001);

const CANDIDATES = [
  'adb',
  '/opt/homebrew/bin/adb',
  '/usr/local/bin/adb',
  `${os.homedir()}/Library/Android/sdk/platform-tools/adb`,
];

function findAdb() {
  for (const candidate of CANDIDATES) {
    try {
      if (candidate === 'adb') {
        execSync('command -v adb', { stdio: 'ignore' });
        return 'adb';
      }
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

function die(message, ...detail) {
  console.error(`\n  ${message}\n`);
  for (const d of detail) console.error(`  ${d}`);
  console.error('');
  process.exit(1);
}

const adb = findAdb();
if (!adb) {
  die(
    'adb not found.',
    'Install it with:  brew install --cask android-platform-tools',
    '(or brew install android-platform-tools on older Homebrew)',
  );
}

let raw;
try {
  raw = execFileSync(adb, ['devices'], { encoding: 'utf8' });
} catch (err) {
  die('Could not run adb.', err.message);
}

const devices = raw
  .split('\n')
  .slice(1)
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => {
    const [serial, state] = l.split(/\s+/);
    return { serial, state };
  });

if (devices.length === 0) {
  die(
    'No device found over USB.',
    'Checklist:',
    '  1. Developer Mode is on for this headset (Meta Horizon phone app ->',
    '     your headset -> Headset Settings -> Developer Mode).',
    '  2. The cable is plugged into the headset and the Mac.',
    '  3. The headset is awake and worn — it sleeps on the desk.',
  );
}

const unauthorized = devices.find((d) => d.state === 'unauthorized');
if (unauthorized) {
  die(
    'Headset is connected but has not authorised this Mac.',
    'Put the headset on. There is a "Allow USB debugging?" prompt waiting',
    'inside it — accept it, tick "Always allow", then re-run this.',
  );
}

const device = devices.find((d) => d.state === 'device');
if (!device) {
  die(`Headset is in state "${devices[0].state}" rather than "device".`, 'Unplug, replug, and try again.');
}

try {
  execFileSync(adb, ['-s', device.serial, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`], { stdio: 'ignore' });
} catch (err) {
  die('adb reverse failed.', err.message);
}

const active = execFileSync(adb, ['-s', device.serial, 'reverse', '--list'], { encoding: 'utf8' }).trim();

console.log(`\n  USB link established to ${device.serial}\n`);
console.log(`  ${active.split('\n').join('\n  ')}\n`);
console.log('  In the Quest browser, open:');
console.log(`      http://localhost:${PORT}/\n`);
console.log('  No certificate warning: localhost counts as a secure context,');
console.log('  so WebXR is happy over plain HTTP.\n');
console.log('  The forward drops if you unplug or the headset reboots —');
console.log('  just run this again.\n');
