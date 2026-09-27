import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ArtistMetadataUpdate } from '../../src/app/core/models/index.js';
import { ArtworkService } from '../services/artwork.service.js';
import { ArtistMetadataService } from '../services/artist-metadata.service.js';
import { DatabaseService, StoredTrack } from '../services/database.service.js';

const MBID = '11111111-1111-4111-8111-111111111111';

test('artist metadata prefers Wikipedia text and image while using TheAudioDB fanart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-meta-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  const artwork = new ArtworkService(path.join(root, 'artwork'), database);
  const updates: ArtistMetadataUpdate[] = [];
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const service = new ArtistMetadataService(database, artwork, (value) => updates.push(value), mockFetch({
      searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }],
    }), () => { clock += 1001; return clock; });

    const artistId = database.getLibrary().artists[0]!.id;
    const metadata = await service.refreshArtist(artistId);

    assert.equal(metadata?.biography, 'Biography from Wikipedia.');
    assert.match(metadata?.avatar ?? '', /^music:\/\/artwork\/[a-f0-9]{64}$/);
    assert.match(metadata?.aboutImage ?? '', /^music:\/\/artwork\/[a-f0-9]{64}$/);
    assert.deepEqual(metadata?.sources, ['musicbrainz', 'wikidata', 'wikipedia', 'theaudiodb']);
    assert.equal(updates.at(-1)?.status, 'available');
    assert.equal(database.getLibrary().artists[0]?.onlineMetadata?.biography, 'Biography from Wikipedia.');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('artist metadata leaves ambiguous exact-name matches unresolved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-ambiguous-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  const artwork = new ArtworkService(path.join(root, 'artwork'), database);
  const updates: ArtistMetadataUpdate[] = [];
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Shared Name');
    const service = new ArtistMetadataService(database, artwork, (value) => updates.push(value), mockFetch({
      searchArtists: [
        { id: MBID, name: 'Shared Name', score: 100, aliases: [] },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Shared Name', score: 100, aliases: [] },
      ],
    }), () => { clock += 1001; return clock; });

    const artistId = database.getLibrary().artists[0]!.id;
    assert.equal(await service.refreshArtist(artistId), null);
    assert.equal(updates.at(-1)?.status, 'ambiguous');
    assert.equal(database.getArtistMetadata(artistId)?.status, 'ambiguous');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('artist metadata falls back to TheAudioDB when the Wikimedia image is invalid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-image-fallback-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  const artwork = new ArtworkService(path.join(root, 'artwork'), database);
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const service = new ArtistMetadataService(database, artwork, () => undefined, mockFetch({
      searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }],
      invalidWikimediaImage: true,
    }), () => { clock += 1001; return clock; });

    const artistId = database.getLibrary().artists[0]!.id;
    const metadata = await service.refreshArtist(artistId);

    assert.match(metadata?.avatar ?? '', /^music:\/\/artwork\/[a-f0-9]{64}$/);
    assert.equal(metadata?.avatarSourceUrl, 'https://www.theaudiodb.com/artist/42');
    assert.equal(metadata?.aboutImageSourceUrl, 'https://www.theaudiodb.com/artist/42');
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('missing MusicBrainz relation resolves only a unique Wikidata P434 match', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-wikidata-mbid-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }], omitRelation: true }),
      () => { clock += 1001; return clock; });
    const metadata = await service.refreshArtist(artistId);
    assert.equal(metadata?.biography, 'Biography from Wikipedia.');
    assert.equal(metadata?.avatarSourceUrl, 'https://en.wikipedia.org/wiki/Test_Artist');
    assert.equal(database.getArtistMetadata(artistId)?.resolverVersion, 5);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('ambiguous or absent Wikidata P434 results do not select an entity', async () => {
  for (const ids of [[], ['Q123', 'Q999']]) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-wikidata-ambiguous-'));
    const database = new DatabaseService(path.join(root, 'library.sqlite'));
    let clock = 1_800_000_000_000;
    try {
      seedArtist(database, root, 'Test Artist');
      const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
        mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }], omitRelation: true, wikidataIds: ids }),
        () => { clock += 1001; return clock; });
      const metadata = await service.refreshArtist(database.getLibrary().artists[0]!.id);
      assert.equal(metadata?.biography, 'AudioDB biography');
      assert.equal(metadata?.avatarSourceUrl, 'https://www.theaudiodb.com/artist/42');
    } finally { database.close(); await rm(root, { recursive: true, force: true }); }
  }
});

