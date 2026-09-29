import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import path from 'node:path';
import { Album, Artist, ArtistMetadataSource, ArtistOnlineMetadata, DEFAULT_ACCENT_COLOR, DEFAULT_AUDIO_VISUALIZATION_MODE, DEFAULT_LAYOUT_MODE, DEFAULT_SONG_COLUMN_ORDER, DEFAULT_THEME_PRESET, FolderNode, isAccentColor, isAudioVisualizationMode, isLayoutMode, isThemePreset, MusicFolder, normalizeHiddenSongColumns, normalizeSongColumnOrder, normalizeThemePreset, orderAlbumTracks, Playlist, PlaylistEntry, Settings, Track } from '../../src/app/core/models/index.js';
import { LibrarySnapshot } from '../../src/app/core/contracts/library.gateway.js';
import { pathKey, stableId } from '../utils/path-utils.js';

const { DatabaseSync } = await import('node:sqlite');

type Row = Record<string, unknown>;

export interface StoredTrack extends Track { artworkHash: string | null; artworkSource?: 'embedded' | 'folder' | 'none' | null; }
export interface StoredArtistMetadata {
  artistId: string;
  artistName: string;
  musicBrainzId: string | null;
  matchMode: 'automatic' | 'manual';
  wikipediaOverrideUrl: string | null;
  biography: string | null;
  biographySourceUrl: string | null;
  avatarHash: string | null;
  avatarSourceUrl: string | null;
  aboutImageHash: string | null;
  aboutImageSourceUrl: string | null;
  sources: ArtistMetadataSource[];
  status: 'available' | 'not-found' | 'ambiguous' | 'matched-empty' | 'error';
  fetchedAt: number | null;
  nextRetryAt: number;
  lastError: string | null;
  resolverVersion: number;
  customAvatarHash: string | null;
}

