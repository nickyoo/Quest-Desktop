# HyperCanvas — orientation for Claude Code

Read this first. It routes you to the right place rather than repeating it.

## What this repo is

Your Mac's screen, streamed over WebRTC into a Quest 3 WebXR workspace. A tiny
Node server (`express` + `ws`) serves a static client and relays signaling; it
carries **no media** — once the peer connection is up, video goes Mac → headset
directly, over USB or the LAN.

No build step, no bundler, no framework. Plain ES modules in `public/`, loaded
through an importmap in `public/index.html`, with three.js vendored out of
`node_modules` so the headset never needs the internet.

- `README.md` — **the real documentation.** Setup, controls, tuning for
  sharpness, the environments, and an architecture diagram. Read the
  architecture section before touching anything in `server/` or `public/js/lib/`.
- `server/index.js` — two transports (loopback HTTP, LAN HTTPS), one app.
- `server/signaling.js` — the WebSocket relay **and the origin allowlist**.
- `public/js/sender.js` — the Mac side: capture, per-viewer peer connections.
- `public/js/quest.js` + `public/js/xr/` — the headset side.
- `scripts/selftest.mjs` — everything verifiable without a headset.
- `TESTING.md` — the staged testing runbook: what to check at each stage, and
  how to exercise the viewer page without putting the headset on.

## Commands

```bash
npm start      # the server (HTTP on 3001 loopback, HTTPS on 3000 if certs exist)
npm run dev    # same, with --watch
npm run usb     # adb reverse, so the headset can reach localhost:3001
npm run certs   # generate self-signed certs, enabling the Wi-Fi path
npm test        # selftest — run this before you put the headset on
```

There is no lint or typecheck step. `npm test` is the whole automated gate, and
it is fast; the loop it protects you from is "push, unplug, wear the headset,
discover a typo," which is slow.

## Security: this server is not as private as it looks

**Binding to loopback is not access control.** The single most important thing
to understand here:

> A WebSocket handshake is **not** subject to the same-origin policy. Any page
> on the public internet can open `ws://localhost:3001/ws` and the browser will
> perform the upgrade. Only the server can refuse it.

That is not theoretical. This exact hole shipped: the hub accepted every
handshake, so any site you visited while broadcasting could send
`{type:"hello",role:"viewer"}` then `{type:"request-stream"}` and receive an
SDP offer carrying `streams:[state.stream]` — your captured desktop — with no
prompt, because you had already granted the capture to the page being
impersonated.

`isAllowedOrigin` in `server/signaling.js` is the fix, and it is load-bearing:

- The `Origin` host must be loopback or a **current** LAN address of this
  machine, on a port we actually serve. Both halves matter.
- A **missing** `Origin` is allowed on purpose. Browsers always send one, so a
  handshake without it is a native client (the selftest among them) that an
  origin check could not identify anyway.
- The port list comes from `server/index.js` (`createSignalingHub({ ports })`).
  **If you add a transport or change a port, add it there** or that transport's
  own pages get rejected.

Its cases are pinned in `selftest.mjs` under "websocket origin policy". If you
change the policy, change those with it — a silent pass there is a screen leak.

More generally, when touching `server/`:

- **An open socket is an untrusted socket.** Every handler assumes the peer is
  hostile: `maxPayload` is capped, peers are capped, one `hello` per
  connection, and `signal`/`request-stream` require a peer that has actually
  greeted us. Keep that shape for anything new.
- **Never add STUN or TURN.** Host candidates only is a privacy property, not a
  cost saving — media must not leave the building. It is also why there is no
  signaling auth beyond the origin check: nothing here is reachable off-LAN.
- **Never serve `certs/`, and never commit it.** `.gitignore` covers it.
- `lanAddresses()` and `/api/host` disclose your local network layout. That's
  acceptable to your own pages; don't widen it with CORS headers.

## Efficiency: the frame budget is the product

This streams video to a headset at 72–90Hz. The rules that follow from that:

- **Nothing allocates per frame.** Hoist `Vector3`/`Matrix4`/`Quaternion`
  scratch objects outside the render loop and reuse them. A `new` in a
  per-frame path is the regression to watch for.
- **`XRMediaBinding` cylinder layer first, `VideoTexture` only as a fallback.**
  The layer path hands the compositor the decoded frame directly and is
  meaningfully sharper; the fallback re-samples through WebGL.
- **`Cache-Control: no-store` is deliberate** (`server/index.js`). The Quest
  Browser will otherwise serve you yesterday's JavaScript for an hour. Don't
  "optimise" it away.
- **Prefer a number over an asset.** The environments are procedural precisely
  so they are editable by changing a constant rather than reopening Blender —
  see README's "Deliberately not built."

## Commit style

Plain language, stating what broke and why the fix works, in the imperative —
e.g. `Reject WebSocket handshakes from origins that are not ours`. No
conventional-commits prefix. Where a commit fixes something subtle, the body
explains the mechanism, because the next reader will not have the context you
have right now.