test('old negative cache is retried immediately with resolver v5', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-resolver-version-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }] }),
      () => { clock += 1001; return clock; });
    await service.refreshArtist(artistId);
    const stored = database.getArtistMetadata(artistId)!;
    database.saveArtistMetadata({ ...stored, musicBrainzId: null, status: 'not-found', resolverVersion: 1, nextRetryAt: clock + 7 * 24 * 60 * 60 * 1000 });
    await service.ensureArtist(artistId);
    assert.equal(database.getArtistMetadata(artistId)?.resolverVersion, 5);
    assert.equal(database.getArtistMetadata(artistId)?.musicBrainzId, MBID);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('biography without an avatar uses the seven-day retry window', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-avatar-ttl-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }], noImages: true }),
      () => { clock += 1001; return clock; });
    const artistId = database.getLibrary().artists[0]!.id;
    const metadata = await service.refreshArtist(artistId);
    const stored = database.getArtistMetadata(artistId)!;
    assert.equal(metadata?.avatar, null);
    assert.equal(metadata?.biography, 'Biography from Wikipedia.');
    assert.equal(stored.nextRetryAt - stored.fetchedAt!, 7 * 24 * 60 * 60 * 1000);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('custom avatar survives metadata refresh and scan and rejects non-images', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-custom-artist-avatar-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  const validPath = path.join(root, 'portrait.png');
  const invalidPath = path.join(root, 'fake.png');
  const oversizedPath = path.join(root, 'oversized.png');
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    await writeFile(validPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    await writeFile(invalidPath, '<svg></svg>');
    await writeFile(oversizedPath, Buffer.alloc(8 * 1024 * 1024 + 1));
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }]}),
      () => { clock += 1001; return clock; });
    const artistId = database.getLibrary().artists[0]!.id;
    await assert.rejects(() => service.selectCustomAvatar(artistId, invalidPath), /JPEG, PNG or WebP/);
    await assert.rejects(() => service.selectCustomAvatar(artistId, oversizedPath), /8 MiB/);
    const avatar = await service.selectCustomAvatar(artistId, validPath);
    assert.equal(await service.selectCustomAvatar(artistId, validPath), avatar);
    await service.refreshArtist(artistId);
    seedArtist(database, root, 'Test Artist');
    assert.equal(database.getLibrary().artists[0]?.customAvatar, avatar);
    service.clearCustomAvatar(artistId);
    assert.equal(database.getLibrary().artists[0]?.customAvatar, null);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('v2 artist metadata migrates without losing existing cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-migration-'));
  const databasePath = path.join(root, 'library.sqlite');
  const legacy = new DatabaseSync(databasePath);
  try {
    legacy.exec(`CREATE TABLE artist_metadata (
      artist_id TEXT PRIMARY KEY, artist_name TEXT NOT NULL, musicbrainz_id TEXT, match_mode TEXT NOT NULL DEFAULT 'automatic',
      wikipedia_override_url TEXT, biography TEXT, biography_source_url TEXT, avatar_hash TEXT, avatar_source_url TEXT,
      about_image_hash TEXT, about_image_source_url TEXT, sources_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
      fetched_at INTEGER, next_retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT
    );`);
    legacy.prepare("INSERT INTO artist_metadata(artist_id,artist_name,biography,sources_json,status,next_retry_at) VALUES(?,?,?,?,?,?)")
      .run('artist-existing', 'Existing Artist', 'Existing biography', '[]', 'available', 999);
  } finally { legacy.close(); }
  const migrated = new DatabaseService(databasePath);
  try {
    const value = migrated.getArtistMetadata('artist-existing');
    assert.equal(value?.biography, 'Existing biography');
    assert.equal(value?.resolverVersion, 1);
    assert.equal(value?.customAvatarHash, null);
  } finally { migrated.close(); await rm(root, { recursive: true, force: true }); }
});

