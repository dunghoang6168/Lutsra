import { TestBed } from '@angular/core/testing';
import { PlayerService } from './player.service';
import { PLAYBACK_ENGINE } from '../contracts/playback-engine.contract';
import { MockPlaybackEngine } from '../mock/mock-playback.engine';
import { Track } from '../models';
import { LIBRARY_GATEWAY } from '../contracts';
import { BehaviorSubject, Subject } from 'rxjs';

describe('PlayerService (Queue, Repeat, Shuffle, Playback)', () => {
  let service: PlayerService;
  let engine: MockPlaybackEngine;

  const mockTracks: Track[] = [
    {
      id: 't-1',
      path: 'D:/Music/1.flac',
      fileName: '1.flac',
      title: 'Track One',
      artist: 'Artist A',
      albumArtist: 'Artist A',
      album: 'Album 1',
      genre: 'Pop',
      year: 2020,
      trackNumber: 1,
      discNumber: 1,
      duration: 200,
      codec: 'FLAC',
      bitrate: 1411000,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      artwork: null,
      fileSize: 20000000,
      lastModified: 1700000000000,
      isAvailable: true,
    },
    {
      id: 't-2',
      path: 'D:/Music/2.flac',
      fileName: '2.flac',
      title: 'Track Two',
      artist: 'Artist A',
      albumArtist: 'Artist A',
      album: 'Album 1',
      genre: 'Pop',
      year: 2020,
      trackNumber: 2,
      discNumber: 1,
      duration: 180,
      codec: 'FLAC',
      bitrate: 1411000,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      artwork: null,
      fileSize: 18000000,
      lastModified: 1700000000000,
      isAvailable: true,
    },
    {
      id: 't-3',
      path: 'D:/Music/3.flac',
      fileName: '3.flac',
      title: 'Track Three (Unavailable)',
      artist: 'Artist B',
      albumArtist: 'Artist B',
      album: 'Album 2',
      genre: 'Rock',
      year: 2021,
      trackNumber: 1,
      discNumber: 1,
      duration: 240,
      codec: 'FLAC',
      bitrate: 1411000,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      artwork: null,
      fileSize: 24000000,
      lastModified: 1700000000000,
      isAvailable: false, // Unavailable
    },
    {
      id: 't-4',
      path: 'D:/Music/4.flac',
      fileName: '4.flac',
      title: 'Track Four',
      artist: 'Artist B',
      albumArtist: 'Artist B',
      album: 'Album 2',
      genre: 'Rock',
      year: 2021,
      trackNumber: 2,
      discNumber: 1,
      duration: 300,
      codec: 'FLAC',
      bitrate: 1411000,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      artwork: null,
      fileSize: 30000000,
      lastModified: 1700000000000,
      isAvailable: true,
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PlayerService,
        { provide: PLAYBACK_ENGINE, useClass: MockPlaybackEngine },
      ],
    });

    service = TestBed.inject(PlayerService);
    engine = TestBed.inject(PLAYBACK_ENGINE) as MockPlaybackEngine;
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should initialize with default state', () => {
    expect(service.currentTrack()).toBeNull();
    expect(service.queue().length).toBe(0);
    expect(service.currentIndex()).toBe(-1);
    expect(service.isPlaying()).toBeFalse();
    expect(service.repeatMode()).toBe('off');
    expect(service.isShuffle()).toBeFalse();
    expect(service.volume()).toBe(0.8);
    expect(service.isMuted()).toBeFalse();
  });

  it('should play a collection starting from specified index', async () => {
    await service.playCollection(mockTracks, 1);

    expect(service.queue().length).toBe(4);
    expect(service.currentIndex()).toBe(1);
    expect(service.currentTrack()?.id).toBe('t-2');
    expect(service.isPlaying()).toBeTrue();
  });

  describe('Next track operations', () => {
    it('should move to next track in queue', async () => {
      await service.playCollection(mockTracks, 0);
      expect(service.currentIndex()).toBe(0);

      await service.next();
      expect(service.currentIndex()).toBe(1);
      expect(service.currentTrack()?.id).toBe('t-2');
    });

    it('should skip unavailable track (t-3 is unavailable, should jump to t-4)', async () => {
      await service.playCollection(mockTracks, 1);
      expect(service.currentIndex()).toBe(1);

      await service.next();
      // Track 2 (index 2) is unavailable, should skip straight to index 3 (t-4)
      expect(service.currentIndex()).toBe(3);
      expect(service.currentTrack()?.id).toBe('t-4');
    });

    it('should stop at the end of queue when repeatMode is off', async () => {
      await service.playCollection(mockTracks, 3);
      service.setRepeatMode('off');

      await service.next();
      expect(service.isPlaying()).toBeFalse();
    });

    it('should wrap around to start of queue when repeatMode is all', async () => {
      await service.playCollection(mockTracks, 3);
      service.setRepeatMode('all');

      await service.next();
      expect(service.currentIndex()).toBe(0);
      expect(service.currentTrack()?.id).toBe('t-1');
    });

    it('should still advance to next track when user clicks next even if repeatMode is one', async () => {
      // User specification: "Repeat one lặp khi ended; Next vẫn chuyển bài."
      await service.playCollection(mockTracks, 0);
      service.setRepeatMode('one');

      await service.next();
      expect(service.currentIndex()).toBe(1);
      expect(service.currentTrack()?.id).toBe('t-2');
    });
  });

  describe('Previous track operations', () => {
    it('should rewind to start of track if currentTime > 3 seconds', async () => {
      await service.playCollection(mockTracks, 1);
      service.seek(15);
      expect(service.currentTime()).toBe(15);

      await service.previous();
      expect(service.currentIndex()).toBe(1); // Stayed on same track
      expect(service.currentTime()).toBe(0); // Rewound to 0
    });

    it('should go to previous track if currentTime <= 3 seconds', async () => {
      await service.playCollection(mockTracks, 1);
      service.seek(2);

      await service.previous();
      expect(service.currentIndex()).toBe(0);
      expect(service.currentTrack()?.id).toBe('t-1');
    });

    it('should wrap to end of queue if at index 0 and repeatMode is all', async () => {
      await service.playCollection(mockTracks, 0);
      service.seek(1);
      service.setRepeatMode('all');

      await service.previous();
      expect(service.currentIndex()).toBe(3); // Last track
      expect(service.currentTrack()?.id).toBe('t-4');
    });

    it('should rewind to 0 and not wrap if at index 0 and repeatMode is off', async () => {
      await service.playCollection(mockTracks, 0);
      service.seek(2);
      service.setRepeatMode('off');

      await service.previous();
      expect(service.currentIndex()).toBe(0);
      expect(service.currentTime()).toBe(0);
    });
  });

  describe('Shuffle operations', () => {
    it('should preserve current playing entry when shuffle is toggled on', async () => {
      await service.playCollection(mockTracks, 1); // Playing t-2
      const currentEntryId = service.currentQueueEntry()?.id;

      service.toggleShuffle();
      expect(service.isShuffle()).toBeTrue();

      // In shuffled queue, the current entry must still be the current entry at index 0
      expect(service.currentIndex()).toBe(0);
      expect(service.currentQueueEntry()?.id).toBe(currentEntryId);
      expect(service.queue().length).toBe(4);
    });

    it('should restore original queue order when shuffle is toggled off', async () => {
      await service.playCollection(mockTracks, 1); // t-2 at original index 1
      const currentEntryId = service.currentQueueEntry()?.id;

      service.toggleShuffle(); // ON
      service.toggleShuffle(); // OFF

      expect(service.isShuffle()).toBeFalse();
      expect(service.queue()[0].track.id).toBe('t-1');
      expect(service.queue()[1].track.id).toBe('t-2');
      expect(service.queue()[2].track.id).toBe('t-3');
      expect(service.queue()[3].track.id).toBe('t-4');
      // Current index restored to match t-2
      expect(service.currentIndex()).toBe(1);
      expect(service.currentQueueEntry()?.id).toBe(currentEntryId);
    });
  });

  describe('Queue editing operations', () => {
    it('should insert tracks immediately after current track with playNext', async () => {
      await service.playCollection([mockTracks[0], mockTracks[3]], 0); // [t-1, t-4], playing t-1 at index 0
      service.playNext([mockTracks[1]]); // Insert t-2 after t-1

      expect(service.queue().length).toBe(3);
      expect(service.queue()[0].track.id).toBe('t-1');
      expect(service.queue()[1].track.id).toBe('t-2');
      expect(service.queue()[2].track.id).toBe('t-4');
      expect(service.currentIndex()).toBe(0);
    });

    it('should append tracks to end with addToQueue', async () => {
      await service.playCollection([mockTracks[0]], 0);
      service.addToQueue([mockTracks[1]]);

      expect(service.queue().length).toBe(2);
      expect(service.queue()[1].track.id).toBe('t-2');
    });

    it('should advance to next entry when current entry is removed', async () => {
      // User rule: "Xóa current entry chuyển tới entry kế tiếp; không còn bài thì dừng."
      await service.playCollection([mockTracks[0], mockTracks[1]], 0);
      const entryIdToRemove = service.queue()[0].id;

      service.removeFromQueue(entryIdToRemove);

      expect(service.queue().length).toBe(1);
      expect(service.queue()[0].track.id).toBe('t-2');
      expect(service.currentIndex()).toBe(0);
      expect(service.currentTrack()?.id).toBe('t-2');
    });

    it('should update currentIndex when an entry before current is removed', async () => {
      await service.playCollection([mockTracks[0], mockTracks[1], mockTracks[3]], 2); // Playing t-4 at index 2
      const firstEntryId = service.queue()[0].id;

      service.removeFromQueue(firstEntryId);

      expect(service.queue().length).toBe(2);
      expect(service.currentIndex()).toBe(1);
      expect(service.currentTrack()?.id).toBe('t-4');
    });

    it('should clear queue and reset playback state on clearQueue', async () => {
      await service.playCollection(mockTracks, 0);
      service.clearQueue();

      expect(service.queue().length).toBe(0);
      expect(service.currentIndex()).toBe(-1);
      expect(service.currentTrack()).toBeNull();
      expect(service.isPlaying()).toBeFalse();
    });

    it('should cancel pending load and remain idle when clearQueue is called immediately after playTrack', async () => {
      // Start playing a track (asynchronous load)
      const playPromise = service.playTrack(mockTracks[0]);
      // Immediately clear queue while load is still in-flight
      service.clearQueue();
      await playPromise;

      expect(service.queue().length).toBe(0);
      expect(service.currentTrack()).toBeNull();
      expect(service.playbackState()).toBe('idle');
      expect(service.isPlaying()).toBeFalse();
    });
  });

  describe('Volume, Mute and Settings', () => {
    it('should clamp volume between 0 and 1', () => {
      service.setVolume(1.5);
      expect(service.volume()).toBe(1);

      service.setVolume(-0.2);
      expect(service.volume()).toBe(0);

      service.setVolume(0.65);
      expect(service.volume()).toBe(0.65);
    });

    it('should preserve volume level when muting and unmuting', () => {
      service.setVolume(0.7);
      service.toggleMute();
      expect(service.isMuted()).toBeTrue();
      expect(service.volume()).toBe(0.7); // Volume level preserved

      service.toggleMute();
      expect(service.isMuted()).toBeFalse();
      expect(service.volume()).toBe(0.7);
    });

    it('should toggle and set shuffle mode via setShuffle', () => {
      service.setShuffle(true);
      expect(service.isShuffle()).toBeTrue();
      service.setShuffle(true); // Should remain true
      expect(service.isShuffle()).toBeTrue();
      service.setShuffle(false);
      expect(service.isShuffle()).toBeFalse();
    });
  });

  describe('Playback intent while loading', () => {
    it('should cancel pending auto-play when pause is pressed during loading', async () => {
      const playSpy = spyOn(engine, 'play').and.callThrough();
      const pendingPlay = service.playTrack(mockTracks[0]);

      expect(service.playbackState()).toBe('loading');
      expect(service.isPlaybackActive()).toBeTrue();

      await service.togglePlayPause();
      expect(service.playbackState()).toBe('paused');
      expect(service.isPlaybackActive()).toBeFalse();

      await pendingPlay;
      expect(playSpy).not.toHaveBeenCalled();
      expect(service.isPlaying()).toBeFalse();
    });

    it('should play normally after a pending load was cancelled', async () => {
      const playSpy = spyOn(engine, 'play').and.callThrough();
      const pendingPlay = service.playTrack(mockTracks[0]);
      await service.togglePlayPause();
      await pendingPlay;

      await service.togglePlayPause();
      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(service.isPlaying()).toBeTrue();
    });
  });

  describe('Idempotent media transport operations', () => {
    it('does not pause when play is requested repeatedly while already playing', async () => {
      const playSpy = spyOn(engine, 'play').and.callThrough();
      await service.playCollection(mockTracks, 0);

      await service.play();
      await service.play();

      expect(playSpy).toHaveBeenCalledTimes(1);
      expect(service.isPlaying()).toBeTrue();
    });

    it('does not resume when pause is requested repeatedly', async () => {
      const pauseSpy = spyOn(engine, 'pause').and.callThrough();
      await service.playCollection(mockTracks, 0);

      service.pause();
      service.pause();

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(service.isPlaying()).toBeFalse();
    });

    it('starts the first queued track when play is requested without a current track', async () => {
      service.queue.set([{ id: 'queued-track', track: mockTracks[0], originalIndex: 0 }]);

      await service.play();

      expect(service.currentIndex()).toBe(0);
      expect(service.currentTrack()?.id).toBe('t-1');
      expect(service.isPlaying()).toBeTrue();
    });

    it('stops by pausing and rewinding the current track', async () => {
      await service.playCollection(mockTracks, 0);
      service.seek(45);

      service.stop();

      expect(service.isPlaying()).toBeFalse();
      expect(service.currentTime()).toBe(0);
    });
  });
});

