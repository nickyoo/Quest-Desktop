# Testing HyperCanvas

Test in stages. Each stage adds exactly one new variable, so when something
breaks you already know which layer owns it. Skipping straight to "put the
headset on" is how you end up staring at a black screen with five candidate
causes and no way to separate them.

```
Stage 0   npm test                    no browser, no headset
Stage 1   two Mac browser tabs        + capture, signalling, WebRTC
Stage 2   transport to the headset    + USB or Wi-Fi
Stage 3   flat page on the headset    + the headset's browser and decoder
Stage 4   enter XR                    + WebXR, layers, rendering
Stage 5   feature sweep               + environments, portal, controls
Stage 6   tuning sweep                + image quality decisions
Stage 7   endurance                   + thermals, battery, drift
```

Stages 0–3 need no headset on your face. Do them at the desk.

---

## Before you start

| Need | Check |
|---|---|
| Node 20+ | `node --version` |
| Dependencies | `npm install` |
| A second display to share | Optional but better — see "Choosing a source" below |
| **USB only:** `adb` | `brew install --cask android-platform-tools` |
| **USB only:** Developer Mode | Meta Horizon phone app → your headset → Headset Settings → Developer Mode |
| **Wi-Fi only:** certificates | `npm run certs` |

### Choosing a source