test('offline refresh retains cached online and custom avatars', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-offline-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artwork = new ArtworkService(path.join(root, 'artwork'), database);
    const artistId = database.getLibrary().artists[0]!.id;
    const online = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }] }),
      () => { clock += 1001; return clock; });
    const first = await online.refreshArtist(artistId);
    const imagePath = path.join(root, 'portrait.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]));
    const custom = await online.selectCustomAvatar(artistId, imagePath);

    const offline = new ArtistMetadataService(database, artwork, () => undefined,
      (async () => { throw new Error('offline'); }) as typeof fetch,
      () => { clock += 1001; return clock; });
    const stale = await offline.refreshArtist(artistId);
    assert.equal(stale?.avatar, first?.avatar);
    assert.equal(database.getLibrary().artists[0]?.customAvatar, custom);
    assert.equal(database.getArtistMetadata(artistId)?.status, 'available');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('Vietnamese artists use the Vietnamese Wikipedia page and source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-vi-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'MCK');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'MCK', score: 100, aliases: [] }], country: 'VN', vietnamesePage: true }),
      () => { clock += 1001; return clock; });
    const metadata = await service.refreshArtist(database.getLibrary().artists[0]!.id);
    assert.equal(metadata?.biography, 'Tiểu sử tiếng Việt.');
    assert.equal(metadata?.biographySourceUrl, 'https://vi.wikipedia.org/wiki/MCK');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('Vietnamese MusicBrainz relation takes priority over an English Wikidata sitelink', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-vi-relation-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'MCK');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'MCK', score: 100, aliases: [] }], country: 'VN', vietnameseRelation: true }),
      () => { clock += 1001; return clock; });
    const metadata = await service.refreshArtist(database.getLibrary().artists[0]!.id);
    assert.equal(metadata?.biography, 'Tiểu sử tiếng Việt.');
    assert.equal(metadata?.biographySourceUrl, 'https://vi.wikipedia.org/wiki/MCK');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('Vietnamese Wikipedia failures fall back to English and a Vietnamese override is accepted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-vi-fallback-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'MCK');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'MCK', score: 100, aliases: [] }], country: 'VN', vietnamesePage: true, vietnameseSummaryMissing: true }),
      () => { clock += 1001; return clock; });
    const artistId = database.getLibrary().artists[0]!.id;
    const fallback = await service.refreshArtist(artistId);
    assert.equal(fallback?.biography, 'Biography from Wikipedia.');
    assert.equal(fallback?.biographySourceUrl, 'https://en.wikipedia.org/wiki/Test_Artist');
    await assert.rejects(() => service.setWikipediaOverride(artistId, 'https://example.com/wiki/MCK'), /Wikipedia article URL/);
    const overridden = await service.setWikipediaOverride(artistId, 'https://vi.wikipedia.org/wiki/MCK');
    assert.equal(overridden?.biography, 'AudioDB biography');
    assert.equal(overridden?.biographySourceUrl, 'https://www.theaudiodb.com/artist/42');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('MusicBrainz description fills About when other providers have no content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-mb-description-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'HIEUTHUHAI');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'HIEUTHUHAI', score: 100, aliases: [] }], disambiguation: 'Vietnamese rapper', omitRelation: true, wikidataIds: [], noAudioDbBiography: true, noImages: true }),
      () => { clock += 1001; return clock; });
    const artistId = database.getLibrary().artists[0]!.id;
    const metadata = await service.refreshArtist(artistId);
    assert.equal(metadata?.biography, 'Vietnamese rapper');
    assert.equal(metadata?.biographySourceUrl, `https://musicbrainz.org/artist/${MBID}`);
    assert.equal(database.getArtistMetadata(artistId)?.status, 'available');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('matched profile without any About content has a distinct persistent status', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-matched-empty-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Empty Artist');
    const service = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Empty Artist', score: 100, aliases: [] }], omitRelation: true, wikidataIds: [], noAudioDbBiography: true, noImages: true }),
      () => { clock += 1001; return clock; });
    const artistId = database.getLibrary().artists[0]!.id;
    assert.equal(await service.refreshArtist(artistId), null);
    assert.equal(database.getArtistMetadata(artistId)?.status, 'matched-empty');
    assert.equal(database.getArtistMetadata(artistId)?.musicBrainzId, MBID);
    const updates: ArtistMetadataUpdate[] = [];
    const cached = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), (value) => updates.push(value),
      (async () => { throw new Error('Should use cache'); }) as typeof fetch, () => clock);
    await cached.ensureArtist(artistId);
    assert.equal(updates.at(-1)?.status, 'matched-empty');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('temporary Wikipedia failure keeps the cached article and its source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-wiki-cache-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const artwork = new ArtworkService(path.join(root, 'artwork'), database);
    const first = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }] }),
      () => { clock += 1001; return clock; });
    await first.refreshArtist(artistId);
    const retry = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [], englishSummaryMissing: true, audioDbBiography: 'New AudioDB biography', disambiguation: 'MusicBrainz note' }),
      () => { clock += 1001; return clock; });
    const metadata = await retry.refreshArtist(artistId);
    assert.equal(metadata?.biography, 'Biography from Wikipedia.');
    assert.equal(metadata?.biographySourceUrl, 'https://en.wikipedia.org/wiki/Test_Artist');
    assert.ok(metadata?.sources.includes('wikipedia'));
    const stored = database.getArtistMetadata(artistId)!;
    assert.equal(stored.nextRetryAt - stored.fetchedAt!, 7 * 24 * 60 * 60 * 1000);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('fresh Wikipedia content replaces an equally ranked cached article', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-wiki-update-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const artwork = new ArtworkService(path.join(root, 'artwork'), database);
    await new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }] }),
      () => { clock += 1001; return clock; }).refreshArtist(artistId);
    const updated = await new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [], wikipediaExtract: 'Updated Wikipedia biography.' }),
      () => { clock += 1001; return clock; }).refreshArtist(artistId);
    assert.equal(updated?.biography, 'Updated Wikipedia biography.');
    assert.equal(updated?.biographySourceUrl, 'https://en.wikipedia.org/wiki/Test_Artist');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('TheAudioDB outranks Wikidata, while a changed Wikipedia override cannot reuse the old article', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-biography-priority-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const artwork = new ArtworkService(path.join(root, 'artwork'), database);
    const service = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }], englishSummaryMissing: true, disambiguation: 'MusicBrainz note' }),
      () => { clock += 1001; return clock; });
    const first = await service.refreshArtist(artistId);
    assert.equal(first?.biography, 'AudioDB biography');
    assert.equal(first?.biographySourceUrl, 'https://www.theaudiodb.com/artist/42');

    const wiki = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [], wikipediaExtract: 'Wikipedia article.' }),
      () => { clock += 1001; return clock; });
    assert.equal((await wiki.refreshArtist(artistId))?.biography, 'Wikipedia article.');
    const changed = new ArtistMetadataService(database, artwork, () => undefined,
      mockFetch({ searchArtists: [], vietnameseSummaryMissing: true, englishSummaryMissing: true, noAudioDbBiography: true, disambiguation: 'MusicBrainz note' }),
      () => { clock += 1001; return clock; });
    const overridden = await changed.setWikipediaOverride(artistId, 'https://vi.wikipedia.org/wiki/MCK');
    assert.equal(overridden?.biography, 'Wikidata description');
    assert.equal(overridden?.biographySourceUrl, 'https://www.wikidata.org/wiki/Q123');
    assert.equal(database.getArtistMetadata(artistId)?.wikipediaOverrideUrl, 'https://vi.wikipedia.org/wiki/MCK');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test('changing the MusicBrainz match does not reuse the prior profile biography', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lutsra-artist-rematch-source-'));
  const database = new DatabaseService(path.join(root, 'library.sqlite'));
  let clock = 1_800_000_000_000;
  try {
    seedArtist(database, root, 'Test Artist');
    const artistId = database.getLibrary().artists[0]!.id;
    const old = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [{ id: MBID, name: 'Test Artist', score: 100, aliases: [] }] }),
      () => { clock += 1001; return clock; });
    await old.refreshArtist(artistId);
    database.saveArtistMetadata({ ...database.getArtistMetadata(artistId)!, musicBrainzId: '22222222-2222-4222-8222-222222222222' });
    const next = new ArtistMetadataService(database, new ArtworkService(path.join(root, 'artwork'), database), () => undefined,
      mockFetch({ searchArtists: [], englishSummaryMissing: true, audioDbBiography: 'New matched artist' }),
      () => { clock += 1001; return clock; });
    const metadata = await next.setArtistMatch(artistId, MBID);
    assert.equal(metadata?.biography, 'New matched artist');
    assert.equal(metadata?.biographySourceUrl, 'https://www.theaudiodb.com/artist/42');
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

