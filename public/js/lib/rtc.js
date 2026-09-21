/**
 * WebRTC tuning helpers.
 *
 * Defaults in WebRTC are built for video calls on bad networks: low bitrate,
 * and drop resolution the moment anything moves. Both are exactly wrong for a
 * code editor on a LAN, and leaving them alone is the single most common reason
 * a home-made VR desktop looks like a blurry mess.
 */

const H264_PROFILE_RANK = (fmtp = '') => {
  const m = /profile-level-id=([0-9a-fA-F]{6})/.exec(fmtp);
  if (!m) return 3;
  const profile = m[1].slice(0, 2).toLowerCase();
  if (profile === '64') return 0; // High — best for sharp text
  if (profile === '4d') return 1; // Main
  if (profile === '42') return 2; // Constrained Baseline
  return 3;
};

/**
 * Reorder the transceiver's codec list so `preferred` is negotiated first.
 * `preferred` is 'H264' | 'VP9' | 'VP8' | 'AV1', or 'auto' to leave it alone.
 */
export function preferCodec(transceiver, preferred) {
  if (preferred === 'auto' || !transceiver.setCodecPreferences) return null;
  const caps = RTCRtpSender.getCapabilities('video');
  if (!caps) return null;

  const wanted = `video/${preferred}`.toLowerCase();
  const match = caps.codecs.filter((c) => c.mimeType.toLowerCase() === wanted);
  if (match.length === 0) return null;

  if (preferred === 'H264') {
    match.sort((a, b) => H264_PROFILE_RANK(a.sdpFmtpLine) - H264_PROFILE_RANK(b.sdpFmtpLine));
  }

  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== wanted);
  transceiver.setCodecPreferences([...match, ...rest]);
  return match[0];
}

/**
 * Raise the encoder's ceiling and stop it trading resolution for smoothness.
 * Must run after the track is attached; safe to re-run whenever settings change.
 */
export async function tuneSender(sender, { maxBitrateMbps = 40, maxFramerate = 60 } = {}) {
  const params = sender.getParameters();
  if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

  params.degradationPreference = 'maintain-resolution';
  for (const enc of params.encodings) {
    enc.maxBitrate = Math.round(maxBitrateMbps * 1_000_000);
    enc.maxFramerate = maxFramerate;
    enc.networkPriority = 'high';
    enc.priority = 'high';
    enc.scaleResolutionDownBy = 1;
    delete enc.scalabilityMode;
  }

  await sender.setParameters(params);
  return sender.getParameters();
}

/**
 * setParameters alone is advisory — Chrome's bandwidth estimator still ramps
 * slowly and caps itself. Writing the ceiling into the SDP as well makes it
 * start near the target instead of crawling up over 30 seconds.
 */
export function mungeBitrate(sdp, { maxBitrateMbps = 40, startBitrateMbps = 20 } = {}) {
  const maxKbps = Math.round(maxBitrateMbps * 1000);
  const startKbps = Math.round(startBitrateMbps * 1000);
  const lines = sdp.split(/\r\n|\n/);
  const out = [];
  let inVideo = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('m=')) inVideo = line.startsWith('m=video');

    // Drop any bandwidth line the browser already wrote; ours replaces it.
    if (inVideo && line.startsWith('b=')) continue;

    out.push(line);

    // b= must sit immediately after the video section's c= line.
    if (inVideo && line.startsWith('c=')) {
      out.push(`b=AS:${maxKbps}`);
      out.push(`b=TIAS:${maxKbps * 1000}`);
    }

    if (inVideo && line.startsWith('a=fmtp:')) {
      const goog = `x-google-max-bitrate=${maxKbps};x-google-min-bitrate=${Math.round(
        startKbps / 2,
      )};x-google-start-bitrate=${startKbps}`;
      out[out.length - 1] = `${line};${goog}`;
    }
  }

  return out.join('\r\n');
}

/** Pull the handful of stats that actually tell you if the link is healthy. */
export async function readSenderStats(pc, prev = {}) {
  const report = await pc.getStats();
  const now = { ts: performance.now() };

  report.forEach((s) => {
    if (s.type === 'outbound-rtp' && s.kind === 'video') {
      now.bytesSent = s.bytesSent;
      now.framesSent = s.framesSent;
      now.fps = s.framesPerSecond;
      now.width = s.frameWidth;
      now.height = s.frameHeight;
      now.encoder = s.encoderImplementation;
      now.qualityLimitation = s.qualityLimitationReason;
      now.keyFrames = s.keyFramesEncoded;
    }
    if (s.type === 'remote-inbound-rtp' && s.kind === 'video') {
      now.rttMs = s.roundTripTime != null ? s.roundTripTime * 1000 : undefined;
      now.packetsLost = s.packetsLost;
      now.jitter = s.jitter;
    }
    if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
      now.currentRttMs = s.currentRoundTripTime != null ? s.currentRoundTripTime * 1000 : undefined;
    }
    if (s.type === 'codec' && s.mimeType?.startsWith('video/')) {
      now.codec = s.mimeType.split('/')[1];
    }
  });

  if (prev.ts && prev.bytesSent != null && now.bytesSent != null) {
    const dt = (now.ts - prev.ts) / 1000;
    now.mbps = ((now.bytesSent - prev.bytesSent) * 8) / dt / 1_000_000;
  }

  return now;
}
