# Lutsra

Lutsra là ứng dụng nghe nhạc offline trên desktop, ưu tiên Windows. Dự án dùng Angular và TypeScript xuyên suốt, tập trung vào kiến trúc dễ hiểu, dễ bảo trì và đủ linh hoạt để thay playback engine trong tương lai.

V1 quản lý thư mục nhạc trên máy, đọc metadata, duyệt thư viện theo Songs/Albums/Artists/Folders, quản lý playlist và playback queue, đồng thời phát audio bằng Chromium. Các tính năng audio native chuyên sâu không nằm trong phạm vi V1.

**Phiên bản hiện tại: 0.2.0 (desktop Windows).** Checkpoint này chốt các cải tiến giao diện và trải nghiệm nghe nhạc trên desktop dưới tên Lutsra. Android được phát triển sau checkpoint này, với mục tiêu phiên bản 0.3.0; ứng dụng Android chưa nằm trong bản 0.2.0.
## Trạng thái hiện tại

Phase 1 UI/UX, Phase 2 desktop integration và Phase 3 UI foundation đã hoàn thành. Các chức năng V1 đã được nghiệm thu thủ công trên Windows:

- Browser mode dùng mock gateways để phát triển UI độc lập.
- Electron mode dùng preload API, IPC handlers, filesystem scanner, `music-metadata`, SQLite và artwork cache.
- Playback thật dùng một `HTMLAudioElement` qua `HtmlAudioPlaybackEngine` và URL dạng `music://track/<trackId>`.
- Music folders, library, playlists và settings được lưu tại Electron `userData`.
- Scanner đọc recursive MP3, FLAC, WAV, M4A/AAC, OGG và Opus; file lỗi không làm dừng toàn bộ scan.
- Timeline hỗ trợ click, pointer drag và bàn phím; protocol audio hỗ trợ byte-range để seek file lớn.
- Queue album được chuẩn hóa theo disc number và track number, không phụ thuộc thứ tự metadata trả về.
- Phase 3 bổ sung semantic design tokens; giao diện hiện có 2 theme Dark/Light, 6 accent color và bộ icon SVG tập trung qua `IconComponent`.
- Phase 3.2 bổ sung real-time spectrum visualizer trên Now Playing, lấy dữ liệu FFT từ chính `HTMLAudioElement` qua Web Audio API.
- Phase 3.3–3.5 bổ sung Track Properties, app header tích hợp, global search, Media Session cho phím media, metadata nghệ sĩ online và cấu trúc component TS/HTML/SCSS tách biệt.
- Checkpoint desktop 0.2.0 đạt 184 Angular tests, 34 backend tests, production build, Electron smoke test và bản Windows unpacked.

Nghiệm thu thủ công cơ bản trên Windows đã hoàn thành cho folder picker, scan library, playback, seek và chuyển bài. Dự án đã có cấu hình tạo NSIS installer và bản portable Windows nhưng chưa có app icon chính thức, code signing hoặc bản phát hành công khai. Kiểm thử mở rộng với library lớn, nhiều codec/container và các trường hợp filesystem bất thường tiếp tục được thực hiện khi cần.

Giao diện hiện tại là nền tảng ổn định để sử dụng và tiếp tục tinh chỉnh. Phase 3.1 tập trung vào visual refinement dựa trên các ứng dụng desktop music player tham khảo; phase này không thay đổi playback, IPC, database hoặc scanner.

## Chức năng V1

| Nhóm | Chức năng |
| --- | --- |
| Music folders | Chọn nhiều thư mục bằng native picker, scan recursive, xóa root khỏi library mà không xóa file |
| Metadata | Title, artist, album artist, album, genre, year, track/disc number, duration, codec, bitrate, sample rate, bit depth, channels và embedded artwork |
| Library | Browse Songs, Albums, Artists và cấu trúc filesystem trong Folders |
| Playback | Play, pause/resume, previous/next, seek, volume/mute, repeat off/one/all và shuffle |
| Queue | Queue độc lập thứ tự library, hỗ trợ chuyển bài, xóa và clear |
| Playlists | Tạo, đổi tên, xóa, thêm/xóa/sắp xếp entry; cho phép cùng track xuất hiện nhiều lần |
| Persistence | SQLite lưu folder, track, directory snapshot, playlist, settings và scan run |
| Desktop UX | Bottom player, Now Playing, scan progress, loading/empty/error states và tiếp tục phát khi minimize |