function mockFetch(options: { searchArtists: Array<Record<string, unknown>>; invalidWikimediaImage?: boolean; omitRelation?: boolean; wikidataIds?: string[]; noImages?: boolean; country?: string; disambiguation?: string; noAudioDbBiography?: boolean; audioDbBiography?: string; wikidataDescription?: string; wikipediaExtract?: string; englishSummaryMissing?: boolean; vietnamesePage?: boolean; vietnameseRelation?: boolean; vietnameseSummaryMissing?: boolean }): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/ws/2/artist/?')) return jsonResponse({ artists: options.searchArtists });
    if (url.includes(`/ws/2/artist/${MBID}`)) return jsonResponse({ country: options.country, disambiguation: options.disambiguation, relations: options.omitRelation ? [] : [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } }, ...(options.vietnameseRelation ? [{ type: 'wikipedia', url: { resource: 'https://vi.wikipedia.org/wiki/MCK' } }] : [])] });
    if (url.includes('query.wikidata.org/sparql')) return jsonResponse({ results: { bindings: (options.wikidataIds ?? ['Q123']).map((id) => ({ item: { value: `http://www.wikidata.org/entity/${id}` } })) } });
    if (url.includes('Special:EntityData/Q123.json')) return jsonResponse({ entities: { Q123: {
      descriptions: { en: { value: options.wikidataDescription ?? 'Wikidata description' }, ...(options.vietnamesePage ? { vi: { value: 'Nghệ sĩ Việt Nam' } } : {}) }, sitelinks: { enwiki: { title: 'Test Artist' }, ...(options.vietnamesePage ? { viwiki: { title: 'MCK' } } : {}) },
      claims: options.noImages ? {} : { P18: [{ mainsnak: { datavalue: { value: 'Test Artist.jpg' } } }] },
    } } });
    if (url.includes('vi.wikipedia.org/api/rest_v1/page/summary/')) return options.vietnameseSummaryMissing ? new Response(null, { status: 404 }) : jsonResponse({ extract: 'Tiểu sử tiếng Việt.', content_urls: { desktop: { page: 'https://vi.wikipedia.org/wiki/MCK' } } });
    if (url.includes('/page/summary/')) return options.englishSummaryMissing ? new Response(null, { status: 503 }) : jsonResponse({ extract: options.wikipediaExtract ?? 'Biography from Wikipedia.', ...(options.noImages ? {} : { originalimage: { source: 'https://upload.wikimedia.org/test.png' } }), content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Test_Artist' } } });
    if (url.includes('artist-mb.php')) return jsonResponse({ artists: [{ idArtist: '42', strBiographyEN: options.noAudioDbBiography ? null : options.audioDbBiography ?? 'AudioDB biography', strArtistThumb: options.noImages ? null : 'https://www.theaudiodb.com/thumb.png', strArtistFanart: options.noImages ? null : 'https://www.theaudiodb.com/fanart.png' }] });
    if (url.includes('upload.wikimedia.org') && options.invalidWikimediaImage) return new Response('not an image', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url.includes('upload.wikimedia.org') || url.includes('theaudiodb.com')) return new Response(Buffer.from([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
}

function jsonResponse(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } }); }

function seedArtist(database: DatabaseService, root: string, artistName: string): void {
  const folder = database.addFolder(root, 'Music');
  const track: StoredTrack = {
    id: `track-${'d'.repeat(64)}`, path: path.join(root, 'track.flac'), fileName: 'track.flac', title: 'Track',
    artist: artistName, albumArtist: artistName, album: 'Album', genre: null, year: null, trackNumber: 1, discNumber: 1,
    duration: 60, codec: 'FLAC', bitrate: null, sampleRate: null, bitDepth: null, channels: null, artwork: null,
    artworkHash: null, fileSize: null, lastModified: null, isAvailable: true,
  };
  database.upsertTracks(folder.id, 'scan', [track]);
}
