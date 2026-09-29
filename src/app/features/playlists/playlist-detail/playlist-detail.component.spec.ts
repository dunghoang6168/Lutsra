import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { EMPTY } from 'rxjs';
import { LIBRARY_GATEWAY, PLAYLIST_GATEWAY } from '../../../core/contracts';
import { PlayerService } from '../../../core/player/player.service';
import { Track } from '../../../core/models';
import { PlaylistDetailComponent } from './playlist-detail.component';

describe('PlaylistDetailComponent removed tracks', () => {
  it('keeps unavailable entries in their original order', async () => {
    const active = makeTrack('active', true);
    const removed = makeTrack('removed', false);
    const playlist = {
      id: 'playlist', name: 'Saved', createdAt: 1, updatedAt: 1,
      entries: [
        { id: 'first', trackId: removed.id, addedAt: 1 },
        { id: 'second', trackId: active.id, addedAt: 2 },
        { id: 'third', trackId: removed.id, addedAt: 3 },
      ],
    };
    await TestBed.configureTestingModule({
      imports: [PlaylistDetailComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'playlist' }) } } },
        { provide: LIBRARY_GATEWAY, useValue: {
          getLibrary: async () => ({ tracks: [active], albums: [], artists: [], folders: [] }),
          getTrackById: async (id: string) => id === removed.id ? removed : null,
          scanProgress$: EMPTY,
        } },
        { provide: PLAYLIST_GATEWAY, useValue: { getPlaylists: async () => [playlist] } },
        { provide: PlayerService, useValue: {
          currentTrack: signal(null), isShuffle: signal(false), playCollection: jasmine.createSpy('playCollection'),
        } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PlaylistDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.trackRows().map((row) => row.entry.id)).toEqual(['first', 'second', 'third']);
    expect(fixture.nativeElement.querySelectorAll('.badge-unavailable').length).toBe(2);
    expect(fixture.componentInstance.allLibraryTracks().map((track) => track.id)).toEqual(['active']);
  });
});

function makeTrack(id: string, isAvailable: boolean): Track {
  return {
    id, path: `D:/Music/${id}.flac`, fileName: `${id}.flac`, title: id,
    artist: null, albumArtist: null, album: null, genre: null, year: null,
    trackNumber: null, discNumber: null, duration: 60, codec: 'FLAC', bitrate: null,
    sampleRate: null, bitDepth: null, channels: null, artwork: null, fileSize: null,
    lastModified: null, isAvailable,
  };
}
