import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { PlaylistDetailComponent } from '../src/app/features/playlists/playlist-detail/playlist-detail.component';

const entries = ['a', 'b', 'c', 'd'].map((id) => ({ id, trackId: id, addedAt: 0 }));
const reorder = (source: string, target: string, placement: 'before' | 'after') => {
  const component = { playlist: () => ({ entries }) };
  const result = (PlaylistDetailComponent.prototype as any).reorderedEntries.call(component, source, target, placement);
  return result?.map((entry: { id: string }) => entry.id).join('') ?? null;
};

describe('playlist drag reorder', () => {
  it('drops the dragged entry before or after the target', () => {
    expect(reorder('a', 'c', 'after')).toBe('bcad');
    expect(reorder('d', 'a', 'before')).toBe('dabc');
    expect(reorder('b', 'd', 'before')).toBe('acbd');
  });

  it('ignores drops that leave the order unchanged', () => {
    expect(reorder('a', 'b', 'before')).toBeNull();
    expect(reorder('c', 'b', 'after')).toBeNull();
    expect(reorder('a', 'missing', 'after')).toBeNull();
  });
});
