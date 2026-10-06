import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRef, Injector, runInInjectionContext } from '@angular/core';
import { PlaylistsComponent } from '../src/app/features/playlists/playlists.component';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../src/app/core/contracts';
import { PlayerService } from '../src/app/core/player/player.service';
import { QueueActionsService } from '../src/app/core/player/queue-actions.service';
import type { Playlist } from '../src/app/core/models';

const playlist = (id: string): Playlist => ({ id, name: `Playlist ${id}`, entries: [], createdAt: 0, updatedAt: 0 });
const click = { stopPropagation: () => {} } as MouseEvent;

function harness(initial: Playlist[]) {
  const gateway = { deletePlaylist: vi.fn(async (_id: string) => {}) };
  const injector = Injector.create({
    providers: [
      { provide: PLAYLIST_GATEWAY, useValue: gateway },
      { provide: LIBRARY_GATEWAY, useValue: {} },
      { provide: PlayerService, useValue: {} },
      { provide: QueueActionsService, useValue: {} },
      { provide: ElementRef, useValue: new ElementRef(null) },
    ],
  });
  const component = runInInjectionContext(injector, () => new PlaylistsComponent());
  component.playlists.set(initial);
  const visibleIds = () => component.visiblePlaylists().map((p) => p.id);
  return { component, gateway, visibleIds, destroy: () => (injector as unknown as { destroy(): void }).destroy() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('playlist delete with undo', () => {
  it('hides at once and deletes once when the undo window ends', async () => {
    const { component, gateway, visibleIds } = harness([playlist('a'), playlist('b')]);
    component.onDeletePlaylist(click, component.playlists()[0]);

    expect(visibleIds()).toEqual(['b']);
    expect(component.pendingDelete()?.id).toBe('a');
    await vi.advanceTimersByTimeAsync(5999);
    expect(gateway.deletePlaylist).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(gateway.deletePlaylist).toHaveBeenCalledExactlyOnceWith('a');
    expect(component.playlists().map((p) => p.id)).toEqual(['b']);
    expect(component.pendingDelete()).toBeNull();
  });

  it('undo restores the playlist in place and never deletes it', async () => {
    const { component, gateway, visibleIds } = harness([playlist('a'), playlist('b'), playlist('c')]);
    component.onDeletePlaylist(click, component.playlists()[1]);
    await vi.advanceTimersByTimeAsync(3000);
    component.onUndoDelete();

    expect(visibleIds()).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(10000);
    expect(gateway.deletePlaylist).not.toHaveBeenCalled();
  });

  it('commits the pending delete when the page is destroyed', () => {
    const { component, gateway, destroy } = harness([playlist('a')]);
    component.onDeletePlaylist(click, component.playlists()[0]);
    destroy();
    expect(gateway.deletePlaylist).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('a second delete commits the first and starts its own undo window', async () => {
    const { component, gateway, visibleIds } = harness([playlist('a'), playlist('b'), playlist('c')]);
    component.onDeletePlaylist(click, component.playlists()[0]);
    component.onDeletePlaylist(click, component.playlists()[1]);

    expect(gateway.deletePlaylist).toHaveBeenCalledExactlyOnceWith('a');
    expect(component.pendingDelete()?.id).toBe('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(visibleIds()).toEqual(['c']);

    await vi.advanceTimersByTimeAsync(6000);
    expect(gateway.deletePlaylist.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  });

  it('keeps a second pending delete while the first delete is still running', async () => {
    const { component, gateway, visibleIds } = harness([playlist('a'), playlist('b'), playlist('c')]);
    let finishFirst!: () => void;
    gateway.deletePlaylist.mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)));

    component.onDeletePlaylist(click, component.playlists()[0]);
    await vi.advanceTimersByTimeAsync(6000);
    component.onDeletePlaylist(click, component.playlists()[1]);
    expect(visibleIds()).toEqual(['c']);

    finishFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(visibleIds()).toEqual(['c']);
    expect(component.pendingDelete()?.id).toBe('b');

    await vi.advanceTimersByTimeAsync(6000);
    expect(gateway.deletePlaylist.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
  });

  it('shows the playlist again with an error when the delete fails', async () => {
    const { component, gateway, visibleIds } = harness([playlist('a')]);
    gateway.deletePlaylist.mockRejectedValueOnce(new Error('Disk write error'));
    component.onDeletePlaylist(click, component.playlists()[0]);
    await vi.advanceTimersByTimeAsync(6000);

    expect(visibleIds()).toEqual(['a']);
    expect(component.errorMessage()).toBe('Disk write error');
  });
});