You can share your built-in display, and for a first test you should — one less
moving part. Once it works, a virtual ultrawide from
[BetterDisplay](https://github.com/waydabber/BetterDisplay) (free tier) is what
makes this feel like a real workstation rather than a floating laptop screen.

Do not create the virtual display until Stage 4 passes. It is a variable you do
not need yet.

---

## Stage 0 — Headless

```bash
npm test
```

Expect **28 checks, all passing**. What each group proves:

| Group | Proves |
|---|---|
| module graph | No typo'd import paths, importmap targets exist on disk |
| sdp munger | Bitrate ceilings land in the right SDP section and do not corrupt the offer |
| screen geometry | The curved screen preserves the source aspect ratio (no stretched pixels) |
| signaling relay | Offer/answer/ICE all route, and disconnects are cleaned up |
| shared hub | A sender on one transport can reach a viewer on the other — this is what USB mode depends on |

**If this fails, stop.** Nothing downstream can work. The failing check names
the file.

---

## Stage 1 — Two Mac browser tabs

The highest-value stage. It exercises screen capture, the encoder, signaling,
and the full WebRTC path **with zero XR involvement.**

```bash
npm start
```

Expect a banner listing a USB URL and, if you generated certificates, a Wi-Fi
URL. Then, in Chrome on the Mac:

1. **Tab A:** `http://localhost:3001/sender`
2. **Tab B:** `http://localhost:3001/`
3. In Tab A, press **Start Broadcast** and pick a display.

### What should happen

**Tab A (sender):**
- Header badge flips to `broadcasting`
- `1 headset(s) connected` — Tab B counts as a viewer
- A preview of the shared display appears
- The stats table gains a row within a second or two

**Tab B (viewer):**
- A preview panel appears showing your Mac's screen
- The stats block below it populates

### Record these numbers

From Tab A's stats table:

```
resolution   ______   should match what you shared
fps          ______   should approach your target
Mbps         ______   should climb to near your slider within ~5s
codec        ______   H264 unless you changed it
rtt ms       ______   sub-millisecond on loopback
limited by   ______   want "none"
```

**Both tabs decode the same stream on one machine here, so `fps` and CPU load
are pessimistic. Do not judge quality at this stage** — judge only that data is
flowing and the numbers are sane.

### If Stage 1 fails

| Symptom | Cause |
|---|---|
| No display picker appears | `getDisplayMedia` was blocked. macOS requires Screen Recording permission for your browser: System Settings → Privacy & Security → Screen Recording. **Quit and reopen the browser fully after granting it** — a reload is not enough. |
| Picker appears, `0 headsets connected` | Tab B is not connected. Check the browser console in Tab B for WebSocket errors. |
| Connects, but Mbps stays near 0 | Encoder is not producing. Check `limited by` — `cpu` means drop the frame rate. |
| Stats row never appears | The peer connection failed. Check Tab A's log panel for `failed`. |

---

## Stage 2 — Get the page onto the headset

### USB path

Plug the headset in. **Put it on** — it sleeps on the desk and a sleeping
headset does not enumerate over USB.

```bash
npm run usb
```

Expect `USB link established to <serial>` and a `reverse` entry.

| Error | Fix |
|---|---|
| `adb not found` | `brew install --cask android-platform-tools` |
| `No device found over USB` | Developer Mode off, cable is charge-only, or the headset is asleep. Try a different cable — this is the most common cause. |
| `has not authorised this Mac` | Put the headset on. There is an "Allow USB debugging?" dialog waiting inside it. Accept, tick "Always allow", re-run. |

The forward dies when you unplug or the headset reboots. Just re-run it.

### Wi-Fi path

```bash
npm run certs   # once per network
npm start
```

Use the `https://<lan-ip>:3000/` URL the banner prints. Accept the warning:
**Advanced → Proceed**. WebXR still gets a secure context after an override.

Both transports share one signaling hub, so it is fine to run the sender on
loopback and the headset over Wi-Fi.

---

## Stage 3 — Flat page on the headset

**Do not press Enter Workspace yet.**

Open the URL in Meta Quest Browser. With the broadcast running from Stage 1:

- [ ] The page loads and is styled (not a wall of unstyled text)
- [ ] The preview panel shows your Mac's screen
- [ ] The stats block populates
- [ ] The status line reads `passthrough session ready`

**This is the important checkpoint.** If the preview shows your desktop here,
then capture, encoding, the network, and the headset's hardware decoder all
work. Everything after this point is WebXR and rendering — a completely
separate failure domain.

Record from the stats block:

```
source     ______
codec      ______   and the decoder name in brackets
rate       ______ fps  ______ Mbps
latency    ______ ms rtt     USB should beat Wi-Fi noticeably
```

| Symptom | Cause |
|---|---|
| Page will not load | Forward dropped (re-run `npm run usb`), or wrong URL. Quest uses `localhost:3001`, not your Mac's IP. |
| Loads unstyled / console errors | An asset 404'd. Check the server log. |
| Page loads, preview stays blank | Signaling reached the headset but media did not. Check the sender's peer count. |
| `WebXR not available` | You are on plain `http://` with a LAN IP. Only `localhost` and `https://` are secure contexts. |

---

## Stage 4 — Enter XR

Press **Enter Workspace**. Expect: the Deep Graphite void — a dark space with a
faint fading floor grid — and a curved monitor floating in front of you at about
eye height.

Then press **Y** for the status panel and read the `screen:` line.

| `screen:` reads | Meaning |
|---|---|
| `compositor layer` | Best case. The video is going straight to the compositor at native resolution. |
| `textured mesh` | Fallback. Still fully usable; text will be softer. The reason is printed in the status line on the flat page. |

**Now press X** to switch between them and look at the same text both ways.
Trust your eyes over any spec sheet — and tell me which you prefer, because it
tells me whether the layer path is worth its complexity.

| Symptom | Cause |
|---|---|
| Black, no monitor | Stream not arriving. Back to Stage 3. |
| Monitor present, frozen on one frame | Video element stopped decoding. Regression in the off-screen handling. |
| Monitor floats but no environment | Environment failed to build. Check the flat page's console. |
| You can see your real room | Session fell back to `immersive-vr`, or the environment shell is not enclosing. |
| Text soft on **both** X modes | Not a render bug — see Stage 6. |

---

## Stage 5 — Feature sweep

Work through these in one session:

- [ ] **A** cycles Deep Graphite → Monolith Bunker → Heavy Cab, no stutter on switch
- [ ] In the bunker, the aperture slot is visible **above** the monitor with red beacons beyond it
- [ ] In the cab, rain falls outside the windshield and the voltmeter flickers
- [ ] **Left stick click** recentres the screen on your gaze
- [ ] **Right stick ↕** moves the screen nearer/further
- [ ] **Left stick ↕** raises/lowers it
- [ ] **Y** toggles the status panel

### Desk portal

- [ ] **B** opens a hole in the virtual world where your real desk is
- [ ] Your hands and keyboard are visible through it
- [ ] **Lift a hand to head height — it should stay visible**, not vanish into a virtual wall

That last one is the real test. If your hand disappears, the mask needs more
headroom and I will raise the default.

If the cutout is in the wrong place, hold the **right grip**:
- Right stick moves it, left stick ↕ sets desk height
- **A** re-runs auto-fit from plane detection
- **X / Y** widen / narrow

Check the panel's `desk portal:` line. If it says `detected plane`, plane
detection found your real desk. If it says `manual` or `default`, it did not —
run Space Setup on the headset and mark your desk, then press **B** twice.

Calibration persists, so you only do this once.

---

## Stage 6 — Tuning sweep

Only once Stages 4–5 pass. Change **one variable at a time** and keep the same
text on screen for every comparison.

### Bitrate

Slide from 10 → 40 → 80 Mbps, pausing ~10 seconds each. Find where it stops
improving. That number is your link's ceiling; going past it just wastes CPU.

### Resolution — the one that surprises people

Compare **3840×1600** against **2560×1080 with a larger UI scale.**

A 3840-wide source on a 77° arc is roughly 50 source pixels per degree. The
Quest 3 panel resolves about 20. You are throwing away more than half your
pixels and paying full encode cost for them. Fewer, larger pixels frequently
read better. Test it rather than assuming.

### Content hint

Switch `text` → `motion` while scrolling code. `text` should hold detail and
drop frames; `motion` should stay smooth and smear. Confirm you prefer `text`
for code — then switch to `motion` if you ever watch video in there.

### Codec

H.264 is hardware-encoded on the Mac and hardware-decoded on the Quest. VP9
handles sharp text better per bit but encodes in software on macOS, which will
cook your CPU at high resolutions. Try it; watch `limited by` go to `cpu`.

---

## Stage 7 — Endurance

Real work, 30+ minutes:

- [ ] Screen stays put — no drift
- [ ] No progressive frame-rate decay as the headset warms
- [ ] `dropped` frames stay flat, not climbing
- [ ] Text still comfortable after 20 minutes (the honest comfort test)
- [ ] On USB, battery holds steady or climbs

---

## What to send me

If something breaks, these four things narrow it faster than any description:

1. **Which stage failed** — that alone isolates the layer
2. **The `screen:` line** from the status panel
3. **The sender's `limited by` column**
4. **Console output** from the flat page on the headset

If it *works*, I still want two things: which **X** mode looked better, and
whether your hand survived the desk portal test.
