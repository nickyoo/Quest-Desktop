# HyperCanvas

A free, subscription-free spatial workspace: your Mac's display streamed into a
Meta Quest 3 as a curved ultrawide monitor inside a distraction-free 3D
environment, with an optional passthrough cutout so you can still see your
hands, keyboard, and coffee.

No accounts, no cloud, no monthly fee. Everything runs on your own hardware.

---

## Quick start — USB (recommended)

```bash
npm install
npm start         # in one terminal
npm run usb       # in another, with the headset plugged in and worn
```

Then:

1. **On the Mac** — open `http://localhost:3001/sender`, press **Start
   Broadcast**, pick the display you want to send.
2. **On the Quest** — open `http://localhost:3001/` in Meta Quest Browser.
3. Press **Enter Workspace**.

No certificates anywhere. `localhost` counts as a secure context in Chromium,
so WebXR and `getDisplayMedia` are both happy over plain HTTP.

USB is the better path for a desk setup on every axis that matters:

- **No certificate warnings**, on either end.
- **Far less jitter** than Wi-Fi. Jitter, not raw bandwidth, is what makes a
  stream feel stuttery — and USB has almost none.
- **It charges the headset.** The Quest 3 lasts about two hours on battery,
  which is the single biggest reason these setups get abandoned. Tethered, it
  runs all day.
- Even the stock USB-2 cable carries 480 Mbps, far past the 40–80 Mbps this
  needs. A faster cable is nice, not necessary.

Meta ships no Quest Link for macOS, so this is one thing the paid apps cannot
do on a Mac either.

**One-time setup:** the headset needs Developer Mode — Meta Horizon phone app →
your headset → Headset Settings → Developer Mode. You also need `adb`
(`brew install --cask android-platform-tools`). The first time you plug in,
there is an "Allow USB debugging?" prompt waiting *inside* the headset; put it
on and accept it. `npm run usb` detects and explains each of these if it trips.

The forward drops when you unplug or the headset reboots. Re-run `npm run usb`.

## Alternative — Wi-Fi

```bash
npm run certs     # self-signed cert covering localhost + your LAN IPs
npm start
```

Open `https://<your-mac-lan-ip>:3000/` on the headset; the server prints the
exact URL. Accept the certificate warning once (**Advanced → Proceed**) —
WebXR still gets a secure context after an override.

Re-run `npm run certs` whenever your Mac joins a different network; the
certificate is pinned to the IPs it had when generated.

Both transports share one signaling hub, so you can mix them — Mac on loopback,
headset over Wi-Fi — and the two ends still find each other.

---

## Your first test

Run `npm test` first. It checks everything that does not need a headset.

Then, in order:

1. **Two browser tabs on the Mac.** Open `/sender` in one and `/` in the other.
   Start the broadcast. The second tab should show "peer: connected" and the
   sender's stats table should show a resolution and a climbing Mbps. This
   proves capture, signaling, and WebRTC work before the headset is involved.
2. **Headset, flat page.** Open `/` on the Quest without entering XR. If the
   status line reports a session is ready, the transport is good.
3. **Enter Workspace.** You should land in the Deep Graphite void with a curved
   monitor in front of you.

### What to check once you are in

- Press **Y** for the status panel. `screen:` tells you whether you got the
  compositor layer or the textured-mesh fallback.
- Press **X** to switch between them and compare text sharpness directly.
- Press **A** to cycle environments, **B** for the desk portal.

### Likely first-contact failures

| Symptom | Cause |
|---|---|
| Black screen in the headset, no monitor | Broadcast not started, or the peer connection failed. Check the sender's stats table. |
| Monitor is there but frozen on one frame | The video element stopped decoding. Check that it is not `display:none`. |
| Panel says "textured mesh (…)" | The media layer was refused. The reason is printed; the fallback is fine to work in. |
| Everything is passthrough, no environment | The session fell back to `immersive-vr`, or the environment failed to build. |
| Text readable but soft | Expected on the fallback path. Press **X**. If it is already on the layer, lower your source resolution — see below. |

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

Text legibility is the whole game, and four things decide it.

**1. Use the compositor layer.** The client tries
`XRMediaBinding.createCylinderLayer()` first, which hands the video straight to
the Quest compositor at native panel resolution. The frame is sampled once
instead of three times (eye buffer → foveation → lens warp). If it fails, the
client falls back to a `VideoTexture` on a mesh and the status panel says so.
Press **X** to A/B them — trust your eyes over anyone's spec sheet.

**2. Raise the bitrate.** WebRTC defaults to a few Mbps because it assumes a
hostile network. Over USB or a good LAN you can afford 40–80. The sender page
writes the ceiling into both `setParameters` and the SDP, because
`setParameters` alone leaves Chrome's estimator crawling upward for 30 seconds.

**3. Keep `contentHint` on `text`.** This tells the encoder it is looking at
sharp-edged UI, not camera footage, so it stops smoothing away font hinting.
With `degradationPreference: 'maintain-resolution'` the encoder drops frames
rather than resolution when you scroll — which is what you want for code.