export class DatabaseService {
  private readonly db: DatabaseSyncType;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath, { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  close(): void { this.db.close(); }

  private migrate(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS music_folders (id TEXT PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS directories (folder_id TEXT NOT NULL, path TEXT NOT NULL, path_key TEXT NOT NULL, parent_path_key TEXT, name TEXT NOT NULL, last_seen_scan TEXT NOT NULL, PRIMARY KEY(folder_id, path_key), FOREIGN KEY(folder_id) REFERENCES music_folders(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS artworks (hash TEXT PRIMARY KEY, path TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, path_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL, title TEXT NOT NULL,
        artist TEXT, album_artist TEXT, album TEXT, genre TEXT, year INTEGER, track_number INTEGER, disc_number INTEGER,
        duration REAL NOT NULL, codec TEXT, bitrate INTEGER, sample_rate INTEGER, bit_depth INTEGER, channels INTEGER,
        artwork_hash TEXT, artwork_source TEXT, file_size INTEGER, last_modified INTEGER, is_available INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY(artwork_hash) REFERENCES artworks(hash)
      );
      CREATE TABLE IF NOT EXISTS folder_tracks (folder_id TEXT NOT NULL, track_id TEXT NOT NULL, last_seen_scan TEXT NOT NULL, PRIMARY KEY(folder_id, track_id), FOREIGN KEY(folder_id) REFERENCES music_folders(id) ON DELETE CASCADE, FOREIGN KEY(track_id) REFERENCES tracks(id));
      CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS playlist_entries (id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL, track_id TEXT NOT NULL, position INTEGER NOT NULL, added_at INTEGER NOT NULL, FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE, FOREIGN KEY(track_id) REFERENCES tracks(id));
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_runs (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL, warning_count INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(folder_id) REFERENCES music_folders(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS artist_metadata (
        artist_id TEXT PRIMARY KEY, artist_name TEXT NOT NULL, musicbrainz_id TEXT, match_mode TEXT NOT NULL DEFAULT 'automatic',
        wikipedia_override_url TEXT, biography TEXT, biography_source_url TEXT, avatar_hash TEXT, avatar_source_url TEXT,
        about_image_hash TEXT, about_image_source_url TEXT, sources_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
        fetched_at INTEGER, next_retry_at INTEGER NOT NULL DEFAULT 0, last_error TEXT,
        resolver_version INTEGER NOT NULL DEFAULT 1, custom_avatar_hash TEXT REFERENCES artworks(hash),
        FOREIGN KEY(avatar_hash) REFERENCES artworks(hash), FOREIGN KEY(about_image_hash) REFERENCES artworks(hash)
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch('now') * 1000);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, unixepoch('now') * 1000);
      `);
      const columns = new Set((this.db.prepare('PRAGMA table_info(artist_metadata)').all() as Row[]).map((row) => String(row['name'])));
      if (!columns.has('resolver_version')) this.db.exec('ALTER TABLE artist_metadata ADD COLUMN resolver_version INTEGER NOT NULL DEFAULT 1');
      if (!columns.has('custom_avatar_hash')) this.db.exec('ALTER TABLE artist_metadata ADD COLUMN custom_avatar_hash TEXT REFERENCES artworks(hash)');
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, unixepoch('now') * 1000)");
      const trackColumns = new Set((this.db.prepare('PRAGMA table_info(tracks)').all() as Row[]).map((row) => String(row['name'])));
      if (!trackColumns.has('artwork_source')) this.db.exec('ALTER TABLE tracks ADD COLUMN artwork_source TEXT');
      this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, unixepoch('now') * 1000)");
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listFolders(): MusicFolder[] {
    return (this.db.prepare('SELECT id, path, name, added_at FROM music_folders ORDER BY added_at').all() as Row[]).map((row) => ({
      id: String(row['id']), path: String(row['path']), name: String(row['name']), addedAt: Number(row['added_at']),
    }));
  }

  getFolder(id: string): MusicFolder | null {
    const row = this.db.prepare('SELECT id, path, name, added_at FROM music_folders WHERE id = ?').get(id) as Row | undefined;
    return row ? { id: String(row['id']), path: String(row['path']), name: String(row['name']), addedAt: Number(row['added_at']) } : null;
  }

  addFolder(folderPath: string, name: string): MusicFolder {
    const key = pathKey(folderPath);
    const existing = this.db.prepare('SELECT id, path, name, added_at FROM music_folders WHERE path_key = ?').get(key) as Row | undefined;
    if (existing) return { id: String(existing['id']), path: String(existing['path']), name: String(existing['name']), addedAt: Number(existing['added_at']) };
    const folder: MusicFolder = { id: stableId('folder', key), path: folderPath, name, addedAt: Date.now() };
    this.db.prepare('INSERT INTO music_folders(id, path, path_key, name, added_at) VALUES (?, ?, ?, ?, ?)').run(folder.id, folder.path, key, folder.name, folder.addedAt);
    return folder;
  }

  removeFolder(id: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM music_folders WHERE id = ?').run(id);
      this.db.exec('UPDATE tracks SET is_available = 0 WHERE id NOT IN (SELECT track_id FROM folder_tracks)');
    });
  }

  saveArtwork(hash: string, artworkPath: string, mime: string, size: number): void {
    this.db.prepare('INSERT OR IGNORE INTO artworks(hash, path, mime, size) VALUES (?, ?, ?, ?)').run(hash, artworkPath, mime, size);
  }

  resolveArtwork(hash: string): { path: string; mime: string } | null {
    const row = this.db.prepare('SELECT path, mime FROM artworks WHERE hash = ?').get(hash) as Row | undefined;
    return row ? { path: String(row['path']), mime: String(row['mime']) } : null;
  }

  getArtistMetadata(artistId: string): StoredArtistMetadata | null {
    const row = this.db.prepare('SELECT * FROM artist_metadata WHERE artist_id=?').get(artistId) as Row | undefined;
    return row ? mapArtistMetadata(row) : null;
  }

  setCustomArtistAvatar(artistId: string, hash: string | null): void {
    this.db.prepare('UPDATE artist_metadata SET custom_avatar_hash=? WHERE artist_id=?').run(hash, artistId);
  }

  saveArtistMetadata(value: StoredArtistMetadata): void {
    this.db.prepare(`INSERT INTO artist_metadata(
      artist_id,artist_name,musicbrainz_id,match_mode,wikipedia_override_url,biography,biography_source_url,
      avatar_hash,avatar_source_url,about_image_hash,about_image_source_url,sources_json,status,fetched_at,next_retry_at,last_error,resolver_version,custom_avatar_hash
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(artist_id) DO UPDATE SET
      artist_name=excluded.artist_name,musicbrainz_id=excluded.musicbrainz_id,match_mode=excluded.match_mode,
      wikipedia_override_url=excluded.wikipedia_override_url,biography=excluded.biography,biography_source_url=excluded.biography_source_url,
      avatar_hash=excluded.avatar_hash,avatar_source_url=excluded.avatar_source_url,about_image_hash=excluded.about_image_hash,
      about_image_source_url=excluded.about_image_source_url,sources_json=excluded.sources_json,status=excluded.status,
      fetched_at=excluded.fetched_at,next_retry_at=excluded.next_retry_at,last_error=excluded.last_error,
      resolver_version=excluded.resolver_version,custom_avatar_hash=artist_metadata.custom_avatar_hash`).run(
      value.artistId, value.artistName, value.musicBrainzId, value.matchMode, value.wikipediaOverrideUrl,
      value.biography, value.biographySourceUrl, value.avatarHash, value.avatarSourceUrl, value.aboutImageHash,
      value.aboutImageSourceUrl, JSON.stringify(value.sources), value.status, value.fetchedAt, value.nextRetryAt, value.lastError,
      value.resolverVersion, value.customAvatarHash,
    );
  }

  findTrackFingerprint(filePath: string): { fileSize: number | null; lastModified: number | null } | null {
    const row = this.db.prepare('SELECT file_size, last_modified FROM tracks WHERE path_key = ?').get(pathKey(filePath)) as Row | undefined;
    return row ? { fileSize: row['file_size'] == null ? null : Number(row['file_size']), lastModified: row['last_modified'] == null ? null : Number(row['last_modified']) } : null;
  }

  getStoredTrackByPath(filePath: string): StoredTrack | null {
    const row = this.db.prepare('SELECT * FROM tracks WHERE path_key = ?').get(pathKey(filePath)) as Row | undefined;
    return row ? this.mapTrack(row) : null;
  }

  upsertTracks(folderId: string, scanId: string, tracks: StoredTrack[]): void {
    const upsert = this.db.prepare(`INSERT INTO tracks(id,path,path_key,file_name,title,artist,album_artist,album,genre,year,track_number,disc_number,duration,codec,bitrate,sample_rate,bit_depth,channels,artwork_hash,artwork_source,file_size,last_modified,is_available)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
      ON CONFLICT(id) DO UPDATE SET path=excluded.path,path_key=excluded.path_key,file_name=excluded.file_name,title=excluded.title,artist=excluded.artist,album_artist=excluded.album_artist,album=excluded.album,genre=excluded.genre,year=excluded.year,track_number=excluded.track_number,disc_number=excluded.disc_number,duration=excluded.duration,codec=excluded.codec,bitrate=excluded.bitrate,sample_rate=excluded.sample_rate,bit_depth=excluded.bit_depth,channels=excluded.channels,artwork_hash=excluded.artwork_hash,artwork_source=excluded.artwork_source,file_size=excluded.file_size,last_modified=excluded.last_modified,is_available=1`);
    const link = this.db.prepare('INSERT INTO folder_tracks(folder_id,track_id,last_seen_scan) VALUES(?,?,?) ON CONFLICT(folder_id,track_id) DO UPDATE SET last_seen_scan=excluded.last_seen_scan');
    this.transaction(() => {
      for (const track of tracks) {
        upsert.run(track.id, track.path, pathKey(track.path), track.fileName, track.title, track.artist, track.albumArtist, track.album, track.genre, track.year, track.trackNumber, track.discNumber, track.duration, track.codec, track.bitrate, track.sampleRate, track.bitDepth, track.channels, track.artworkHash, track.artworkSource ?? (track.artworkHash ? 'embedded' : 'none'), track.fileSize, track.lastModified);
        link.run(folderId, track.id, scanId);
      }
    });
  }

  markExistingTrackSeen(folderId: string, scanId: string, track: StoredTrack): void {
    this.db.prepare('UPDATE tracks SET is_available=1 WHERE id=?').run(track.id);
    this.db.prepare('INSERT INTO folder_tracks(folder_id,track_id,last_seen_scan) VALUES(?,?,?) ON CONFLICT(folder_id,track_id) DO UPDATE SET last_seen_scan=excluded.last_seen_scan').run(folderId, track.id, scanId);
  }

  updateTrackArtwork(id: string, artworkHash: string | null, artworkSource: 'folder' | 'none'): void {
    this.db.prepare('UPDATE tracks SET artwork_hash=?, artwork_source=? WHERE id=?').run(artworkHash, artworkSource, id);
  }

  saveDirectories(folderId: string, scanId: string, directories: Array<{ path: string; parentPath: string | null; name: string }>): void {
    const statement = this.db.prepare('INSERT INTO directories(folder_id,path,path_key,parent_path_key,name,last_seen_scan) VALUES(?,?,?,?,?,?) ON CONFLICT(folder_id,path_key) DO UPDATE SET path=excluded.path,parent_path_key=excluded.parent_path_key,name=excluded.name,last_seen_scan=excluded.last_seen_scan');
    this.transaction(() => directories.forEach((directory) => statement.run(folderId, directory.path, pathKey(directory.path), directory.parentPath ? pathKey(directory.parentPath) : null, directory.name, scanId)));
  }

  startScan(scanId: string, folderId: string): void { this.db.prepare('INSERT INTO scan_runs(id,folder_id,started_at,status) VALUES(?,?,?,?)').run(scanId, folderId, Date.now(), 'running'); }
  finishScan(scanId: string, folderId: string, warnings: number): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM folder_tracks WHERE folder_id=? AND last_seen_scan<>?').run(folderId, scanId);
      this.db.prepare('DELETE FROM directories WHERE folder_id=? AND last_seen_scan<>?').run(folderId, scanId);
      this.db.exec('UPDATE tracks SET is_available=0 WHERE id NOT IN (SELECT track_id FROM folder_tracks)');
      this.db.prepare('UPDATE scan_runs SET finished_at=?, status=?, warning_count=? WHERE id=?').run(Date.now(), warnings ? 'completed-with-errors' : 'completed', warnings, scanId);
    });
  }
  failScan(scanId: string, warnings: number): void { this.db.prepare('UPDATE scan_runs SET finished_at=?, status=?, warning_count=? WHERE id=?').run(Date.now(), 'failed', warnings, scanId); }

  getLibrary(): LibrarySnapshot {
    const storedTracks = (this.db.prepare('SELECT t.* FROM tracks t WHERE EXISTS (SELECT 1 FROM folder_tracks ft WHERE ft.track_id = t.id) ORDER BY t.title COLLATE NOCASE').all() as Row[]).map((row) => this.mapTrack(row));
    const tracks = storedTracks.map((track) => this.toPublicTrack(track));
    const artworkSources = new Map(storedTracks.map((track) => [track.id, track.artworkSource]));
    const albumMap = new Map<string, Album>();
    const albumArtworkPriority = new Map<string, number>();
    const artistMap = new Map<string, Artist>();
    for (const track of tracks) {
      const artistName = track.albumArtist || track.artist || 'Unknown Artist';
      const artistId = stableId('artist', artistName.trim().toLocaleLowerCase());
      const albumTitle = track.album || 'Unknown Album';
      const albumId = stableId('album', `${albumTitle.trim().toLocaleLowerCase()}\0${artistName.trim().toLocaleLowerCase()}`);
      const album = albumMap.get(albumId) ?? { id: albumId, title: albumTitle, artist: artistName, year: track.year, artwork: null, trackIds: [] };
      album.trackIds.push(track.id);
      const priority = track.artwork ? (artworkSources.get(track.id) === 'folder' ? 1 : 2) : 0;
      if (priority > (albumArtworkPriority.get(albumId) ?? 0)) {
        album.artwork = track.artwork;
        albumArtworkPriority.set(albumId, priority);
      }
      albumMap.set(albumId, album);
      let artist = artistMap.get(artistId);
      if (!artist) {
        const cached = this.getArtistMetadata(artistId);
        artist = { id: artistId, name: artistName, albumIds: [], trackIds: [], onlineMetadata: this.toPublicArtistMetadata(cached), customAvatar: cached?.customAvatarHash ? `music://artwork/${cached.customAvatarHash}` : null };
      }
      if (!artist.albumIds.includes(albumId)) artist.albumIds.push(albumId);
      artist.trackIds.push(track.id); artistMap.set(artistId, artist);
    }
    const trackMap = new Map(tracks.map((track) => [track.id, track]));
    const albums = [...albumMap.values()].map((album) => ({
      ...album,
      trackIds: orderAlbumTracks(
        album.trackIds.flatMap((trackId) => {
          const track = trackMap.get(trackId);
          return track ? [track] : [];
        }),
      ).map((track) => track.id),
    }));
    return { tracks, albums, artists: [...artistMap.values()], folders: this.listFolders() };
  }

  getTrackById(id: string): Track | null {
    const row = this.db.prepare(`SELECT t.*, EXISTS (SELECT 1 FROM folder_tracks ft WHERE ft.track_id = t.id) AS in_library
      FROM tracks t WHERE t.id = ?`).get(id) as Row | undefined;
    if (!row) return null;
    const track = this.toPublicTrack(this.mapTrack(row));
    return { ...track, isAvailable: track.isAvailable && Boolean(row['in_library']) };
  }

  getFolderTree(folderId: string): FolderNode | null {
    const folder = this.getFolder(folderId); if (!folder) return null;
    const directoryRows = this.db.prepare('SELECT path,path_key,parent_path_key,name FROM directories WHERE folder_id=?').all(folderId) as Row[];
    const nodes = new Map<string, FolderNode>();
    nodes.set(pathKey(folder.path), { id: stableId('dir', `${folderId}\0${pathKey(folder.path)}`), name: folder.name, path: folder.path, isFolder: true, children: [] });
    for (const row of directoryRows) nodes.set(String(row['path_key']), { id: stableId('dir', `${folderId}\0${row['path_key']}`), name: String(row['name']), path: String(row['path']), isFolder: true, children: [] });
    for (const row of directoryRows) {
      const key = String(row['path_key']); const parentKey = row['parent_path_key'] == null ? pathKey(folder.path) : String(row['parent_path_key']);
      if (key !== pathKey(folder.path)) nodes.get(parentKey)?.children?.push(nodes.get(key)!);
    }
    const tracks = this.db.prepare('SELECT t.id,t.path,t.file_name FROM tracks t JOIN folder_tracks ft ON ft.track_id=t.id WHERE ft.folder_id=?').all(folderId) as Row[];
    for (const row of tracks) {
      const parent = nodes.get(pathKey(path.dirname(String(row['path']))));
      parent?.children?.push({ id: stableId('file', String(row['id'])), name: String(row['file_name']), path: String(row['path']), isFolder: false, trackId: String(row['id']) });
    }
    return nodes.get(pathKey(folder.path)) ?? null;
  }

  resolveTrack(id: string): { path: string; mime: string | null } | null {
    const row = this.db.prepare('SELECT path,codec FROM tracks WHERE id=? AND is_available=1').get(id) as Row | undefined;
    return row ? { path: String(row['path']), mime: codecMime(row['codec'] == null ? null : String(row['codec'])) } : null;
  }

  listPlaylists(): Playlist[] {
    const playlists = this.db.prepare('SELECT * FROM playlists ORDER BY created_at').all() as Row[];
    const entries = this.db.prepare('SELECT * FROM playlist_entries ORDER BY playlist_id,position').all() as Row[];
    return playlists.map((row) => ({ id: String(row['id']), name: String(row['name']), createdAt: Number(row['created_at']), updatedAt: Number(row['updated_at']), entries: entries.filter((entry) => entry['playlist_id'] === row['id']).map(mapPlaylistEntry) }));
  }
  createPlaylist(name: string): Playlist { const now=Date.now(); const playlist={ id: stableId('playlist', `${now}\0${name}\0${Math.random()}`), name: name.trim() || 'Untitled Playlist', entries: [], createdAt: now, updatedAt: now }; this.db.prepare('INSERT INTO playlists(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(playlist.id,playlist.name,now,now); return playlist; }
  renamePlaylist(id: string, name: string): Playlist { this.requirePlaylist(id); this.db.prepare('UPDATE playlists SET name=?,updated_at=? WHERE id=?').run(name.trim() || 'Untitled Playlist',Date.now(),id); return this.requirePlaylist(id); }
  deletePlaylist(id: string): void { this.db.prepare('DELETE FROM playlists WHERE id=?').run(id); }
  addPlaylistTracks(id: string, trackIds: string[]): Playlist { const playlist=this.requirePlaylist(id); const insert=this.db.prepare('INSERT INTO playlist_entries(id,playlist_id,track_id,position,added_at) VALUES(?,?,?,?,?)'); this.transaction(()=>trackIds.forEach((trackId,index)=>{ if(!this.db.prepare('SELECT 1 FROM tracks WHERE id=?').get(trackId)) throw new Error('Unknown track'); insert.run(stableId('entry',`${id}\0${Date.now()}\0${index}\0${Math.random()}`),id,trackId,playlist.entries.length+index,Date.now()); })); this.touchPlaylist(id); return this.requirePlaylist(id); }
  removePlaylistEntry(id: string, entryId: string): Playlist { this.requirePlaylist(id); this.db.prepare('DELETE FROM playlist_entries WHERE playlist_id=? AND id=?').run(id,entryId); this.reindexPlaylist(id); return this.requirePlaylist(id); }
  reorderPlaylist(id: string, entryIds: string[]): Playlist { const playlist=this.requirePlaylist(id); if(entryIds.length!==playlist.entries.length || new Set(entryIds).size!==entryIds.length || entryIds.some((entryId)=>!playlist.entries.some((entry)=>entry.id===entryId))) throw new Error('Invalid playlist entry order'); const update=this.db.prepare('UPDATE playlist_entries SET position=? WHERE playlist_id=? AND id=?'); this.transaction(()=>entryIds.forEach((entryId,index)=>update.run(index,id,entryId))); this.touchPlaylist(id); return this.requirePlaylist(id); }

  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key='app'").get() as Row | undefined;
    const defaults: Settings = { musicFolders: this.listFolders(), defaultVolume: 0.8, repeatMode: 'off', shuffle: false, themePreset: DEFAULT_THEME_PRESET, accentColor: DEFAULT_ACCENT_COLOR, layoutMode: DEFAULT_LAYOUT_MODE, audioVisualizationMode: DEFAULT_AUDIO_VISUALIZATION_MODE, hiddenSongColumns: [], songColumnOrder: [...DEFAULT_SONG_COLUMN_ORDER] };
    if (!row) return defaults;
    try {
      const stored = JSON.parse(String(row['value'])) as Partial<Settings>;
      return { ...defaults, ...stored, musicFolders: this.listFolders(), themePreset: normalizeThemePreset(stored.themePreset), accentColor: isAccentColor(stored.accentColor) ? stored.accentColor : DEFAULT_ACCENT_COLOR, layoutMode: isLayoutMode(stored.layoutMode) ? stored.layoutMode : DEFAULT_LAYOUT_MODE, audioVisualizationMode: isAudioVisualizationMode(stored.audioVisualizationMode) ? stored.audioVisualizationMode : DEFAULT_AUDIO_VISUALIZATION_MODE, hiddenSongColumns: normalizeHiddenSongColumns(stored.hiddenSongColumns), songColumnOrder: normalizeSongColumnOrder(stored.songColumnOrder) };
    } catch { return defaults; }
  }
  saveSettings(settings: Partial<Settings>): Settings { const current=this.getSettings(); const next: Settings={ ...current, ...settings, musicFolders:this.listFolders(), themePreset:isThemePreset(settings.themePreset) ? settings.themePreset : current.themePreset, accentColor:isAccentColor(settings.accentColor) ? settings.accentColor : current.accentColor, layoutMode:isLayoutMode(settings.layoutMode) ? settings.layoutMode : current.layoutMode, audioVisualizationMode:isAudioVisualizationMode(settings.audioVisualizationMode) ? settings.audioVisualizationMode : current.audioVisualizationMode, hiddenSongColumns: settings.hiddenSongColumns === undefined ? current.hiddenSongColumns : normalizeHiddenSongColumns(settings.hiddenSongColumns), songColumnOrder: settings.songColumnOrder === undefined ? current.songColumnOrder : normalizeSongColumnOrder(settings.songColumnOrder), defaultVolume:Math.max(0,Math.min(1,settings.defaultVolume ?? current.defaultVolume)) }; this.db.prepare("INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next)); return next; }

  private requirePlaylist(id: string): Playlist { const playlist=this.listPlaylists().find((item)=>item.id===id); if(!playlist) throw new Error('Playlist not found'); return playlist; }
  private touchPlaylist(id: string): void { this.db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(Date.now(),id); }
  private reindexPlaylist(id: string): void { const rows=this.db.prepare('SELECT id FROM playlist_entries WHERE playlist_id=? ORDER BY position').all(id) as Row[]; const update=this.db.prepare('UPDATE playlist_entries SET position=? WHERE id=?'); this.transaction(()=>rows.forEach((row,index)=>update.run(index,String(row['id'])))); this.touchPlaylist(id); }
  private mapTrack(row: Row): StoredTrack { return { id:String(row['id']),path:String(row['path']),fileName:String(row['file_name']),title:String(row['title']),artist:nullableString(row['artist']),albumArtist:nullableString(row['album_artist']),album:nullableString(row['album']),genre:nullableString(row['genre']),year:nullableNumber(row['year']),trackNumber:nullableNumber(row['track_number']),discNumber:nullableNumber(row['disc_number']),duration:Number(row['duration']),codec:nullableString(row['codec']),bitrate:nullableNumber(row['bitrate']),sampleRate:nullableNumber(row['sample_rate']),bitDepth:nullableNumber(row['bit_depth']),channels:nullableNumber(row['channels']),artwork:null,fileSize:nullableNumber(row['file_size']),lastModified:nullableNumber(row['last_modified']),isAvailable:Boolean(row['is_available']),artworkHash:nullableString(row['artwork_hash']),artworkSource:nullableString(row['artwork_source']) as StoredTrack['artworkSource'] }; }
  private toPublicTrack(track: StoredTrack): Track { const { artworkHash, artworkSource, ...value }=track; return { ...value, artwork: artworkHash ? `music://artwork/${artworkHash}` : null }; }
  private toPublicArtistMetadata(value: StoredArtistMetadata | null): ArtistOnlineMetadata | null {
    if (!value?.musicBrainzId || value.status !== 'available' || value.fetchedAt === null) return null;
    return {
      musicBrainzId: value.musicBrainzId,
      matchMode: value.matchMode,
      biography: value.biography,
      biographySourceUrl: value.biographySourceUrl,
      avatar: value.avatarHash ? `music://artwork/${value.avatarHash}` : null,
      avatarSourceUrl: value.avatarSourceUrl,
      aboutImage: value.aboutImageHash ? `music://artwork/${value.aboutImageHash}` : null,
      aboutImageSourceUrl: value.aboutImageSourceUrl,
      sources: value.sources,
      fetchedAt: value.fetchedAt,
    };
  }
  private transaction(callback:()=>void): void { this.db.exec('BEGIN IMMEDIATE'); try { callback(); this.db.exec('COMMIT'); } catch(error) { this.db.exec('ROLLBACK'); throw error; } }
}

function nullableString(value: unknown): string | null { return value == null ? null : String(value); }
function nullableNumber(value: unknown): number | null { return value == null ? null : Number(value); }
function mapPlaylistEntry(row: Row): PlaylistEntry { return { id:String(row['id']),trackId:String(row['track_id']),addedAt:Number(row['added_at']) }; }
function mapArtistMetadata(row: Row): StoredArtistMetadata {
  let sources: ArtistMetadataSource[] = [];
  try { sources = JSON.parse(String(row['sources_json'])) as ArtistMetadataSource[]; } catch { sources = []; }
  return {
    artistId: String(row['artist_id']), artistName: String(row['artist_name']),
    musicBrainzId: nullableString(row['musicbrainz_id']), matchMode: row['match_mode'] === 'manual' ? 'manual' : 'automatic',
    wikipediaOverrideUrl: nullableString(row['wikipedia_override_url']), biography: nullableString(row['biography']),
    biographySourceUrl: nullableString(row['biography_source_url']), avatarHash: nullableString(row['avatar_hash']),
    avatarSourceUrl: nullableString(row['avatar_source_url']), aboutImageHash: nullableString(row['about_image_hash']),
    aboutImageSourceUrl: nullableString(row['about_image_source_url']), sources,
    status: isMetadataStatus(row['status']) ? row['status'] : 'error', fetchedAt: nullableNumber(row['fetched_at']),
    nextRetryAt: Number(row['next_retry_at']), lastError: nullableString(row['last_error']),
    resolverVersion: Number(row['resolver_version'] ?? 1), customAvatarHash: nullableString(row['custom_avatar_hash']),
  };
}
function isMetadataStatus(value: unknown): value is StoredArtistMetadata['status'] { return ['available','not-found','ambiguous','matched-empty','error'].includes(String(value)); }
function codecMime(codec: string | null): string | null { const value=codec?.toLowerCase() ?? ''; if(value.includes('flac')) return 'audio/flac'; if(value.includes('mpeg')||value.includes('mp3')) return 'audio/mpeg'; if(value.includes('wav')||value.includes('pcm')) return 'audio/wav'; if(value.includes('aac')||value.includes('m4a')) return 'audio/mp4'; if(value.includes('opus')) return 'audio/ogg'; if(value.includes('vorbis')||value.includes('ogg')) return 'audio/ogg'; return null; }
