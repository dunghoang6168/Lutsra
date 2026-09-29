# Lutsra

Lutsra là ứng dụng nghe nhạc offline trên desktop, ưu tiên Windows. Dự án dùng Angular và TypeScript xuyên suốt, tập trung vào kiến trúc dễ hiểu, dễ bảo trì và đủ linh hoạt để thay playback engine trong tương lai.

V1 quản lý thư mục nhạc trên máy, đọc metadata, duyệt thư viện theo Songs/Albums/Artists/Folders, quản lý playlist và playback queue, đồng thời phát audio bằng Chromium. Các tính năng audio native chuyên sâu không nằm trong phạm vi V1.

**Phiên bản hiện tại: 0.2.2 (desktop; Windows là nền tảng đã kiểm thử).** Bản này tiếp tục hoàn thiện trải nghiệm thư viện và Now Playing sau 0.2.1. macOS mới ở giai đoạn chuẩn bị thử bằng `npm run electron`; chưa có bản `.app` hoặc xác nhận chạy thực tế trên Mac. Android được phát triển sau bản desktop này, với mục tiêu phiên bản 0.3.0.

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
- Bản 0.2.2 giữ hai kiểu bố cục Panel/Classic, lyrics `.lrc` và các tùy chỉnh thư viện; bổ sung hướng dẫn thêm thư mục nhạc khi thư viện trống, đồng bộ thư viện sau khi thêm/gỡ/quét, giữ entry playlist của bài đã gỡ với nhãn Unavailable, và lọc playback queue theo thư viện hiện còn.
- Now Playing có lựa chọn Spectrum/Waveform trong Settings, waveform có thể seek và có bộ nhớ đệm; bản Panel có điều khiển âm lượng và chế độ phát ngay trong trang. Các phần này đang được hoàn thiện trong workspace hiện tại.
- Trên workspace 0.2.2 hiện tại, 258 Angular tests và 36 backend tests thành công; production build Angular/Electron thành công trên Windows. Bản Windows unpacked đã được kiểm tra ở checkpoint 0.2.0; bản đóng gói 0.2.2 và macOS chưa được kiểm thử thực tế.

Nghiệm thu thủ công cơ bản trên Windows đã hoàn thành cho folder picker, scan library, playback, seek và chuyển bài. Dự án đã có cấu hình tạo NSIS installer và bản portable Windows nhưng chưa có app icon chính thức, code signing hoặc bản phát hành công khai. Kiểm thử mở rộng với library lớn, nhiều codec/container và các trường hợp filesystem bất thường tiếp tục được thực hiện khi cần.

Giao diện hiện tại là nền tảng để sử dụng và tiếp tục tinh chỉnh. Tài liệu Phase 3.1 ghi lại brief thiết kế ở thời điểm trước; các bổ sung từ 0.2.1 đến 0.2.2 đã mở rộng IPC và dữ liệu lưu trữ.

## Chức năng V1

| Nhóm | Chức năng |
| --- | --- |
| Music folders | Chọn nhiều thư mục bằng native picker, scan recursive, xóa root khỏi library mà không xóa file |
| Metadata | Title, artist, album artist, album, genre, year, track/disc number, duration, codec, bitrate, sample rate, bit depth, channels và embedded artwork |
| Library | Browse Songs, Albums, Artists và cấu trúc filesystem trong Folders; tìm kiếm, lọc và tùy chỉnh cột Songs |
| Playback | Play, pause/resume, previous/next, seek, volume/mute, repeat off/one/all và shuffle |
| Queue | Queue độc lập thứ tự library, hỗ trợ chuyển bài, xóa và clear |
| Playlists | Tạo, đổi tên, xóa, thêm/xóa/sắp xếp entry; cho phép cùng track xuất hiện nhiều lần |
| Persistence | SQLite lưu folder, track, directory snapshot, playlist, settings và scan run |
| Desktop UX | Bố cục Panel/Classic, sidebar có thể thu gọn hoặc ẩn, bottom player, Now Playing với Spectrum/Waveform, lyrics `.lrc` đồng bộ, hướng dẫn thêm nhạc, scan progress, loading/empty/error states và tiếp tục phát khi minimize |

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
    layout/          # Layout preference, navigation và artwork glow
    settings/        # Tùy chọn cột Songs
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