**4. Match the virtual display to the arc, not to 4K.** A 3840×1600 source on a
77° arc is about 50 source pixels per degree, but the Quest 3 panel resolves
roughly 20. You are discarding more than half of them and paying full encode
cost for the privilege. **2560×1080 at a larger UI scale usually reads better
than 3840×1600 downsampled.** Try both; this one surprises people.

For the virtual display itself, [BetterDisplay](https://github.com/waydabber/BetterDisplay)
has a free tier that creates arbitrary virtual screens. Sharing your built-in
display works too, you just lose the ultrawide shape.

### Reading the stats

`qualityLimitation` on the sender page is the fastest diagnostic:

- `bandwidth` — the link is the ceiling. On Wi-Fi, get on 5/6GHz in the same
  room as the router, or switch to USB. Raising the slider will not help.
- `cpu` — the encoder is struggling. Drop to 30fps or a smaller source.
- `none` — you are not limited. If it still looks soft the problem is the
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
painted into canvas textures. No model to download, no bake to run, no asset
pipeline. Every material is `MeshBasicMaterial`; there is not a single runtime
light in the project. That is what keeps the headset at 90Hz with headroom for
the video decoder.

The bunker's aperture sits above the monitor rather than at chest height as
originally specced — at chest height the screen hides it completely.

### How the desk portal works

In an `immersive-ar` session the compositor shows passthrough wherever the
framebuffer alpha is zero. So the portal does not draw a window — it draws an
invisible solid that writes **depth but no colour**, before anything else. Every
piece of virtual scenery behind it fails the depth test and never writes a
pixel, leaving untouched alpha that the headset fills with the real world.

The mask auto-fits to your real desk using WebXR plane detection if you have run
Space Setup and marked it. Otherwise hold the right grip and nudge it into
place; calibration persists in `localStorage`.

The mask deliberately extends well above the desk surface. Size it to the slab
alone and your hand gets swallowed by a virtual wall every time you lift it
mid-gesture.

---

## Architecture

```
macOS                                       Quest 3
─────                                       ───────
Virtual display (BetterDisplay)
  │
  ├─ getDisplayMedia ─────────────────▶ ScreenCaptureKit (via Chrome)
  │                                          │
  ├─ contentHint = 'text'                    │ VideoToolbox H.264 (hardware)
  ├─ maxBitrate + SDP munge                  │
  │                                          ▼
  └─ RTCPeerConnection ──── USB (adb reverse) ────▶ RTCPeerConnection
                       └─── or 5/6GHz Wi-Fi ──┘       │
                            host candidates only,     ├─ hardware decode → <video>
                            no STUN, no TURN          │
                                                      ├─ XRMediaBinding cylinder layer
                                                      │    (or VideoTexture fallback)
                                                      │
                                                      └─ Three.js immersive-ar session
                                                           ├─ procedural environment
                                                           ├─ depth-mask desk portal
                                                           └─ canvas status panel
```

A Node server serves the static client and relays WebSocket signaling over two
transports — loopback HTTP for USB, LAN HTTPS for Wi-Fi — sharing one peer
registry. It carries no media: once the peer connection is up, video goes
Mac → headset directly.

Your keyboard and mouse stay paired to the Mac over Bluetooth, so no input ever
touches the network. Head tracking only moves the view.

---

## Deliberately not built

**Blender bake pipeline.** The original plan called for modelling the bunker in
Blender, baking Cycles lighting to a 2048² atlas, and exporting Draco-compressed
`.glb`. The procedural environments hit the same look with no modelling, no bake
step, and no assets to keep in sync — and they are editable by changing a number
instead of reopening Blender. If you want real baked geometry later, the
`Environment` base class in `public/js/env/shared.js` is the only interface a
GLTF-loading environment needs to implement.

**Native Go/Pion capture daemon.** The claim that this cuts end-to-end latency
from ~60ms to ≤15ms does not survive contact with the numbers. Chrome's
`getDisplayMedia` on macOS already goes through ScreenCaptureKit with
VideoToolbox hardware encoding, so a native daemon is not replacing a software
path. Meanwhile the Quest's decode plus compositor costs one to two frames
(11–22ms at 90Hz) that no host-side daemon can touch. Realistic photon-to-photon
is around 45ms today, maybe 30ms with a perfect native pipeline — real, but a
week of Objective-C bridging for roughly a 25% cut. Use this first and find out
whether latency is even your complaint.

---

## Status

`npm test` covers the signaling relay (including the cross-transport case USB
mode depends on), the SDP munger, the module graph, and the screen geometry
maths — 26 checks, all passing.

**The WebXR and WebRTC paths have not been run against real hardware.** They
cannot be, from a Linux container with no headset. Expect to shake out bugs on
first contact, particularly around the media layer: `XRMediaBinding` is well
tested with ordinary video files and considerably less so with a
`MediaStream`-backed element. That is exactly why the textured-mesh fallback
exists and why the status panel always tells you which path is live.
