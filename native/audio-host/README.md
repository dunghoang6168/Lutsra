# Lutsra Native Audio Host

Windows 10/11 x64 only. This executable is a separate process and implements WASAPI
Shared playback. It is the default playback backend; Chromium Shared remains as a
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
The playback position counts samples actually consumed. WASAPI's endpoint mix format
is authoritative; changing it reopens both decoders at their current positions.
Shared Mode is always reported as processed and never as bit-perfect. Spectrum
telemetry contains 128 post-mixer time-domain peak bins and is capped near 30 FPS.

A prepared track is spliced gaplessly: when the active decoder has drained, render
fills the rest of the same WASAPI buffer from the prepared decoder and promotes it
without an `ended` round trip. The renderer follows through `trackAutoAdvanced$`.
Only prepare a track the queue really advances to; the renderer prepares nothing for
Repeat One or when no automatic successor exists.

Path status reports the engine mix (`outputFormat`, `outputSampleType`; always 32-bit
float in Shared Mode) and the hardware format Windows sends to the device
(`deviceFormat`, read live from `PKEY_AudioEngine_DeviceFormat`).

The MMDevice callback only signals a monitor thread. The monitor handles endpoint
changes and invalidation recovery. A new endpoint is created before replacing the old
one. `AUDCLNT_E_DEVICE_INVALIDATED`, service stops, and resource invalidation pause
playback and trigger retries. Only recovery on the same endpoint may resume playback,
and a late invalidation is ignored once an endpoint swap (for example to fallback) has
already replaced the failed client. `play` retries an invalidated endpoint and returns
an error instead of silently doing nothing.
The shared buffer allocation is 100 ms; render queues at most 30 ms so a 10 ms
stop fade can reach the output within the 50 ms control deadline. Playback waits up
to 1.5 s for 250 ms of decoded data and primes up to 30 ms with silence before Start.
Pause, load and endpoint swaps fade on render, then acknowledge after padding shows
the ramp was consumed. Control stops immediately on invalidation or after the bounded
deadline. Every successful Start resets gain for a fade-in; gapless splices keep gain.

Protocol version remains 1. `output-interrupted` is an event with reason
`device-invalidated` or `device-busy`. `OUTPUT_DEVICE_UNAVAILABLE`,
`OUTPUT_DEVICE_BUSY`, and `OUTPUT_FORMAT_UNSUPPORTED` identify endpoint failures.
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
seeks. Set
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
