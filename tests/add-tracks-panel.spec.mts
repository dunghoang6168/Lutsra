import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { insertOrder } from '../src/app/features/playlists/playlist-detail/playlist-detail.component';
import { validSettings } from '../electron/ipc/settings-validation';
import { isAddTracksTab } from '../src/app/core/models';

describe('insertOrder for tracks dropped from the Add tracks panel', () => {
  const before = ['a', 'b', 'c'];
  const after = ['a', 'b', 'c', 'x', 'y'];
  const order = (target: string | null, placement: 'before' | 'after') => insertOrder(before, after, target, placement).join('');

  it('places new entries before or after the drop row', () => {
    expect(order('a', 'before')).toBe('xyabc');
    expect(order('b', 'after')).toBe('abxyc');
    expect(order('c', 'after')).toBe('abcxy');
  });

  it('appends when dropped outside a row or on an unknown row', () => {
    expect(order(null, 'after')).toBe('abcxy');
    expect(order('gone', 'before')).toBe('abcxy');
  });

  it('works on an empty playlist', () => {
    expect(insertOrder([], ['x'], null, 'after')).toEqual(['x']);
  });
});

describe('addTracksTab setting', () => {
  it('accepts the four tabs and rejects anything else', () => {
    for (const tab of ['songs', 'albums', 'artists', 'folders']) {
      expect(isAddTracksTab(tab)).toBe(true);
      expect(validSettings({ addTracksTab: tab })).toEqual({ addTracksTab: tab });
    }
    expect(isAddTracksTab('playlists')).toBe(false);
    expect(() => validSettings({ addTracksTab: 'playlists' })).toThrow('Invalid Add tracks tab');
  });
});
