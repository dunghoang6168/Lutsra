# Kế hoạch tối ưu Lutsra (sau 0.2.2)

> Lập ngày 03/10/2026, dựa trên bản đánh giá code của workspace 0.2.2.
> Mục tiêu: app vẫn mượt với thư viện **20.000 bài**, code dễ bảo trì hơn và có lưới test tối thiểu trước khi làm Android 0.3.0.

## Nguyên tắc thực hiện

- Mỗi task là **một commit hoặc một PR riêng**, để lỗi có thể revert độc lập.
- **Đo trước, tối ưu sau.** Task 0.3 tạo số liệu nền; mọi task hiệu năng phải ghi lại số liệu trước và sau.
- Không đổi hành vi người dùng nhìn thấy, trừ các lỗi được ghi rõ là bug.
- Làm theo đúng thứ tự giai đoạn. Trong cùng một giai đoạn có thể đổi thứ tự task nếu không có phụ thuộc.

## Tổng quan

| Giai đoạn | Mục tiêu | Ước lượng | Kết quả mong đợi |
|---|---|---|---|
| 0. Ổn định nền | Không mất code, có số đo nền | 0,5–1 ngày | Working tree sạch, có benchmark |
| 1. Sửa nhanh database | Bỏ các truy vấn chậm hiển nhiên | 1–2 ngày | `getLibrary()` nhanh hơn rõ rệt |
| 2. Hiệu năng renderer | Hết tải lại thư viện, cuộn mượt | 4–6 ngày | Chuyển trang tức thì, Songs 20k bài vẫn 60fps |
| 3. Tái cấu trúc | Code dễ đọc, dễ sửa | 5–8 ngày | Không còn file "god class" hay code viết dồn |
| 4. Chất lượng lâu dài | Lưới an toàn cho thay đổi sau này | 3–4 ngày | Lint, test, CI chạy mỗi lần push |

Tổng cộng khoảng **3–4 tuần** nếu làm bán thời gian.

---

## Giai đoạn 0: Ổn định nền

### 0.1 Commit toàn bộ thay đổi đang dở
- **Vấn đề:** 97 file đã sửa (+5.114/−883) cùng nhiều file mới quan trọng (audio host, native engine…) chưa được commit.
- **Việc làm:** tách thành các commit theo tính năng: native audio host, Electron audio-host service, playback engine, UI Now Playing/waveform, settings/layout.
- **Xong khi:** `git status` sạch; `npm run build` và `npm run build:audio-host` chạy thành công.

### 0.2 Dọn `.gitignore` và line ending
- Thêm vào `.gitignore`:
  ```
  /native/audio-host/lutsra-a.*/
  /.codex-staging/
  *.obj
  *.pdb
  *.tlog
  ```
- Bỏ dòng `*.spec.ts` và `*.test.ts` để chuẩn bị cho giai đoạn 4.
- Tạo `.gitattributes` gồm `* text=auto eol=lf` và `*.cpp text eol=crlf` nếu Visual Studio cần, rồi chạy `git add --renormalize .` trong một commit riêng.
- **Xong khi:** không còn cảnh báo LF/CRLF và không còn file build trong danh sách untracked.

### 0.3 Benchmark nền
- Viết `scripts/bench-library.mjs` sinh database giả gồm 20.000 track, 1.500 album, 800 nghệ sĩ và 20 playlist × 200 bài, rồi đo:
  - thời gian `DatabaseService.getLibrary()`
  - kích thước snapshot sau khi serialize (JSON.stringify)
  - thời gian `listPlaylists()` và `finishScan()`
- Ở renderer, đo bằng DevTools Performance: thời gian mở trang Songs và độ mượt khi cuộn.
- Ghi kết quả vào bảng "Số liệu" ở cuối file này.
- **Xong khi:** có số liệu nền để so sánh.

---

## Giai đoạn 1: Sửa nhanh database (main process)

