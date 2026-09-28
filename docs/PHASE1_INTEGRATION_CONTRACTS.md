# Lutsra — Desktop Integration Contracts

Tài liệu mô tả contract hiện dùng giữa Angular Renderer, preload và Electron Main. Code trong `src/app/core/contracts`, `src/app/core/desktop` và `electron/preload.cts` là nguồn chuẩn khi tài liệu và implementation khác nhau.

## Provider boundary

`src/app/app.config.ts` chọn implementation theo runtime:

- Có `window.desktop`: dùng Electron gateways và `HtmlAudioPlaybackEngine`.
- Không có `window.desktop`: dùng mock gateways và `MockPlaybackEngine`.

Components chỉ gọi Angular services/gateways. Không component nào truy cập `ipcRenderer`, Node API hoặc `HTMLAudioElement` trực tiếp.

## LibraryGateway

```ts
interface LibraryGateway {
  getLibrary(): Promise<LibrarySnapshot>;
  getFolderTree(folderId: string): Promise<FolderNode | null>;
  selectAndAddMusicFolders(): Promise<MusicFolder[]>;
  removeMusicFolder(folderId: string): Promise<void>;
  requestScan(folderIds?: string[]): Promise<void>;
  readonly scanProgress$: Observable<ScanProgress>;
}
```

Native picker và đăng ký folder nằm trong cùng handler. Renderer không gửi đường dẫn tùy ý để đăng ký hoặc scan. `requestScan` chỉ nhận ID của folder đã tồn tại trong database.

## DesktopApi

Preload expose duy nhất `window.desktop`:

```ts
interface DesktopApi {
  readonly runtime: 'electron';
  ping(): Promise<'pong'>;
  windowControls: {
    setTitleBarAppearance(mode: 'light' | 'dark'): Promise<void>;
  };
  library: {
    getSnapshot(): Promise<LibrarySnapshot>;
    getFolderTree(folderId: string): Promise<FolderNode | null>;
    getTrackDetails(trackId: string): Promise<TrackDetails>;
    getLyrics(trackId: string): Promise<string | null>;
    findTracksWithLyrics(trackIds: string[]): Promise<string[]>;
    selectAndAddFolders(): Promise<MusicFolder[]>;
    removeFolder(folderId: string): Promise<void>;
    startScan(folderIds?: string[]): Promise<void>;
    onScanProgress(listener: (value: ScanProgress) => void): () => void;
  };
  artistMetadata: {
    refreshMissing(force?: boolean): Promise<void>;
    ensureArtist(artistId: string): Promise<void>;
    refreshArtist(artistId: string): Promise<ArtistOnlineMetadata | null>;
    searchCandidates(artistName: string): Promise<ArtistMatchCandidate[]>;
    setArtistMatch(artistId: string, musicBrainzId: string): Promise<ArtistOnlineMetadata | null>;
    setWikipediaOverride(artistId: string, url: string | null): Promise<ArtistOnlineMetadata | null>;
    selectCustomAvatar(artistId: string): Promise<string | null>;
    clearCustomAvatar(artistId: string): Promise<void>;
    openSource(url: string): Promise<void>;
    onUpdated(listener: (update: ArtistMetadataUpdate) => void): () => void;
  };
  playlists: {
    list(): Promise<Playlist[]>;
    create(name: string): Promise<Playlist>;
    rename(id: string, name: string): Promise<Playlist>;
    delete(id: string): Promise<void>;
    addTracks(playlistId: string, trackIds: string[]): Promise<Playlist>;
    removeEntry(playlistId: string, entryId: string): Promise<Playlist>;
    reorderEntries(playlistId: string, entryIds: string[]): Promise<Playlist>;
  };
  settings: {
    get(): Promise<Settings>;
    save(value: Partial<Settings>): Promise<Settings>;
  };
}
```

Callback progress chỉ nhận domain value, không nhận Electron event object. Main kiểm tra sender origin, kiểu dữ liệu, giới hạn chuỗi/danh sách và format ID.

`LyricsGateway` cung cấp `getLyrics(trackId)` và `findTracksWithLyrics(trackIds)`. Backend chỉ đọc file `.lrc` cùng tên với file audio trong music root đã đăng ký; file bị giới hạn ở 1 MiB. `Settings` hiện lưu cả `layoutMode` (`inset` hoặc `classic`), `hiddenSongColumns` và `songColumnOrder`; Main xác thực các giá trị này trước khi lưu.

## PlaybackEngine

```ts
interface PlaybackEngine {
  load(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(positionSeconds: number): void;
  setVolume(volume: number): void;
  setMute(isMuted: boolean): void;
  dispose(): void;

  readonly stateChange$: Observable<PlaybackStateEvent>;
  readonly timeUpdate$: Observable<PlaybackTimeEvent>;
  readonly volumeChange$: Observable<PlaybackVolumeEvent>;
}
```

Desktop implementation sở hữu một `HTMLAudioElement`. Source luôn là `music://track/<trackId>`. Khi load mới thay load đang chờ, promise cũ bị reject để `PlayerService` không áp dụng kết quả lỗi thời.

## Quy ước dữ liệu

| Field | Đơn vị/giá trị |
| --- | --- |
| `duration` | seconds |
| `sampleRate` | Hz |
| `bitrate` | bits per second |
| `bitDepth` | bits |
| `fileSize` | bytes |
| `lastModified` | Unix timestamp milliseconds |
| `artwork` | `music://artwork/<sha256>` hoặc `null` |
| `isAvailable` | `false` khi file không còn thuộc root đã đăng ký hoặc bị mất |
| metadata chưa biết | `null`, không dùng `0` để giả định |

`Track.path` và `MusicFolder.path` được trả về để hiển thị. Chúng không phải capability và không được gửi lại cho IPC/protocol để đọc file.

## Identity và reconciliation

- Folder và Track ID có prefix cùng SHA-256 của normalized path key.
- Windows path key không phân biệt hoa thường; display path vẫn giữ canonical casing.
- Playlist entry có ID riêng nên một track có thể xuất hiện nhiều lần.
- Rescan dùng `fileSize + lastModified` để tránh đọc lại metadata không đổi.
- Chỉ scan root thành công mới xóa association không còn thấy.
- Track không còn thuộc root nào giữ identity với `isAvailable: false`, nên playlist entry không bị mất.

## Security boundary

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Production chỉ tin `app://lutsra`; development cho phép `http://localhost:4200`.
- Navigation, popup và permission không sử dụng bị chặn.
- `music://` chỉ nhận GET/HEAD và ID đúng format.
- Main resolve ID qua SQLite, canonicalize file và xác nhận file nằm trong một music root trước khi stream.
- URL không chứa filesystem path; raw `ipcRenderer`, `fs`, `shell` và `process` không được expose.

## SQLite schema V1

Các bảng hiện có:

- `schema_migrations`
- `music_folders`
- `directories`
- `artworks`
- `tracks`
- `folder_tracks`
- `playlists`
- `playlist_entries`
- `settings`
- `scan_runs`
- `artist_metadata`

Database bật foreign keys và WAL. Migration chạy trong transaction; lỗi sẽ rollback. Artwork binary nằm ngoài SQLite và được tham chiếu bằng content hash.

## Phần cần nghiệm thu thủ công

- Native picker trên Windows với nhiều root và root chồng lấn.
- Playback, seek và Range request với MP3/FLAC/WAV cùng các codec Chromium hỗ trợ.
- Minimize playback, chuyển route và restart app.
- UI tại `1280 × 800` và `900 × 600`.
- Unicode, ký tự `#`, `%`, khoảng trắng, đường dẫn dài, file lock và permission denied trên library thật.
