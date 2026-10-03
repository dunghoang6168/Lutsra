import { PlaybackState } from '../models';

export type MediaPlaybackEvent = 'load' | 'play' | 'pause' | 'waiting' | 'stalled' | 'canplay' | 'seeked' | 'ended' | 'error';

export function stateForMediaEvent(event: MediaPlaybackEvent, paused: boolean): PlaybackState {
  switch (event) {
    case 'load': return 'loading';
    case 'play': return 'playing';
    case 'pause': return 'paused';
    case 'waiting':
    case 'stalled': return paused ? 'paused' : 'buffering';
    case 'canplay':
    case 'seeked': return paused ? 'paused' : 'playing';
    case 'ended': return 'ended';
    case 'error': return 'error';
  }
}

export function nextPlayableQueueIndex(length: number, start: number, canWrap: boolean, playable: (index: number) => boolean): number {
  if (length <= 0 || start < 0 || start >= length) return -1;
  for (let offset = 1; offset <= length; offset++) {
    const raw = start + offset;
    if (raw >= length && !canWrap) return -1;
    const index = raw % length;
    if (playable(index)) return index;
  }
  return -1;
}
