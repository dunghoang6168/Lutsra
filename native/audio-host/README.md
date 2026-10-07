# Lutstra Native Audio Host

Windows 10/11 x64 only. This executable is a separate process and implements WASAPI
Shared and Exclusive DSP playback. It is the default playback backend; Chromium Shared remains as a
fallback when the host is missing or fails twice. Phase status and the acceptance
record live in `docs/AUDIO_ENGINE_PLAN.md` and `docs/AUDIO_ENGINE_PHASE3_CLOSEOUT.md`.

Electron owns the private named pipe and authenticates the host with a per-launch
nonce. Frames are little-endian uint32 length-prefixed JSON and are
rejected above 1 MiB. Media paths exist only between Main and the host.

The render thread is event-driven and registered with MMCSS `Pro Audio`. Decode and
resampling run on decoder workers and feed SPSC float PCM buffers. The render thread
owns the active and incoming decoder pointers. Control transfers decoders through a
fixed mailbox; render retires them to a bounded graveyard; telemetry joins and deletes
them. Render sends POD events to telemetry, which resolves track IDs and writes JSON.
Telemetry and path status read atomic snapshots and never dereference decoders.

Seek uses producer and consumer epochs. The decoder stops writing after a seek until
render discards old ring data and acknowledges the new epoch, including while paused.
The playback position counts samples actually consumed. Shared uses the Windows mix
format; Exclusive negotiates an integer stream from the source and endpoint capabilities.
Endpoint swaps reopen only decoders whose output rate or channels need to change.
Shared Mode is always reported as processed and never as bit-perfect. Spectrum
telemetry is an FFT of the pre-volume mono mix (Blackman window, ~43 ms at any rate,
0.78 smoothing, -90..-10 dB like the Chromium analyser), sent as 1024 bytes on a fixed
0..24 kHz axis while playing and capped near 30 FPS.

A prepared track is spliced gaplessly: when the active decoder has drained, render
fills the rest of the same WASAPI buffer from the prepared decoder and promotes it
without an `ended` round trip. The renderer follows through `trackAutoAdvanced$`.
Only prepare a track the queue really advances to; the renderer prepares nothing for
Repeat One or when no automatic successor exists.

Path status reports the engine mix (`outputFormat`, `outputSampleType`; always 32-bit
float in Shared Mode) and the hardware format Windows sends to the device
(`deviceFormat`, read live from `PKEY_AudioEngine_DeviceFormat`). In Exclusive,
`outputFormat` is integer with valid precision; `deviceFormat` is null, and
processingReasons reflects actual conversion, software volume and mute. Phase 5
never reports bit-perfect eligibility.

The MMDevice callback only signals a monitor thread. The monitor handles endpoint
changes and invalidation recovery. A new endpoint is created before replacing the old
one; failure on a different endpoint leaves the old stream playing. On the same physical
endpoint, release the old stream before initializing another mode/format. A failed
Shared-to-Exclusive switch restores Shared at the same position, paused; a failed
Exclusive-to-Shared switch returns once without automatic reopen.
`AUDCLNT_E_DEVICE_INVALIDATED`, service stops, and resource invalidation pause
playback and trigger retries. Recovery always leaves playback paused,
and a late invalidation is ignored once an endpoint swap (for example to fallback) has
already replaced the failed client. `play` retries an invalidated endpoint and returns
an error instead of silently doing nothing.
The shared buffer is 100 ms; normal rendering fills all space available from padding.
Playback waits up to 1.5 s for 250 ms of decoded data and primes the full WASAPI buffer
with silence before Start. Pause, load and endpoint swaps append a 10 ms fade after
queued music, consuming decoder samples only for the fade, then keep writing silence.
Shared render acknowledges when padding is no greater than the silence submitted
after the fade. Event-driven Exclusive alternates two buffers: the first event after
submitting the final fade starts that buffer, and the second drains it. Shared waits
at most buffer + fade + 20 ms from the request. Exclusive bounds submission at one
actual period + 20 ms, then bounds drain at 2 × actual period + fade + 20 ms from
the final successful ReleaseBuffer timestamp. This split was approved after the
80 ms phase test exposed the extra submission wait. Stop remains bounded even
when render/driver is unresponsive. Exclusive EOF similarly
fades/drains its last PCM buffer before reporting ended, so rate changes do not cut it off.
After a completed drain, the consumed decoder position matches the resume point and
Reset discards only silence. Pause publishes the final time before paused. Timeout or
invalidation can interrupt the drain. Every successful Start resets gain for a fade-in;
gapless splices keep gain.

