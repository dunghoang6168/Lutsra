import { effect, inject, Injectable, InjectionToken, NgZone, OnDestroy } from '@angular/core';
import { Track } from '../models';
import { PlayerService } from '../player/player.service';
import { getDesktopApi, type NativeMediaKeyAction } from '../desktop/desktop-api';

type MediaMetadataFactory = (init: MediaMetadataInit) => MediaMetadata | null;

export const MEDIA_SESSION = new InjectionToken<MediaSession | null>('MEDIA_SESSION', {
  providedIn: 'root',
  factory: () => typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession ?? null
    : null,
});

export const MEDIA_METADATA_FACTORY = new InjectionToken<MediaMetadataFactory>('MEDIA_METADATA_FACTORY', {
  providedIn: 'root',
  factory: () => (init) => typeof MediaMetadata === 'undefined' ? null : new MediaMetadata(init),
});

const ACTIONS: readonly MediaSessionAction[] = [
  'play',
  'pause',
  'previoustrack',
  'nexttrack',
  'stop',
  'seekbackward',
  'seekforward',
  'seekto',
];

const DEFAULT_SEEK_OFFSET_SECONDS = 10;

@Injectable({ providedIn: 'root' })
export class MediaSessionService implements OnDestroy {
  private readonly player = inject(PlayerService);
  private readonly mediaSession = inject(MEDIA_SESSION);
  private readonly metadataFactory = inject(MEDIA_METADATA_FACTORY);
  private readonly zone = inject(NgZone);
  private readonly registeredActions = new Set<MediaSessionAction>();
  private readonly removeNativeMediaKeyListener: (() => void) | null;

  constructor() {
    this.removeNativeMediaKeyListener = getDesktopApi()?.mediaKeys?.onAction((action) => this.handleNativeMediaKey(action)) ?? null;
    if (!this.mediaSession) return;

    this.registerActionHandlers();

    effect(() => this.syncMetadata(this.player.currentTrack()));
    effect(() => this.syncPlaybackState(this.player.currentTrack(), this.player.playbackState()));
    effect(() => this.syncPosition(
      this.player.currentTrack(),
      this.player.duration(),
      this.player.currentTime(),
      this.player.playbackState(),
    ));
  }

  ngOnDestroy(): void {
    this.removeNativeMediaKeyListener?.();
    if (!this.mediaSession) return;

    for (const action of this.registeredActions) {
      try {
        this.mediaSession.setActionHandler(action, null);
      } catch {
        // Chromium can reject individual actions depending on the platform.
      }
    }
    this.registeredActions.clear();

    try {
      this.mediaSession.metadata = null;
      this.mediaSession.playbackState = 'none';
      this.mediaSession.setPositionState();
    } catch {
      // Cleanup remains best-effort when the API is only partially supported.
    }
  }

  private registerActionHandlers(): void {
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => this.run(() => void this.player.play().catch(() => undefined)),
      pause: () => this.run(() => this.player.pause()),
      previoustrack: () => this.run(() => void this.player.previous().catch(() => undefined)),
      nexttrack: () => this.run(() => void this.player.next().catch(() => undefined)),
      stop: () => this.run(() => this.player.stop()),
      seekbackward: (details) => this.run(() => {
        const offset = finiteOrDefault(details.seekOffset, DEFAULT_SEEK_OFFSET_SECONDS);
        this.player.seekBy(-Math.abs(offset));
      }),
      seekforward: (details) => this.run(() => {
        const offset = finiteOrDefault(details.seekOffset, DEFAULT_SEEK_OFFSET_SECONDS);
        this.player.seekBy(Math.abs(offset));
      }),
      seekto: (details) => this.run(() => {
        if (Number.isFinite(details.seekTime)) this.player.seek(details.seekTime as number);
      }),
    };

    for (const action of ACTIONS) {
      try {
        this.mediaSession!.setActionHandler(action, handlers[action] ?? null);
        this.registeredActions.add(action);
      } catch {
        // Ignore actions not implemented by the current Chromium/platform pair.
      }
    }
  }

  private run(callback: () => void): void {
    this.zone.run(callback);
  }

  private handleNativeMediaKey(action: NativeMediaKeyAction): void {
    this.run(() => {
      if (action === 'play-pause') void this.player.togglePlayPause().catch(() => undefined);
      else if (action === 'previous') void this.player.previous().catch(() => undefined);
      else if (action === 'next') void this.player.next().catch(() => undefined);
      else this.player.stop();
    });
  }

  private syncMetadata(track: Track | null): void {
    if (!this.mediaSession) return;
    if (!track) {
      try {
        this.mediaSession.metadata = null;
      } catch {
        // A partially implemented API must not affect playback.
      }
      return;
    }

    const base: MediaMetadataInit = {
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
    };
    const withArtwork: MediaMetadataInit = track.artwork
      ? { ...base, artwork: [{ src: track.artwork }] }
      : base;

    try {
      this.mediaSession.metadata = this.metadataFactory(withArtwork);
    } catch {
      try {
        this.mediaSession.metadata = this.metadataFactory(base);
      } catch {
        this.mediaSession.metadata = null;
      }
    }
  }

  private syncPlaybackState(track: Track | null, state: string): void {
    if (!this.mediaSession) return;
    const playbackState: MediaSessionPlaybackState = !track
      ? 'none'
      : state === 'playing' ? 'playing' : 'paused';

    try {
      this.mediaSession.playbackState = playbackState;
    } catch {
      // Older Chromium builds may expose Media Session without playbackState.
    }
  }

  private syncPosition(
    track: Track | null,
    duration: number,
    currentTime: number,
    _playbackState: string,
  ): void {
    if (!this.mediaSession) return;

    try {
      if (!track || !Number.isFinite(duration) || duration <= 0) {
        this.mediaSession.setPositionState();
        return;
      }

      const finitePosition = Number.isFinite(currentTime) ? currentTime : 0;
      this.mediaSession.setPositionState({
        duration,
        position: Math.max(0, Math.min(finitePosition, duration)),
        playbackRate: 1,
      });
    } catch {
      // Invalid or unsupported position state must never affect playback.
    }
  }
}

function finiteOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
