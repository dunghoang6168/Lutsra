# Lutsra Native Audio Host (Beta)

Windows 10/11 x64 only. This executable is a separate process and implements WASAPI
Shared playback. Electron owns the private named pipe and authenticates the host with
a per-launch nonce. Frames are little-endian uint32 length-prefixed JSON and are
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

The MMDevice callback only signals a monitor thread. The monitor handles endpoint
changes and invalidation recovery. A new endpoint is created before replacing the old
one. `AUDCLNT_E_DEVICE_INVALIDATED`, service stops, and resource invalidation pause
playback and trigger retries. Only recovery on the same endpoint may resume playback.
The shared buffer is 100 ms; playback waits up to 1.5 s for 250 ms of decoded data and
primes the WASAPI buffer with silence before Start.

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

The ordinary Chromium backend remains the default and does not require these files.
Do not replace the manifest URLs with `latest`.

Tests are opt-in: `npm run test:audio-host` runs native unit tests. Set
`LUTSRA_STRESS_MUSIC_DIR` to a directory with at least three supported audio files,
then run `npm run test:audio-host:stress` for rapid load, seek, transition, and device
switching. The stress script uses local media paths only in requests to the host.

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