### Cần cài trước

- **Git** để clone mã nguồn.
- **Node.js 22.12+ (nhánh 22) hoặc Node.js 24.x**, kèm **npm**. Dự án đã được chạy với Node.js 22.20.0 và npm 10.9.3. Angular 21 yêu cầu Node.js 22.12+ hoặc 24.x; backend dùng `node:sqlite` nên không chọn nhánh Node 20.

Không cần cài Angular CLI, Electron, TypeScript hay SQLite riêng trên máy. `npm ci` sẽ cài các package theo `package-lock.json` và tải Electron; bước này cần kết nối mạng. Người dùng chạy bản installer/portable đã đóng gói không cần cài Node.js.

Clone repo rồi cài dependency từ thư mục gốc:

```bash
git clone https://github.com/dunghoang6168/Lutsra.git
cd Lutsra
node --version
npm --version
npm ci
```

Sau khi clone, dùng các lệnh dưới đây tùy mục đích. Không cần chạy `npm install` thêm sau `npm ci`.

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

### Thử chạy trên macOS

Trên máy Mac, cài Git và phiên bản Node.js nêu ở phần **Cần cài trước**, rồi clone đúng commit/nhánh muốn kiểm tra. Chạy `npm ci` và `npm run electron` trong thư mục repo. Đây là bước thử ứng dụng từ mã nguồn; chưa có cấu hình đóng gói `.app` và chưa xác nhận giao diện hoặc playback trên macOS. Khi thử, kiểm tra vùng nút cửa sổ góc trái, thao tác kéo header, chọn thư mục nhạc và phát một bài.

### Đóng gói bản demo Windows

Trên Windows x64, dùng phiên bản Node.js và npm nêu ở phần **Cần cài trước**, rồi tạo đồng thời installer và bản portable:

```powershell
npm ci
npm run package:win
```

Artifact được tạo trong `release/`:

- `Lutsra-Setup-0.2.2-x64.exe`: installer theo user, có shortcut Desktop/Start Menu và cho phép chọn thư mục cài đặt.
- `Lutsra-Portable-0.2.2-x64.exe`: chạy trực tiếp, không cần cài đặt.

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
npx tsc -p electron/tsconfig.json --noEmit
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

Lyrics cục bộ được đọc từ file `.lrc` có cùng tên gốc và nằm cạnh file audio. Main Process kiểm tra đường dẫn thuộc music root đã đăng ký, giới hạn file ở 1 MiB và hỗ trợ UTF-8, UTF-16LE, UTF-16BE. Now Playing hỗ trợ dòng có timestamp và thẻ `offset`; có thể bấm dòng lyrics để seek. Không có tìm kiếm hoặc tải lyrics online.

## Giới hạn V1

Bit-perfect, WASAPI Exclusive, ASIO, điều khiển USB DAC, tự đổi sample rate thiết bị, DSD/DoP, FFmpeg native, custom audio driver, EQ, ReplayGain, crossfade và DSP nằm ngoài V1.

Dự án chưa có Android, account, cloud sync, remote backend hoặc lyrics online. `PlaybackEngine` tạo ranh giới để có thể nghiên cứu native engine sau này mà không buộc UI đổi theo.

## Tài liệu liên quan

- [Desktop integration contracts](docs/PHASE1_INTEGRATION_CONTRACTS.md)
- [Phase 3.1 visual refinement](docs/PHASE3_1_VISUAL_REFINEMENT.md)
- [Gateway interfaces](src/app/core/contracts/)
- [Desktop API](src/app/core/desktop/desktop-api.ts)
- [Scripts và dependencies](package.json)