Protocol version remains 1. `output-interrupted` is an event with reason
`device-invalidated` or `device-busy`. `OUTPUT_DEVICE_UNAVAILABLE`,
`OUTPUT_DEVICE_BUSY`, `OUTPUT_EXCLUSIVE_NOT_ALLOWED`, and
`OUTPUT_FORMAT_UNSUPPORTED` identify endpoint failures.
`statusJson` additionally reports an `underruns` counter. IPC keeps all responses and
critical events in order; `time` and `spectrum` keep only their newest pending frame.

## Build

1. `npm run prepare:audio-host` downloads the fixed LGPL-shared FFmpeg archive, checks
   its SHA-256, extracts headers/import libraries/DLLs, and retains matching source.
2. `npm run build:audio-host` discovers MSBuild with `vswhere`, builds C++20 x64, and
   copies the host, unchanged DLL names, notice, manifest, license, and source archive
   into `dist-electron/audio-host`.

Without these files the app falls back to the Chromium backend with a notice.
Do not replace the manifest URLs with `latest`.

Tests are opt-in: `npm run test:audio-host` runs native unit tests,
`npm run test:audio-host:smoke` checks the handshake and endpoints, and
`npm run test:audio-host:codecs` (muted) covers codecs, crossfade, gapless advance and
seeks, plus a muted Exclusive pass on TE-C. Both codecs and stress require TE-C
for their Exclusive acceptance pass; they never silently skip it. Set
`LUTSRA_STRESS_MUSIC_DIR` to a directory with at least three supported audio files,
then run `npm run test:audio-host:stress` for rapid load, seek, transition, and device
switching, including unawaited command bursts. It stays muted unless
`LUTSRA_STRESS_AUDIBLE=1`. The stress script uses local media paths only in requests
to the host.

## Manual acceptance matrix

- Outputs: Realtek, TE-C multimedia, TE-C communications, System Default.
- Codecs: FLAC, WAV, MP3, AAC/M4A, OGG Vorbis, Opus at 44.1/48/96 kHz.
- Actions: play/pause/seek/next, preload/crossfade, volume/mute ramps, visualizer.
- Recovery: unplug/replug, default change, suspend/resume, one host crash/restart,
  second crash fallback paused, malformed/oversize frame, decode error.
- While playing, change the active mix format in Windows Sound; verify pause or
  same-endpoint recovery, correct speed and channels, and no unintended autoplay.
- Let another app take the endpoint in Exclusive Mode; verify interruption notice,
  bounded retry, and an output error if recovery fails.
- Scan a large music library during playback; verify `ended` and every response still
  arrive despite heavy `time` and `spectrum` traffic.
- Packaging: NSIS x64 and portable x64 contain the same host/DLL/license/source set.

Never accept playback through an unselected default endpoint when fallback is off;
never auto-play after replug, backend switching, or crash fallback.

## Phase 5, batch 2 (2026-10-06)

M2/M3/M5/M6 implementation and automated checks are complete. The original
80 ms fade deadline failure was fixed with the approved split submission/drain
budgets and verified at eight pause phases. The human acceptance
record remains open in section 7 of docs/AUDIO_ENGINE_PHASE5_PLAN.md. See
docs/AUDIO_ENGINE_PHASE5_DOT2_REPORT.md for commits, raw output and captures.

- set-output-mode accepts shared/exclusive-dsp and bufferMs 10/20/40/80 (default 20).
- With no track loaded, remember the requested mode and defer Exclusive initialization
  until load knows the source format. Requested mode and actual stream mode can differ
  while idle or on fallback.
- TE-C 24-bit uses packed 24; Realtek 24-bit uses 32/24; 16-bit prefers 16/16.
- prepare compares the negotiated candidate with the current stream, including valid
  bits and container width; mismatches return false for renderer ended -> load.
- Replug, invalidation/sleep recovery and host rehydration use the saved mode/source
  and remain paused. Only disconnected-output System Default fallback uses Shared.
- Rehydration sends mode before device, restores seek position, and republishes its
  snapshot after Pause. A live host rejecting Exclusive stays Native, paused.
- status diagnostics bufferMs and stopFadeTimeouts expose actual period and bounded
  fade waits. kFormatSwitchPrerollMs remains 0 pending listening on TE-C.

Authorized unit/smoke/codecs/stress passed, including all four Exclusive periods
and eight pause phases at 80 ms without fade timeouts. Audio tests stayed muted; the
Exclusive passes owned TE-C temporarily. Stress used generated 44.1/48/96 kHz
fixtures: 605 requests, 605 responses, 10 endpoint and 10 mode switches. Settings
captures use status fixtures; they are UI evidence, not listening evidence.
