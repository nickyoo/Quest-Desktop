# HyperCanvas

A free, subscription-free spatial workspace: your Mac's display streamed into a
Meta Quest 3 as a curved ultrawide monitor inside a distraction-free 3D
environment, with an optional passthrough cutout so you can still see your
hands, keyboard, and coffee.

No accounts, no cloud, no monthly fee. Everything runs on your LAN.

---

## Quick start

```bash
npm install
npm run certs     # self-signed cert covering localhost + your LAN IPs
npm start
```

Then:

1. **On the Mac** — open `https://localhost:3000/sender`, press **Start
   Broadcast**, and pick the display you want to send.
2. **On the Quest 3** — open `https://<your-mac-lan-ip>:3000/` in Meta Quest
   Browser. The server prints the exact URL on startup.
3. Accept the certificate warning once (**Advanced → Proceed**), then press
   **Enter Workspace**.

Your keyboard and mouse stay paired to the Mac over Bluetooth. Nothing about
your input touches the network, so there is zero added input latency — head
tracking only moves the view.

### If you change networks

The certificate is pinned to the IP addresses your Mac had when you generated
it. Re-run `npm run certs` after joining a different Wi-Fi network.

---

## Controls

| Input | Action |
|---|---|
| **A** (right) | Cycle environment |
| **B** (right) | Toggle the passthrough desk portal |
| **X** (left) | Switch screen rendering mode (compositor layer ↔ textured mesh) |
| **Y** (left) | Show/hide the status panel |
| Left stick click | Recentre the screen on where you're looking |
| Right stick ↕ | Screen distance |
| Left stick ↕ | Screen height |
| **Hold right grip** | Desk calibration: right stick moves the portal, left stick ↕ sets desk height, **A** re-runs auto-fit, **X/Y** widen/narrow |

---

## Getting it sharp

Text legibility is the whole game, and it is mostly decided by four things.

**1. Use the compositor layer.** The client tries
`XRMediaBinding.createCylinderLayer()` first, which hands the video straight to
the Quest compositor at native panel resolution. The frame is sampled once
instead of three times (eye buffer → foveation → lens warp). If it fails, the
client silently falls back to a `VideoTexture` on a mesh and the status panel
says which mode is live. Press **X** to A/B them — trust your eyes.

**2. Raise the bitrate.** WebRTC defaults to a few Mbps because it assumes a
hostile network. On a LAN you can afford 40–80. The sender page exposes this
directly, and writes the ceiling into both `setParameters` and the SDP, because
`setParameters` alone leaves Chrome's estimator crawling up for 30 seconds.

**3. Keep `contentHint` on `text`.** This tells the encoder it is looking at
sharp-edged UI, not camera footage, so it stops smoothing away font hinting.
Combined with `degradationPreference: 'maintain-resolution'`, the encoder drops
frames rather than resolution when you scroll fast — which is what you want for
code.

**4. Match the virtual display to the arc, not to 4K.** A 3840×1600 source
mapped onto a 77° arc gives about 50 source pixels per degree, but the Quest 3
panel only resolves roughly 20. You are throwing away more than half of them
and paying full encode cost for the privilege. **2560×1080 at a larger UI scale
usually reads better than 3840×1600 downsampled.** Try both.