### 1.1 Thêm index và đổi `NOT IN` thành `NOT EXISTS`
- **File:** [electron/services/database.service.ts](../electron/services/database.service.ts)
- Thêm vào migration:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_folder_tracks_track ON folder_tracks(track_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_entries_playlist ON playlist_entries(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_directories_folder ON directories(folder_id);
  ```
- Thay hai chỗ `UPDATE tracks SET is_available=0 WHERE id NOT IN (SELECT track_id FROM folder_tracks)` (trong `removeFolder` và `finishScan`) bằng:
  ```sql
  UPDATE tracks SET is_available=0
  WHERE is_available=1 AND NOT EXISTS (SELECT 1 FROM folder_tracks ft WHERE ft.track_id = tracks.id)
  ```
- **Xong khi:** `EXPLAIN QUERY PLAN` cho thấy truy vấn dùng index; benchmark `finishScan` nhanh hơn.

### 1.2 Bỏ truy vấn N+1 trong `getLibrary()`
- Đọc toàn bộ `artist_metadata` bằng một câu `SELECT` vào `Map<artistId, StoredArtistMetadata>` trước vòng lặp, thay cho việc gọi `getArtistMetadata()` cho từng nghệ sĩ.
- Đổi `album.trackIds` và `artist.albumIds.includes(...)` sang dùng `Set` trong lúc dựng, rồi chuyển về mảng khi trả kết quả.

### 1.3 Không dựng lại thư viện chỉ để tìm một nghệ sĩ
- **File:** [electron/services/artist-metadata.service.ts](../electron/services/artist-metadata.service.ts)
- Thêm `DatabaseService.getArtistById(id)` (hoặc `listArtists()` nhẹ, chỉ gồm id và name, lấy từ `tracks` bằng `GROUP BY`).
- `requireArtist()` và `refreshMissingInternal()` chuyển sang dùng hàm mới. `refreshMissingInternal` chỉ đọc danh sách nghệ sĩ một lần.
- **Xong khi:** "Refresh missing" với 800 nghệ sĩ không còn gọi `getLibrary()` lần nào.

### 1.4 Tối ưu playlist
- `listPlaylists()`: gom entry theo `playlist_id` vào `Map` một lần, bỏ `filter` lồng trong vòng lặp.
- `requirePlaylist(id)`: chỉ truy vấn đúng playlist đó và các entry của nó.
- `addPlaylistTracks()`: `prepare` câu `SELECT 1 FROM tracks WHERE id=?` **một lần** bên ngoài vòng lặp.

### 1.5 Các sửa nhỏ
- `USER_AGENT` lấy từ `app.getVersion()` (truyền vào qua constructor để vẫn test được).
- `before-quit`: gọi `event.preventDefault()`, `await audioHost.stop()` (giới hạn thời gian khoảng 1,5 giây), đóng database rồi mới `app.exit()`.
- `AudioHostService.request()`: bọc `writeFrame` trong try/catch; nếu lỗi thì xóa `pending` và `clearTimeout` ngay.
- `downloadImage()`: đọc stream theo từng chunk, dừng ngay khi vượt 8MB, không dùng `arrayBuffer()` cho cả body.

**Xong giai đoạn 1 khi:** benchmark `getLibrary()` với 20k bài nhanh hơn ít nhất 2 lần so với số nền; app chạy bình thường trên thư viện thật.

---

## Giai đoạn 2: Hiệu năng renderer

### 2.1 `LibraryStore`, nguồn dữ liệu duy nhất ở renderer *(quan trọng nhất)*
- **File mới:** `src/app/core/library/library.store.ts`
  ```ts
  @Injectable({ providedIn: 'root' })
  export class LibraryStore {
    private readonly gateway = inject(LIBRARY_GATEWAY);
    readonly snapshot = signal<LibrarySnapshot | null>(null);
    readonly tracks = computed(() => this.snapshot()?.tracks ?? []);
    readonly albums = computed(() => this.snapshot()?.albums ?? []);
    readonly artists = computed(() => this.snapshot()?.artists ?? []);
    readonly folders = computed(() => this.snapshot()?.folders ?? []);
    readonly trackById = computed(() => new Map(this.tracks().map((t) => [t.id, t])));
    readonly albumById = computed(() => new Map(this.albums().map((a) => [a.id, a])));
    readonly artistById = computed(() => new Map(this.artists().map((a) => [a.id, a])));
    readonly error = signal<string | null>(null);
    private loading: Promise<void> | null = null;

    constructor() {
      this.gateway.libraryChanged$?.subscribe(() => void this.reload());
    }
    ensureLoaded(): Promise<void> { return this.snapshot() ? Promise.resolve() : this.reload(); }
    reload(): Promise<void> {
      return this.loading ??= this.gateway.getLibrary()
        .then((s) => { this.snapshot.set(s); this.error.set(null); })
        .catch((e) => this.error.set(e?.message ?? 'Failed to load library'))
        .finally(() => { this.loading = null; });
    }
  }
  ```
- **Chuyển 14 chỗ đang gọi `getLibrary()`** sang store. Danh sách:
  - `app.component.ts`
  - `player.service.ts` (2 chỗ: `reconcileLibrary` và `refreshArtwork` gộp thành một hàm đọc từ store)
  - Albums, Album detail, Artists, Artist detail (2 chỗ), Folders, Home, Playlists, Playlist detail, Settings, Songs, Global search
- Bỏ các subscription `scanProgress$` tự reload riêng trong từng component; store đã lắng nghe `libraryChanged$`.
- Artist metadata cập nhật (`artist-metadata:updated`) sẽ patch trực tiếp vào snapshot trong store, không reload cả thư viện.
- **Xong khi:** chuyển giữa các trang không còn phát sinh IPC `library:get-snapshot` (kiểm tra bằng log trong main process).

### 2.2 Cache snapshot ở main process
- `DatabaseService` giữ `cachedLibrary` và xóa cache khi: `upsertTracks`, `finishScan`, `finishScopedScan`, `removeFolder`, `addFolder`, `saveArtistMetadata`, `setCustomArtistAvatar`, `updateTrackArtwork`.
- **Xong khi:** gọi `getLibrary()` lần thứ hai khi dữ liệu không đổi mất dưới 1ms.

### 2.3 Virtual scroll
- Cài `@angular/cdk` đúng phiên bản Angular 21.
- Áp dụng `cdk-virtual-scroll-viewport` cho:
  1. Songs ([songs.component.html](../src/app/features/songs/songs.component.html)): bảng chuyển sang layout CSS grid với chiều cao dòng cố định
  2. Ô chọn bài trong Playlist detail (`allLibraryTracks`)
  3. Danh sách file trong Folders
  4. Queue drawer
- Lưu ý: giữ đúng `aria-rowindex` và khả năng điều hướng bằng bàn phím; header bảng giữ dạng sticky.
- **Xong khi:** Songs với 20k bài có DOM dưới 100 dòng; cuộn đạt 60fps trên DevTools.

### 2.4 OnPush cho mọi component, sau đó chuyển zoneless
- Bước 1: thêm `changeDetection: ChangeDetectionStrategy.OnPush` cho tất cả component còn thiếu. Kiểm tra từng trang để chắc chắn không còn chỗ thay đổi state ngoài signal.
- Bước 2: thay `provideZoneChangeDetection` bằng `provideZonelessChangeDetection()`, bỏ `zone.js` khỏi polyfills. Các chỗ dùng `NgZone.runOutsideAngular` (visualizer, waveform) vẫn giữ được.
- **Xong khi:** app chạy đầy đủ mà không cần zone.js; số lần change detection mỗi giây khi đang phát nhạc giảm (đo bằng Angular DevTools Profiler).

### 2.5 Lọc và sắp xếp Songs
- Tạo `computed` `searchIndex` để tính trước chuỗi chữ thường đã bỏ dấu (`title + artist + album`) cho mỗi track.
- `searchQuery` chỉ được áp dụng sau khi người dùng ngừng gõ khoảng 150ms (signal trung gian cập nhật qua `setTimeout`).
- Tách bước *lọc* và bước *sắp xếp* thành hai `computed`, để đổi sort không phải lọc lại và ngược lại.
- Gợi ý thêm: tìm kiếm không phân biệt dấu tiếng Việt (gõ "Son Tung" vẫn tìm ra "Sơn Tùng").

### 2.6 Lyrics: tính sẵn trong lúc scan
- Thêm cột `has_lyrics INTEGER` vào bảng `tracks` (kèm migration). Scanner ghi lại các file `.lrc` gặp được khi `walk` (tương tự cách xử lý cover).
- `Track` có thêm field `hasLyrics`; bỏ IPC `library:find-tracks-with-lyrics` cùng effect gọi theo batch 500 trong Songs.
- **Xong khi:** mở Songs không còn phát sinh truy cập filesystem.

### 2.7 Scanner ghi theo lô
- Trong `readMetadata`, mỗi khi đủ 200 track thì gọi `upsertTracks` ngay, không đợi đến cuối.
- `walk` bỏ đệ quy, dùng stack, để tránh call stack sâu với cây thư mục lớn.
- **Xong khi:** scan 20k bài dùng ít RAM hơn (đo `process.memoryUsage()`); nếu kill app giữa chừng thì phần đã scan vẫn còn.

---

## Giai đoạn 3: Tái cấu trúc

### 3.1 Tách `PlayerService` (1.166 dòng)
Chia thành các service, tất cả `providedIn: 'root'`:

| Service mới | Phụ trách | Tách từ đoạn code nào |
|---|---|---|
| `QueueStore` | `queue`, `currentIndex`, `originalQueue`, shuffle, thêm/xóa/kéo thả, `failedEntryIds` | `playCollection`, `playNext`, `addToQueue`, `removeFromQueue`, `moveQueueEntry`, `toggleShuffle`, `createQueueEntry`, `shuffleArray` |
| `OutputDeviceService` | danh sách thiết bị, preferred output, fallback, chuyển backend, `migrateNativeDeviceByUniqueName`, xử lý thiết bị thay đổi | `refreshAudioOutputState`, `selectAudioOutput`, `switchAudioBackend`, `recoverFromNativeHostFailure`, `handleOutputDevicesChanged` |
| `CrossfadeController` | chuẩn bị bài tiếp theo, `maybeStartCrossfade`, `advanceAfterEnded` | `refreshPreparedCandidate`, `automaticNextIndex`, `automaticCandidate` |
| `PlayerSettingsSync` | khôi phục và lưu settings (debounce) | `loadSavedSettings`, `persistSettings`, `volumeSaveTimer` |
| `PlayerService` (còn lại) | điều phối transport: play/pause/next/prev/seek, xử lý lỗi, suspend/resume | — |

- Giữ nguyên API public của `PlayerService`; các component không phải sửa. Nếu cần, `PlayerService` re-export các signal từ service con.
- **Sửa bug đi kèm:** `moveQueueEntry` khi đang shuffle chỉ đổi thứ tự `queue`, không ghi đè `originalQueue`.
- **Sửa log:** khi `persistSettings` lỗi thì ghi `operation: 'settings'`.
- **Xong khi:** không file nào trong `core/player/` dài quá 400 dòng; các test ở mục 4.2 đều pass.

### 3.2 Gom chuẩn hóa settings về một chỗ
- Tạo `normalizeSettings(input: unknown, current: Settings): Settings` trong `src/app/core/models/settings.model.ts`, kèm hằng `DEFAULT_SETTINGS`.
- `DatabaseService.getSettings()` gọi `normalizeSettings(parsed, DEFAULT_SETTINGS)`; `saveSettings()` gọi `normalizeSettings(partial, current)`.
- `settings-validation.ts` chỉ còn nhiệm vụ *từ chối* dữ liệu sai kiểu (IPC cần báo lỗi), dùng chung các hàm `isXxx` có sẵn.
- Gom chuỗi `'System Default'` thành hằng `SYSTEM_DEFAULT_OUTPUT_NAME`.

### 3.3 Dọn `database.service.ts`
- Định dạng lại để mỗi câu lệnh nằm trên một dòng (bằng Prettier ở mục 4.1, rồi sửa tay những chỗ còn lại).
- Tách theo repository, dùng chung một kết nối `DatabaseSync`:
  - `TrackRepository` (tracks, folder_tracks, directories, scan_runs)
  - `PlaylistRepository`
  - `SettingsRepository`
  - `ArtistMetadataRepository`
  - `LibraryQuery`: dựng snapshot và cache (task 2.2)
- **Migration có phiên bản thật:**
  ```ts
  const MIGRATIONS: Array<{ version: number; up(db: DatabaseSync): void }> = [
    { version: 1, up: (db) => db.exec(`CREATE TABLE ...`) },
    // ...
    { version: 5, up: (db) => db.exec(`CREATE INDEX ...`) },
    { version: 6, up: (db) => db.exec(`ALTER TABLE tracks ADD COLUMN has_lyrics INTEGER`) },
  ];
  ```
  Mỗi bước chạy trong transaction, chỉ khi `version > MAX(version)` đã ghi nhận. Các bước 1–4 hiện có phải giữ hành vi idempotent để database của người dùng cũ vẫn nâng cấp được.

### 3.4 Dọn IPC
- Đổi `registerIpc(...)` (9 tham số) thành `registerIpc(context: IpcContext)`.
- Tạo `const handle = createHandler(development)` để không phải truyền `development` vào từng lời gọi.
- Cân nhắc gom tên channel thành hằng `IPC_CHANNELS` dùng chung cho `preload.cts` và `register-ipc.ts`, để tránh gõ sai tên.

### 3.5 Native audio host (C++)
- Thêm `.clang-format` (dựa trên style LLVM, `ColumnLimit: 120`) rồi format toàn bộ `native/audio-host/*.cpp|h`.
- Thay các hàm `stringField`, `numberField`, `boolField` bằng **nlohmann/json** (một file header, đặt trong `native/audio-host/vendor/`), và parse envelope một lần cho mỗi frame.
- Tách `main.cpp` thành `pipe_transport.cpp` (đọc/ghi frame, writer thread), `protocol.cpp` (điều phối lệnh) và `main.cpp` (chỉ xử lý tham số và khởi động).
- **Xong khi:** `npm run test:audio-host`, `test:audio-host:smoke` và `test:audio-host:codecs` đều pass; giao thức không thay đổi.

---

## Giai đoạn 4: Chất lượng lâu dài

### 4.1 Lint và format
- Cài `angular-eslint` và `typescript-eslint`, kèm các rule chính:
  - `@typescript-eslint/no-floating-promises`: bắt các chỗ gọi `loadAndPlayCurrent()` mà không có `void` hoặc `await`
  - `@typescript-eslint/no-explicit-any`: hiện có 24 chỗ `any`
  - `@angular-eslint/prefer-on-push-component-change-detection`
- Cài Prettier (`printWidth: 140`, `singleQuote: true`). Format toàn bộ trong **một commit riêng** để dễ `git blame --ignore-rev`.
- Thêm script `npm run lint` và `npm run format`.

### 4.2 Khôi phục test có trọng tâm
Không khôi phục toàn bộ 7.400 dòng đã xóa. Chỉ viết lại phần có giá trị cao, dùng **Vitest** cho nhanh:

| Nhóm | Nội dung test |
|---|---|
| Electron, logic thuần | `parseByteRange` (`file-response`), `ipc-validation`, `settings-validation`, `path-utils` (`isPathInside` trên Windows) |
| Database | Chạy SQLite `:memory:`: migration từ database cũ (v4), `finishScan`/`finishScopedScan` prune đúng, playlist add/remove/reorder, `normalizeSettings` |
| Player | `QueueStore` (shuffle bật/tắt, kéo thả khi đang shuffle), `playback-policy`, `crossfade-gains`, `PlayerService` với `MockPlaybackEngine` (bài lỗi được bỏ qua, repeat one/all) |
| Renderer | `LibraryStore` (gộp các request đồng thời, reload khi `libraryChanged$`) |

- Thêm `npm test` để chạy tất cả.
- **Xong khi:** độ bao phủ (coverage) của `core/player` và `electron/services` đạt ≥ 60%.

### 4.3 CI
- GitHub Actions trên `windows-latest`: `npm ci`, sau đó `npm run lint`, `npm test`, `npm run build`.
- Đặt build native audio host thành job riêng, có thể chạy thủ công (`workflow_dispatch`) vì cần FFmpeg.

### 4.4 Cập nhật tài liệu
- README: sửa phần số lượng test, mô tả Native Shared (Beta), cập nhật cấu trúc thư mục mới (`core/library`, các service tách từ player).
- Ghi lại kiến trúc IPC và giao thức audio host vào `docs/`.

---

## Rủi ro và cách giảm thiểu

| Rủi ro | Cách giảm thiểu |
|---|---|
| Migration làm hỏng database của người dùng hiện tại | Sao lưu `lutsra.sqlite` thành `.bak` trước khi chạy migration mới; viết test migration từ database v4 thật |
| Tách PlayerService làm sai lệch logic phát nhạc (race, crossfade) | Viết test ở mục 4.2 **trước** khi tách (theo kiểu characterization test); tách từng service một |
| Virtual scroll làm hỏng accessibility hoặc thao tác bàn phím | Kiểm tra thủ công với Tab/Arrow và trình đọc màn hình (Narrator) |
| Zoneless làm UI không cập nhật ở một số chỗ | Làm OnPush trước (bước 2.4.1); chỉ bật zoneless khi mọi trang đã ổn |
| Format toàn bộ code gây conflict | Format sau khi đã commit hết thay đổi (giai đoạn 0) và trước khi bắt đầu tái cấu trúc lớn |

## Thứ tự đề xuất trong thực tế

```
0.1 → 0.2 → 0.3 → 1.1 → 1.2 → 1.3 → 1.4 → 1.5
    → 4.1 (lint + format, trước khi refactor)
    → 2.1 → 2.2 → 2.6 → 2.3 → 2.5 → 2.7 → 2.4
    → 4.2 (test cho player và database)
    → 3.2 → 3.3 → 3.1 → 3.4 → 3.5
    → 4.3 → 4.4
```

## Số liệu (điền dần trong quá trình làm)

| Chỉ số (thư viện 20k bài) | Nền (0.3) | Sau GĐ 1 | Sau GĐ 2 | Mục tiêu |
|---|---|---|---|---|
| `getLibrary()` ở main (ms) | | | | < 150 (lần đầu), < 1 (khi đã cache) |
| Kích thước snapshot (MB) | | | | — |
| Mở trang Songs (ms) | | | | < 200 |
| Số node DOM ở Songs | | | | < 3.000 |
| FPS khi cuộn Songs | | | | 60 |
| Số IPC `get-snapshot` khi đi qua 5 trang | | | | 0 |
| RAM main process khi scan (MB) | | | | — |