Định dạng scanner ưu tiên: **MP3, FLAC, WAV, M4A/AAC, OGG và Opus**. Việc đọc được metadata không đảm bảo Chromium phát được mọi codec/container. File không được Chromium hỗ trợ sẽ tạo playback error; V1 không transcoding.

### Chất lượng audio

UI chỉ hiển thị metadata của **file nguồn**, ví dụ:

```text
FLAC • 24-bit • 96 kHz • 2840 kbps
```

Trường không đọc được giữ `null` và không hiển thị giá trị giả. Thông tin này không xác nhận output thực tế tới DAC, sample rate của thiết bị hoặc bit-perfect.

## Stack

- Angular 21, standalone components, Angular Router, Signals, RxJS và SCSS.
- Theme state dùng Angular Signals, lưu qua settings gateway và áp dụng bằng semantic CSS custom properties.
- `IconComponent` cung cấp whitelist icon thống nhất để feature components không nhúng SVG riêng lẻ.
- TypeScript 5.9 ở frontend, preload và Electron Main Process.
- Electron 44.4.x với `nodeIntegration: false`, `contextIsolation: true` và `sandbox: true`.
- Node APIs trong Main Process; renderer không truy cập trực tiếp filesystem hoặc raw IPC.
- `music-metadata` để đọc tag và format information.
- `node:sqlite` để persistence, không dùng database server hoặc native addon ngoài Electron.
- `HTMLAudioElement`/Chromium audio cho playback V1.
- Jasmine/Karma cho Angular và `node:test` cho backend.

## Kiến trúc

```text
Angular components
  ├─ Angular services
  │    └─ gateway interfaces
  │         ├─ mock adapters                 (browser mode)
  │         └─ Electron adapters             (desktop mode)
  │              └─ window.desktop
  │                   └─ preload/contextBridge
  │                        └─ ipcMain handlers
  │                             ├─ DatabaseService → SQLite
  │                             ├─ ScannerService → filesystem
  │                             ├─ ArtworkService → artwork cache
  │                             └─ music-metadata
  └─ PlayerService
       └─ PlaybackEngine
            ├─ MockPlaybackEngine            (browser mode)
            └─ HtmlAudioPlaybackEngine       (desktop mode)
                 └─ music://track/<trackId>
```

Preload chỉ expose các hàm cụ thể. Renderer không nhận `ipcRenderer`, `fs`, `shell` hoặc `process`. Native picker đăng ký canonical folder ngay trong Main Process; scan chỉ nhận folder ID đã đăng ký. Protocol audio nhận track ID, resolve đường dẫn qua database và kiểm tra file vẫn nằm trong music root trước khi stream.

Hai custom protocol được đăng ký trước `app.ready`:

- `app://lutsra/` phục vụ Angular production build và fallback Router.
- `music://track/<trackId>` và `music://artwork/<hash>` phục vụ audio/artwork đã được cấp quyền.

## Cấu trúc thư mục

```text
src/app/
  core/
    contracts/       # Gateway và PlaybackEngine contracts
    desktop/         # Electron adapters và HTMLAudio playback engine
    mock/            # Browser mock adapters, fixtures và scenarios
    models/          # Domain models
    player/          # PlayerService và queue state
    theme/           # ThemeService và theme persistence
  features/          # Home, Songs, Albums, Artists, Folders, Playlists...
  shared/            # Sidebar, player bar, queue drawer, icon, spectrum visualizer và pipes

electron/
  main.ts            # App lifecycle và BrowserWindow
  preload.cts        # Whitelist API qua contextBridge
  ipc/               # IPC validation và handlers
  protocols/         # app:// và music://
  services/          # Database, scanner và artwork cache
  tests/             # Backend integration tests
  utils/             # Path, stable ID và logging

docs/                # Contracts và tài liệu tích hợp
scripts/             # Electron launcher và bundle compatibility fix
```

## Cài đặt và chạy

Cài đúng dependency theo lockfile:

```bash
npm ci
```

Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` trong các lệnh dưới đây.

### Browser development với mock data

```bash
npm start
```

Mở `http://localhost:4200`. Chế độ này không đọc filesystem thật và không persistence.

### Electron development

```bash
npm run dev
```

Script chạy Angular dev server, build Electron Main/preload, chờ cổng `4200` rồi mở Electron.

### Production build và chạy Electron

```bash
npm run build
npm run electron
```