For the virtual display itself, [BetterDisplay](https://github.com/waydabber/BetterDisplay)
has a free tier that creates arbitrary virtual screens. Sharing your built-in
display works too, you just lose the ultrawide shape.

### Reading the status panel

`qualityLimitation` on the sender page is the fastest diagnostic:

- `bandwidth` — your Wi-Fi is the ceiling. Get on 5GHz or 6GHz, same room as
  the router. Raising the slider will not help.
- `cpu` — the encoder is struggling. Drop to 30fps or a smaller source.
- `none` — you are not limited; if it still looks soft, the problem is the
  render path, not the link. Press **X**.

---

## Environments

| | | |
|---|---|---|
| **Deep Graphite** | `void` | Infinite fading grid, distance fog, suspended dust. Nothing to look at, which is the point. |
| **Monolith Bunker** | `bunker` | Cast concrete, recessed amber channels, and a slot window onto a black void with distant red beacons. |
| **Heavy Cab** | `cab` | Locomotive cabin: roll cage, faceted safety glass, analog console deck, heavy rain outside. |
| **Desk Portal** | overlay | Passthrough cutout revealing your real desk. Toggles on top of any of the above. |

All three are procedural — generated in JavaScript at load time, with lighting
painted into canvas textures. There is no model to download, no bake to run,
and no asset pipeline. Every material is `MeshBasicMaterial`; there is not a
single runtime light in the project. That is what keeps the headset at 90Hz
with headroom for the video decoder.

### How the desk portal works

In an `immersive-ar` session the compositor shows passthrough wherever the
framebuffer alpha is zero. So the portal does not draw a window — it draws an
invisible solid that writes **depth but no colour**, before anything else. Every
piece of virtual scenery behind it fails the depth test and never writes a
pixel, leaving untouched alpha that the headset fills with the real world.

The mask auto-fits to your actual desk using WebXR plane detection, if you have
run Space Setup and marked it. Otherwise hold the right grip and nudge it into
place; the calibration is saved to `localStorage`.

The mask deliberately extends well above the desk surface. Size it to the desk
slab alone and your hand gets swallowed by a virtual wall every time you lift it
mid-gesture.

---

## Architecture

```
macOS                                      Quest 3
─────                                      ───────
Virtual display (BetterDisplay)
  │
  ├─ getDisplayMedia  ──────────────▶ ScreenCaptureKit (via Chrome)
  │                                        │
  ├─ contentHint = 'text'                  │  VideoToolbox H.264 (hardware)
  ├─ maxBitrate + SDP munge                │
  │                                        ▼
  └─ RTCPeerConnection ───── 5/6GHz Wi-Fi ────▶ RTCPeerConnection
                             host candidates       │
                             only, no STUN/TURN    ├─ hardware decode → <video>
                                                   │
                                                   ├─ XRMediaBinding cylinder layer
                                                   │     (or VideoTexture fallback)
                                                   │
                                                   └─ Three.js immersive-ar session
                                                        ├─ procedural environment
                                                        ├─ depth-mask desk portal
                                                        └─ canvas status panel
```

A Node HTTPS server serves the static client and relays WebSocket signaling.
It carries no media — once the peer connection is up, video goes Mac → headset
directly.

---

## Deliberately not built

**Blender bake pipeline.** The original plan called for modelling the bunker in
Blender, baking Cycles lighting to a 2048² atlas, and exporting Draco-compressed
`.glb`. The procedural environments here hit the same look with no modelling, no
bake step, and no assets to keep in sync — and they are editable by changing a
number instead of reopening Blender. If you want real baked geometry later, the
`Environment` base class in `public/js/env/shared.js` is the only thing a
GLTF-loading environment would need to implement.

**Native Go/Pion capture daemon.** The claim that this cuts end-to-end latency
from ~60ms to ≤15ms does not survive contact with the numbers. Chrome's
`getDisplayMedia` on macOS already goes through ScreenCaptureKit with
VideoToolbox hardware encoding, so a native daemon is not replacing a software
path. Meanwhile the Quest's video decode plus compositor costs one to two frames
(11–22ms at 90Hz) that no host-side daemon can touch. Realistic photon-to-photon
is around 45ms today and maybe 30ms with a perfect native pipeline — a real
improvement, but a week of Objective-C bridging for roughly a 25% cut. Live with
this first and see whether latency is even your complaint.

---

## Status

Signaling, SDP munging, and screen geometry are covered by tests that run
headlessly. **The WebXR and WebRTC paths have not been run against actual Quest
hardware** — they cannot be, from a Linux container with no headset. Expect to
shake out real bugs on first contact, particularly around the media layer:
`XRMediaBinding` is well-tested with ordinary video files and considerably less
so with a `MediaStream`-backed element, which is exactly why the textured-mesh
fallback exists and why the status panel always tells you which path is live.
