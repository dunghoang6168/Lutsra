# Lutsra Native Audio Host (Beta)

Windows 10/11 x64 only. This executable is a separate process and implements WASAPI
Shared playback. Electron owns the private named pipe and authenticates the host with
a per-launch nonce. Frames are little-endian uint32 length-prefixed JSON and are
rejected above 1 MiB. Media paths exist only between Main and the host.

The render thread is event-driven and registered with MMCSS `Pro Audio`. Decode and
resampling run on decoder workers and feed SPSC float PCM buffers. WASAPI's endpoint
mix format is authoritative. Shared Mode is always reported as processed and never as
bit-perfect. Spectrum telemetry contains 128 post-mixer bins and is capped near 30 FPS.

## Build

1. `npm run prepare:audio-host` downloads the fixed LGPL-shared FFmpeg archive, checks
   its SHA-256, extracts headers/import libraries/DLLs, and retains matching source.
2. `npm run build:audio-host` discovers MSBuild with `vswhere`, builds C++20 x64, and
   copies the host, unchanged DLL names, notice, manifest, license, and source archive
   into `dist-electron/audio-host`.

The ordinary Chromium backend remains the default and does not require these files.
Do not replace the manifest URLs with `latest`.

## Manual acceptance matrix

- Outputs: Realtek, TE-C multimedia, TE-C communications, System Default.
- Codecs: FLAC, WAV, MP3, AAC/M4A, OGG Vorbis, Opus at 44.1/48/96 kHz.
- Actions: play/pause/seek/next, preload/crossfade, volume/mute ramps, visualizer.
- Recovery: unplug/replug, default change, suspend/resume, one host crash/restart,
  second crash fallback paused, malformed/oversize frame, decode error.
- Packaging: NSIS x64 and portable x64 contain the same host/DLL/license/source set.

Never accept playback through an unselected default endpoint when fallback is off;
never auto-play after replug, backend switching, or crash fallback.