Angular output nằm tại `dist/lutsra/`; Main và preload nằm tại `dist-electron/`. `npm run electron` build lại trước khi mở app và chưa tạo installer.

### Đóng gói bản demo Windows

Yêu cầu Node.js 22 trở lên, npm và Windows x64. Cài dependencies theo lockfile rồi tạo đồng thời installer và bản portable:

```powershell
npm ci
npm run package:win
```

Artifact được tạo trong `release/`:

- `Lutsra-Setup-0.2.0-x64.exe`: installer theo user, có shortcut Desktop/Start Menu và cho phép chọn thư mục cài đặt.
- `Lutsra-Portable-0.2.0-x64.exe`: chạy trực tiếp, không cần cài đặt.

Để tạo bản unpacked phục vụ kiểm tra nhanh mà không sinh installer:

```powershell
npm run package:win:dir
```

Bản demo hiện chưa ký số nên Windows có thể hiển thị cảnh báo SmartScreen hoặc `Unknown publisher`. Icon đóng gói hiện dùng icon mặc định của Electron; cần thay bằng file `.ico` đa kích thước, tối đa ít nhất 256×256, trước khi phát hành chính thức.

Database và artwork vẫn nằm trong thư mục `userData` của Windows, tách khỏi thư mục cài đặt. Gỡ ứng dụng không xóa dữ liệu này.

### Kiểm thử

```bash
npm test -- --watch=false --browsers=ChromeHeadless
npm run test:electron
npm run smoke:electron
```

Trên Windows có thể dùng Edge làm binary cho Karma:

```powershell
$env:CHROME_BIN = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm.cmd test -- --watch=false --browsers=ChromeHeadless
```

`test:electron` tạo WAV và SQLite trong thư mục tạm để kiểm tra scan, stable identity, reconciliation, playlist và settings persistence. `smoke:electron` chạy production app ẩn với một Electron profile tạm riêng để xác minh `app://`, preload và IPC `ping → pong`; dữ liệu ứng dụng thật trong `userData` không bị sử dụng.

Trên Windows, launcher sở hữu vòng đời của profile smoke test và chỉ dọn thư mục này sau khi tiến trình Electron đã thoát hoàn toàn. Việc dọn dẹp có retry ngắn để chờ Chromium giải phóng file, tránh lỗi `EPERM: Permission denied` khi kết thúc smoke test.

## Persistence và scanning

Database mặc định ở `app.getPath('userData')/lutsra.sqlite`; artwork nằm trong `userData/artwork-cache`. Audio binary không được lưu trong database.

Lần mở đầu tiên sau khi đổi tên, ứng dụng sao chép thư viện, playlist, settings và artwork từ profile Audio Lutstra hoặc Audio BlaBla gần đây nhất sang profile Lutsra. Profile cũ được giữ nguyên. Bản sao chỉ được tạo nếu database Lutsra chưa tồn tại; nếu chuyển dữ liệu thất bại, ứng dụng dừng khởi động để tránh mở một thư viện trống ngoài ý muốn.

Track ID là SHA-256 của normalized canonical path. Trên Windows identity không phân biệt hoa thường. Scanner dùng `fileSize + lastModified` để bỏ qua metadata không đổi, giới hạn metadata concurrency ở 4 và ghi tối đa 100 tracks mỗi batch. Scan thành công mới reconcile file mất; root lỗi không xóa snapshot library cũ.

Artwork chỉ nhận JPEG, PNG hoặc WebP tối đa 10 MiB. Nội dung được hash để deduplicate và Track chỉ giữ URL protocol, không giữ base64 lặp lại.

## Giới hạn V1

Bit-perfect, WASAPI Exclusive, ASIO, điều khiển USB DAC, tự đổi sample rate thiết bị, DSD/DoP, FFmpeg native, custom audio driver, EQ, ReplayGain, crossfade và DSP nằm ngoài V1.

Dự án chưa có Android, account, cloud sync, remote backend hoặc lyrics online. `PlaybackEngine` tạo ranh giới để có thể nghiên cứu native engine sau này mà không buộc UI đổi theo.

## Tài liệu liên quan

- [Desktop integration contracts](docs/PHASE1_INTEGRATION_CONTRACTS.md)
- [Phase 3.1 visual refinement](docs/PHASE3_1_VISUAL_REFINEMENT.md)
- [Gateway interfaces](src/app/core/contracts/)
- [Desktop API](src/app/core/desktop/desktop-api.ts)
- [Scripts và dependencies](package.json)