describe('PlayerService library reconciliation', () => {
  const tracks: Track[] = ['one', 'two', 'three'].map((id) => ({
    id, path: `D:/Music/${id}.flac`, fileName: `${id}.flac`, title: id,
    artist: null, albumArtist: null, album: null, genre: null, year: null,
    trackNumber: null, discNumber: null, duration: 60, codec: 'FLAC', bitrate: null,
    sampleRate: null, bitDepth: null, channels: null, artwork: null, fileSize: null,
    lastModified: null, isAvailable: true,
  }));

  it('stops a removed current track and keeps only valid queued tracks without autoplay', async () => {
    const changed = new Subject<void>();
    let libraryTracks = tracks;
    TestBed.configureTestingModule({ providers: [
      PlayerService,
      { provide: PLAYBACK_ENGINE, useClass: MockPlaybackEngine },
      { provide: LIBRARY_GATEWAY, useValue: {
        getLibrary: async () => ({ tracks: libraryTracks, albums: [], artists: [], folders: [] }),
        scanProgress$: new BehaviorSubject({ isScanning: false, scannedFiles: 0, audioFiles: 0, currentPath: null }),
        libraryChanged$: changed.asObservable(),
      } },
    ] });
    const service = TestBed.inject(PlayerService);
    const engine = TestBed.inject(PLAYBACK_ENGINE) as MockPlaybackEngine;
    const dispose = spyOn(engine, 'dispose').and.callThrough();
    try {
      await service.playCollection(tracks, 0);
      service.toggleShuffle();
      libraryTracks = [tracks[1], tracks[2]];
      changed.next();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(dispose).toHaveBeenCalled();
      expect(service.currentTrack()).toBeNull();
      expect(service.isPlaying()).toBeFalse();
      expect(service.currentIndex()).toBe(-1);
      expect(service.queue().map((entry) => entry.track.id).sort()).toEqual(['three', 'two']);
      service.toggleShuffle();
      expect(service.queue().map((entry) => entry.track.id)).toEqual(['two', 'three']);
      expect(service.currentTrack()).toBeNull();
    } finally {
      service.ngOnDestroy();
    }
  });
});
