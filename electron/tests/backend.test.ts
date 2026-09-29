import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, rm, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ArtworkService } from '../services/artwork.service.js';
import { DatabaseService, StoredTrack } from '../services/database.service.js';
import { ScannerService } from '../services/scanner.service.js';
import { isPathInside, pathKey, pathsOverlap, stableId } from '../utils/path-utils.js';
import { createFileResponse } from '../protocols/file-response.js';
import { validSettings } from '../ipc/settings-validation.js';
import {
  validArtistSourceUrl,
  validId,
  validMusicBrainzId,
  validTitleBarAppearance,
  validWikipediaOverride,
} from '../ipc/ipc-validation.js';
import { mapTrackDetails, TrackDetailsService } from '../services/track-details.service.js';
import { migrateLegacyProfile } from '../services/profile-migration.service.js';
import { LyricsService } from '../services/lyrics.service.js';
import type { IAudioMetadata } from 'music-metadata';
import './artist-metadata.test.js';

test('lyrics service reads only a bounded sidecar inside a registered music folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-lyrics-test-'));
  const musicRoot = path.join(root, 'music');
  const audioPath = path.join(musicRoot, 'Song.flac');
  const lyricPath = path.join(musicRoot, 'Song.lrc');
  const trackId = `track-${'a'.repeat(64)}`;
  await mkdir(musicRoot);
  await writeFile(audioPath, 'audio');
  let resolvedPath = audioPath;
  const database = {
    resolveTrack: (id: string) => id === trackId ? { path: resolvedPath, mime: 'audio/flac' } : null,
    listFolders: () => [{ path: musicRoot }],
  } as unknown as DatabaseService;
  const service = new LyricsService(database);
  try {
    assert.equal(await service.get(trackId), null);
    assert.equal(await service.get('track-unknown'), null);
    assert.deepEqual(await service.findTracksWithLyrics([trackId, 'track-unknown']), []);
    await writeFile(lyricPath, '\ufeff[00:01.00]Hello');
    assert.equal(await service.get(trackId), '[00:01.00]Hello');
    assert.deepEqual(await service.findTracksWithLyrics([trackId, 'track-unknown']), [trackId]);
    await writeFile(lyricPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('[00:02.00]World', 'utf16le')]));
    assert.equal(await service.get(trackId), '[00:02.00]World');
    const bigEndianText = Buffer.from('[00:03.00]Again', 'utf16le');
    bigEndianText.swap16();
    await writeFile(lyricPath, Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndianText]));
    assert.equal(await service.get(trackId), '[00:03.00]Again');
    await writeFile(lyricPath, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(service.get(trackId), /too large/);
    assert.deepEqual(await service.findTracksWithLyrics([trackId]), [trackId]);
    resolvedPath = path.join(root, 'outside.flac');
    await writeFile(resolvedPath, 'audio');
    await assert.rejects(service.get(trackId), /outside registered music folders/);
    assert.deepEqual(await service.findTracksWithLyrics([trackId]), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('renamed app migrates the newest legacy library and artwork without changing the source', async () => {
  const appData = await mkdtemp(path.join(os.tmpdir(), 'lutsra-profile-test-'));
  try {
    const olderRoot = path.join(appData, 'audio-blabla');
    const newerRoot = path.join(appData, 'Audio Lutstra');
    const targetRoot = path.join(appData, 'Lutsra');
    await mkdir(olderRoot);
    await mkdir(path.join(newerRoot, 'artwork-cache'), { recursive: true });

    const older = new DatabaseService(path.join(olderRoot, 'audio-blabla.sqlite'));
    older.saveSettings({ defaultVolume: 0.2 });
    older.close();
    const newer = new DatabaseService(path.join(newerRoot, 'audio-lutstra.sqlite'));
    newer.saveSettings({ defaultVolume: 0.7 });
    const oldArtwork = path.join(newerRoot, 'artwork-cache', 'cover.jpg');
    await writeFile(oldArtwork, 'artwork');
    newer.saveArtwork('a'.repeat(64), oldArtwork, 'image/jpeg', 7);
    newer.close();

    assert.equal(await migrateLegacyProfile(targetRoot, appData), newerRoot);
    const migrated = new DatabaseService(path.join(targetRoot, 'lutsra.sqlite'));
    assert.equal(migrated.getSettings().defaultVolume, 0.7);
    assert.deepEqual(migrated.getSettings().hiddenSongColumns, []);
    assert.deepEqual(migrated.getSettings().songColumnOrder, ['artist', 'album', 'duration', 'codec', 'sampleRate', 'lyrics']);
    assert.equal(migrated.getSettings().layoutMode, 'inset');
    assert.equal(migrated.getSettings().audioVisualizationMode, 'spectrum');
    assert.equal(migrated.resolveArtwork('a'.repeat(64))?.path, path.join(targetRoot, 'artwork-cache', 'cover.jpg'));
    migrated.close();
    assert.equal(await migrateLegacyProfile(targetRoot, appData), null);
    const original = new DatabaseService(path.join(newerRoot, 'audio-lutstra.sqlite'));
    assert.equal(original.resolveArtwork('a'.repeat(64))?.path, oldArtwork);
    original.close();
  } finally {
    await rm(appData, { recursive: true, force: true });
  }
});

test('profile migration still accepts Audio BlaBla when Audio Lutstra was never launched', async () => {
  const appData = await mkdtemp(path.join(os.tmpdir(), 'lutsra-legacy-profile-test-'));
  try {
    const legacyRoot = path.join(appData, 'Audio BlaBla');
    const targetRoot = path.join(appData, 'Lutsra');
    await mkdir(legacyRoot);
    const legacy = new DatabaseService(path.join(legacyRoot, 'audio-blabla.sqlite'));
    legacy.saveSettings({ defaultVolume: 0.45 });
    legacy.close();

    assert.equal(await migrateLegacyProfile(targetRoot, appData), legacyRoot);
    const migrated = new DatabaseService(path.join(targetRoot, 'lutsra.sqlite'));
    assert.equal(migrated.getSettings().defaultVolume, 0.45);
    migrated.close();
  } finally {
    await rm(appData, { recursive: true, force: true });
  }
});
test('settings IPC accepts allowlisted themes and rejects invalid values', () => {
  assert.deepEqual(validSettings({ themePreset: 'light', accentColor: 'amber' }), { themePreset: 'light', accentColor: 'amber' });
  assert.throws(() => validSettings({ themePreset: 'sage' }), /Invalid theme preset/);
  assert.throws(() => validSettings({ accentColor: '#ffffff' }), /Invalid accent color/);
  assert.deepEqual(validSettings({ layoutMode: 'classic' }), { layoutMode: 'classic' });
  assert.throws(() => validSettings({ layoutMode: 'floating' }), /Invalid layout mode/);
  assert.deepEqual(validSettings({ audioVisualizationMode: 'waveform' }), { audioVisualizationMode: 'waveform' });
  assert.throws(() => validSettings({ audioVisualizationMode: 'bars' }), /Invalid audio visualization mode/);
  assert.deepEqual(validSettings({ hiddenSongColumns: ['artist', 'codec', 'artist'] }), { hiddenSongColumns: ['artist', 'codec'] });
  assert.deepEqual(validSettings({ hiddenSongColumns: ['lyrics'] }), { hiddenSongColumns: ['lyrics'] });
  const songColumnOrder = ['lyrics', 'artist', 'album', 'duration', 'codec', 'sampleRate'];
  assert.deepEqual(validSettings({ songColumnOrder }), { songColumnOrder });
  assert.throws(() => validSettings({ songColumnOrder: ['lyrics', 'lyrics'] }), /Invalid Songs column order/);
  assert.throws(() => validSettings({ songColumnOrder: ['title', 'artist', 'album', 'duration', 'codec', 'sampleRate'] }), /Invalid Songs column order/);
  assert.throws(() => validSettings({ hiddenSongColumns: ['title'] }), /Invalid Songs columns/);
  assert.throws(() => validSettings({ hiddenSongColumns: 'artist' }), /Invalid Songs columns/);
});

test('IPC identifier validation rejects malformed track IDs', () => {
  const validTrackId = `track-${'a'.repeat(64)}`;
  assert.equal(validId(validTrackId), validTrackId);
  assert.throws(() => validId('../Music/track.flac'), /Invalid identifier/);
  assert.throws(() => validId(`track-${'A'.repeat(64)}`), /Invalid identifier/);
});

test('title bar appearance accepts only the renderer allowlist', () => {
  assert.equal(validTitleBarAppearance('light'), 'light');
  assert.equal(validTitleBarAppearance('dark'), 'dark');
  assert.throws(() => validTitleBarAppearance('#ffffff'), /Invalid title bar appearance/);
});

test('artist metadata IPC validates identifiers and strict source allowlists', () => {
  const mbid = '12345678-1234-4234-9234-123456789abc';
  assert.equal(validMusicBrainzId(mbid), mbid);
  assert.throws(() => validMusicBrainzId('../artist'), /Invalid MusicBrainz identifier/);

  const wikipedia = 'https://en.wikipedia.org/wiki/Aimer';
  const vietnameseWikipedia = 'https://vi.wikipedia.org/wiki/MCK';
  assert.equal(validWikipediaOverride(wikipedia), wikipedia);
  assert.equal(validWikipediaOverride(vietnameseWikipedia), vietnameseWikipedia);
  assert.equal(validWikipediaOverride(null), null);
  assert.throws(() => validWikipediaOverride('https://fakevi.wikipedia.org/wiki/Aimer'), /Invalid Wikipedia URL/);
  assert.throws(() => validWikipediaOverride('http://en.wikipedia.org/wiki/Aimer'), /Invalid Wikipedia URL/);

  assert.equal(validArtistSourceUrl('https://musicbrainz.org/artist/' + mbid), 'https://musicbrainz.org/artist/' + mbid);
  assert.equal(validArtistSourceUrl(vietnameseWikipedia), vietnameseWikipedia);
  assert.equal(validArtistSourceUrl('https://www.wikidata.org/wiki/Q1'), 'https://www.wikidata.org/wiki/Q1');
  assert.throws(() => validArtistSourceUrl('http://vi.wikipedia.org/wiki/MCK'), /Untrusted source URL/);
  assert.throws(() => validArtistSourceUrl('https://example.com/artist'), /Untrusted source URL/);
});

test('detailed metadata mapping preserves parser values without inventing missing fields', () => {
  const metadata = {
    common: {
      track: { no: 12, of: 30 }, disk: { no: 1, of: 2 }, title: ' Liệm ', artist: 'RPT MCK', artists: ['RPT MCK'],
      album: 'HVL', albumartist: 'RPT MCK', albumartists: ['RPT MCK'], date: '2026-06-17', year: 2026,
      composer: ['Nghiêm Vũ Hoàng Long'], genre: ['Hip-Hop'],
    },
    format: {
      tagTypes: ['vorbis'], duration: 233.25, sampleRate: 96000, numberOfChannels: 2, bitsPerSample: 24,
      bitrate: 3016000, codec: 'FLAC', container: 'FLAC', tool: 'Lavf60.16.100', lossless: true,
      numberOfSamples: 22391968, audioMD5: Uint8Array.from([0xa0, 0x7a, 0xf0, 0x8b]),
    },
    native: {}, quality: { warnings: [] },
  } as unknown as IAudioMetadata;

  const details = mapTrackDetails('track-test', metadata, {
    fileName: '12. Liệm.flac', path: 'G:\\Music\\12. Liệm.flac', fileSize: 90_282_394, lastModified: 1_800_000_000_000,
  });
  assert.equal(details.metadata.title, 'Liệm');
  assert.deepEqual(details.metadata.composers, ['Nghiêm Vũ Hoàng Long']);
  assert.equal(details.metadata.totalTracks, 30);
  assert.equal(details.audio.numberOfSamples, 22391968);
  assert.equal(details.audio.lossless, true);
  assert.equal(details.audio.audioMd5, 'A07AF08B');
  assert.equal(details.audio.codecProfile, null);
});

test('track details service rejects files outside registered music roots', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-details-security-'));
  const libraryPath = path.join(temporaryRoot, 'Music');
  const outsidePath = path.join(temporaryRoot, 'outside.wav');
  const database = new DatabaseService(path.join(temporaryRoot, 'library.sqlite'));
  try {
    await mkdir(libraryPath, { recursive: true });
    await writeFile(outsidePath, createWaveFile());
    const folder = database.addFolder(libraryPath, 'Music');
    const stored = createStoredTrack(`track-${'c'.repeat(64)}`, 'Outside', 1, 1, temporaryRoot);
    stored.path = outsidePath;
    stored.fileName = path.basename(outsidePath);
    stored.isAvailable = true;
    database.upsertTracks(folder.id, 'security-scan', [stored]);
    await assert.rejects(() => new TrackDetailsService(database).get(stored.id), /outside registered music folders/);
  } finally {
    database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('path helpers normalize identity and reject sibling traversal', () => {
  const root = path.resolve('C:/Music');
  assert.equal(isPathInside(path.join(root, 'Artist', 'track.flac'), root), true);
  assert.equal(isPathInside(path.resolve('C:/Music Other/track.flac'), root), false);
  assert.equal(pathsOverlap(root, path.join(root, 'Artist')), true);
  assert.equal(stableId('track', pathKey(root)), stableId('track', pathKey(root)));
});

test('file responses support full content, byte ranges, HEAD and missing files', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-range-test-'));
  const filePath = path.join(temporaryRoot, 'audio.bin');
  const content = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  try {
    await writeFile(filePath, content);

    const full = await createFileResponse(filePath, new Request('music://track/test'), 'audio/test', 'app://lutsra');
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('access-control-allow-origin'), 'app://lutsra');
    assert.equal(full.headers.get('vary'), 'Origin');
    assert.equal(full.headers.get('content-length'), '256');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), content);

    const partial = await createFileResponse(filePath, requestWithRange('bytes=100-199'), 'audio/test');
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 100-199/256');
    assert.equal(partial.headers.get('content-length'), '100');
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), content.subarray(100, 200));

    const openEnded = await createFileResponse(filePath, requestWithRange('bytes=200-'), 'audio/test');
    assert.equal(openEnded.status, 206);
    assert.deepEqual(Buffer.from(await openEnded.arrayBuffer()), content.subarray(200));

    const head = await createFileResponse(filePath, new Request('music://track/test', { method: 'HEAD', headers: { range: 'bytes=0-9' } }), 'audio/test');
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-range'), 'bytes 0-9/256');
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    const invalid = await createFileResponse(filePath, requestWithRange('bytes=999-1000'), 'audio/test');
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get('content-range'), 'bytes */256');

    const missing = await createFileResponse(path.join(temporaryRoot, 'missing.bin'), new Request('music://track/test'), 'audio/test');
    assert.equal(missing.status, 404);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('library snapshot stores album track IDs in disc and track order', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-album-order-'));
  const databasePath = path.join(temporaryRoot, 'library.sqlite');
  const libraryPath = path.join(temporaryRoot, 'Music');
  const database = new DatabaseService(databasePath);

  try {
    const folder = database.addFolder(libraryPath, 'Music');
    database.upsertTracks(folder.id, 'scan-order', [
      createStoredTrack('alpha-title', 'Alpha title', 1, 3, libraryPath),
      createStoredTrack('zulu-title', 'Zulu title', 1, 1, libraryPath),
      createStoredTrack('disc-two', 'Disc two', 2, 1, libraryPath),
      createStoredTrack('middle-title', 'Middle title', 1, 2, libraryPath),
    ]);

    const album = database.getLibrary().albums[0];
    assert.deepEqual(album?.trackIds, ['zulu-title', 'middle-title', 'alpha-title', 'disc-two']);
  } finally {
    database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('folder artwork is imported and refreshed when audio files are unchanged', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-folder-cover-'));
  const libraryPath = path.join(temporaryRoot, 'Music');
  const albumPath = path.join(libraryPath, 'Album');
  const artworkPath = path.join(temporaryRoot, 'artwork');
  const databasePath = path.join(temporaryRoot, 'library.sqlite');
  const database = new DatabaseService(databasePath);
  try {
    await mkdir(albumPath, { recursive: true });
    await writeFile(path.join(albumPath, 'song.wav'), createWaveFile());
    const folder = database.addFolder(libraryPath, 'Music');
    const scanner = new ScannerService(database, new ArtworkService(artworkPath, database), () => undefined);
    await scanner.scan([folder.id]);
    assert.equal(database.getLibrary().tracks[0]?.artwork, null);

    const coverPath = path.join(albumPath, 'COVER.PNG');
    await writeFile(coverPath, testPng());
    const { DatabaseSync } = await import('node:sqlite');
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec('UPDATE tracks SET artwork_source = NULL');
    legacyDatabase.close();
    await scanner.scan([folder.id]);
    const initial = database.getLibrary();
    assert.match(initial.tracks[0]?.artwork ?? '', /^music:\/\/artwork\/[a-f0-9]{64}$/);
    assert.equal(initial.albums[0]?.artwork, initial.tracks[0]?.artwork);

    await writeFile(coverPath, Buffer.concat([testPng(), Buffer.alloc(14 * 1024 * 1024)]));
    await scanner.scan([folder.id]);
    const larger = database.getLibrary().tracks[0]?.artwork;
    assert.ok(larger);
    assert.notEqual(larger, initial.tracks[0]?.artwork);

    await writeFile(coverPath, Buffer.from('invalid image'));
    await scanner.scan([folder.id]);
    assert.equal(database.getLibrary().tracks[0]?.artwork, null);

    await writeFile(coverPath, Buffer.alloc(20 * 1024 * 1024 + 1));
    await scanner.scan([folder.id]);
    assert.equal(database.getLibrary().tracks[0]?.artwork, null);

    await writeFile(coverPath, testPng());
    await scanner.scan([folder.id]);
    assert.ok(database.getLibrary().tracks[0]?.artwork);
    await unlink(coverPath);
    await scanner.scan([folder.id]);
    assert.equal(database.getLibrary().tracks[0]?.artwork, null);

    const frontPath = path.join(albumPath, 'Front.png');
    await writeFile(frontPath, testPng());
    await scanner.scan([folder.id]);
    assert.ok(database.getLibrary().tracks[0]?.artwork);
    await unlink(frontPath);
  } finally {
    database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('album artwork prefers embedded art even when a folder cover is encountered first', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-cover-priority-'));
  const database = new DatabaseService(path.join(temporaryRoot, 'library.sqlite'));
  try {
    const folder = database.addFolder(temporaryRoot, 'Music');
    const artwork = new ArtworkService(path.join(temporaryRoot, 'artwork'), database);
    const folderHash = await artwork.saveBuffer(testPng(), 'image/png');
    const embeddedHash = await artwork.saveBuffer(Buffer.concat([testPng(), Buffer.from([1])]), 'image/png');
    const folderTrack = { ...createStoredTrack('a-folder', 'A folder', 1, 1, temporaryRoot), artworkHash: folderHash, artworkSource: 'folder' as const };
    const embeddedTrack = { ...createStoredTrack('z-embedded', 'Z embedded', 1, 2, temporaryRoot), artworkHash: embeddedHash, artworkSource: 'embedded' as const };
    database.upsertTracks(folder.id, 'priority-scan', [folderTrack, embeddedTrack]);
    assert.equal(database.getLibrary().albums[0]?.artwork, `music://artwork/${embeddedHash}`);
  } finally {
    database.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('scanner, reconciliation, playlists, settings and database persistence', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'lutsra-test-'));
  const libraryPath = path.join(temporaryRoot, 'Music');
  const databasePath = path.join(temporaryRoot, 'library.sqlite');
  const artworkPath = path.join(temporaryRoot, 'artwork');
  const audioPath = path.join(libraryPath, 'Tone #1.wav');
  let database: DatabaseService | null = null;

  try {
    await mkdir(libraryPath, { recursive: true });
    await writeFile(audioPath, createWaveFile(), { flag: 'wx' });

    database = new DatabaseService(databasePath);
    const folder = database.addFolder(libraryPath, 'Music');
    const progress: Array<{ isScanning: boolean; audioFiles: number }> = [];
    const scanner = new ScannerService(database, new ArtworkService(artworkPath, database), (value) => progress.push(value));

    await scanner.scan([folder.id]);
    let snapshot = database.getLibrary();
    assert.equal(snapshot.tracks.length, 1);
    assert.equal(snapshot.tracks[0]?.title, 'Tone #1');
    assert.equal(snapshot.tracks[0]?.sampleRate, 44100);
    assert.equal(snapshot.tracks[0]?.bitDepth, 16);
    assert.equal(progress.at(-1)?.isScanning, false);
    assert.equal(progress.at(-1)?.audioFiles, 1);

    const firstTrackId = snapshot.tracks[0]!.id;
    const details = await new TrackDetailsService(database).get(firstTrackId);
    assert.equal(details.trackId, firstTrackId);
    assert.equal(details.audio.sampleRate, 44100);
    assert.equal(details.audio.bitsPerSample, 16);
    assert.equal(details.file.path, audioPath);
    await scanner.scan([folder.id]);
    snapshot = database.getLibrary();
    assert.equal(snapshot.tracks.length, 1);
    assert.equal(snapshot.tracks[0]?.id, firstTrackId);

    const playlist = database.createPlaylist('Test');
    const withDuplicates = database.addPlaylistTracks(playlist.id, [firstTrackId, firstTrackId]);
    assert.equal(withDuplicates.entries.length, 2);
    assert.notEqual(withDuplicates.entries[0]?.id, withDuplicates.entries[1]?.id);
    database.saveSettings({ defaultVolume: 0.35, repeatMode: 'all', shuffle: true, themePreset: 'dark', accentColor: 'cyan', layoutMode: 'classic', audioVisualizationMode: 'waveform', hiddenSongColumns: ['artist', 'codec'], songColumnOrder: ['lyrics', 'artist', 'album', 'duration', 'codec', 'sampleRate'] });

    database.close();
    database = new DatabaseService(databasePath);
    assert.equal(database.listPlaylists()[0]?.entries.length, 2);
    assert.equal(database.getSettings().defaultVolume, 0.35);
    assert.equal(database.getSettings().repeatMode, 'all');
    assert.equal(database.getSettings().themePreset, 'dark');
    assert.equal(database.getSettings().accentColor, 'cyan');
    assert.equal(database.getSettings().layoutMode, 'classic');
    assert.equal(database.getSettings().audioVisualizationMode, 'waveform');
    assert.deepEqual(database.getSettings().hiddenSongColumns, ['artist', 'codec']);
    assert.deepEqual(database.getSettings().songColumnOrder, ['lyrics', 'artist', 'album', 'duration', 'codec', 'sampleRate']);

    await unlink(audioPath);
    const reopenedScanner = new ScannerService(database, new ArtworkService(artworkPath, database), () => undefined);
    await reopenedScanner.scan([folder.id]);
    assert.equal(database.getLibrary().tracks.length, 0);
    assert.equal(database.getTrackById(firstTrackId)?.isAvailable, false);
    assert.equal(database.listPlaylists()[0]?.entries.length, 2);
  } finally {
    database?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('folder removal hides orphan tracks while preserving playlists and local audio files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-folder-removal-'));
  const firstPath = path.join(root, 'first');
  const secondPath = path.join(root, 'second');
  const audioPath = path.join(firstPath, 'song.wav');
  const databasePath = path.join(root, 'library.sqlite');
  await mkdir(firstPath);
  await mkdir(secondPath);
  await writeFile(audioPath, createWaveFile());
  let database = new DatabaseService(databasePath);
  try {
    const first = database.addFolder(firstPath, 'First');
    const second = database.addFolder(secondPath, 'Second');
    const shared = createStoredTrack('shared-track', 'Shared', 1, 1, firstPath);
    const orphan = createStoredTrack('orphan-track', 'Orphan', 1, 2, firstPath);
    database.upsertTracks(first.id, 'first-scan', [shared, orphan]);
    database.upsertTracks(second.id, 'second-scan', [shared]);
    const playlist = database.addPlaylistTracks(database.createPlaylist('Saved').id, [orphan.id, shared.id, orphan.id]);

    database.removeFolder(first.id);
    assert.deepEqual(database.getLibrary().tracks.map((track) => track.id), [shared.id]);
    assert.equal(database.getLibrary().albums.length, 1);
    assert.equal(database.getLibrary().artists.length, 1);
    assert.equal(database.getTrackById(orphan.id)?.isAvailable, false);
    assert.deepEqual(database.listPlaylists()[0]?.entries.map((entry) => entry.id), playlist.entries.map((entry) => entry.id));

    database.removeFolder(second.id);
    const empty = database.getLibrary();
    assert.deepEqual([empty.folders.length, empty.tracks.length, empty.albums.length, empty.artists.length], [0, 0, 0, 0]);
    const scanner = new ScannerService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined);
    await scanner.scan();
    assert.equal(database.getLibrary().tracks.length, 0);
    database.close();
    database = new DatabaseService(databasePath);
    assert.equal(database.getLibrary().tracks.length, 0);
    assert.equal(database.getTrackById(orphan.id)?.isAvailable, false);
    assert.ok((await stat(audioPath)).isFile());

    const restored = database.addFolder(firstPath, 'First');
    database.upsertTracks(restored.id, 'restored-scan', [orphan]);
    assert.equal(database.getTrackById(orphan.id)?.isAvailable, true);
    assert.deepEqual(database.listPlaylists()[0]?.entries.map((entry) => entry.trackId), [orphan.id, shared.id, orphan.id]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('readding and rescanning a removed root restores the same playlist track', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-folder-restore-'));
  const musicPath = path.join(root, 'Music');
  const audioPath = path.join(musicPath, 'Song.wav');
  const databasePath = path.join(root, 'library.sqlite');
  await mkdir(musicPath);
  await writeFile(audioPath, createWaveFile());
  let database = new DatabaseService(databasePath);
  try {
    const folder = database.addFolder(musicPath, 'Music');
    let scanner = new ScannerService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined);
    await scanner.scan([folder.id]);
    const trackId = database.getLibrary().tracks[0]!.id;
    const playlist = database.addPlaylistTracks(database.createPlaylist('Saved').id, [trackId]);
    database.removeFolder(folder.id);
    assert.deepEqual([database.getLibrary().tracks.length, database.getLibrary().albums.length, database.getLibrary().artists.length], [0, 0, 0]);
    assert.equal(database.getTrackById(trackId)?.isAvailable, false);
    database.close();
    database = new DatabaseService(databasePath);
    scanner = new ScannerService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined);
    await scanner.scan();
    assert.equal(database.getLibrary().tracks.length, 0);
    const restored = database.addFolder(musicPath, 'Music');
    await scanner.scan([restored.id]);
    assert.equal(database.getLibrary().tracks[0]?.id, trackId);
    assert.equal(database.getTrackById(trackId)?.isAvailable, true);
    assert.deepEqual(database.listPlaylists()[0]?.entries.map((entry) => entry.id), playlist.entries.map((entry) => entry.id));
    assert.ok((await stat(audioPath)).isFile());
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

function createWaveFile(): Buffer {
  const sampleRate = 44100;
  const sampleCount = 4410;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function createStoredTrack(
  id: string,
  title: string,
  discNumber: number,
  trackNumber: number,
  libraryPath: string,
): StoredTrack {
  return {
    id,
    path: path.join(libraryPath, `${id}.flac`),
    fileName: `${id}.flac`,
    title,
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    genre: null,
    year: null,
    trackNumber,
    discNumber,
    duration: 60,
    codec: 'FLAC',
    bitrate: null,
    sampleRate: null,
    bitDepth: null,
    channels: null,
    artwork: null,
    artworkHash: null,
    fileSize: null,
    lastModified: null,
    isAvailable: true,
  };
}

function requestWithRange(range: string): Request {
  return new Request('music://track/test', { headers: { range } });
}

function testPng(): Buffer {
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qWQAAAAASUVORK5CYII=', 'base64');
}
