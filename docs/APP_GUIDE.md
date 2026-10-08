# Hướng dẫn ứng dụng Lutstra

Dành cho người mới vào dự án. Tài liệu này giải thích app được tổ chức thế nào và vì sao: kiến trúc, ba layout, hệ token, các thành phần dùng chung, và quy trình làm việc. Phần cài đặt, chạy app và đóng gói nằm trong [README](../README.md). Quy tắc thiết kế chi tiết ở [DESIGN.md](../DESIGN.md). Bản tóm tắt dạng mệnh lệnh cho AI agent ở [AGENTS.md](../AGENTS.md).

## 1. Lutstra là gì
Trình phát nhạc desktop, local-first, dành cho người nghe quan tâm đến chất lượng file: lossless, Hi-Res, file nào bị thiếu. Nguyên tắc xuyên suốt là **sự thật về file luôn hiển thị**: định dạng, bit depth và sample rate, cùng việc output đang bit-perfect, resample hay đi qua shared mixer của Windows. Các thông tin này xuất hiện ở mọi layout, dưới dạng chữ mono.

Tên sản phẩm là **Lutstra**, tên kỹ thuật dùng `lutstra` (package, `dist/lutstra`, user agent và `lutstra.sqlite`). Giữ origin `app://lutsra`, khóa localStorage `lutsra.*` và IndexedDB `lutsra-waveform` để bảo toàn dữ liệu trình duyệt đã lưu. Migration giữ tên profile và database cũ để tìm dữ liệu nguồn.

## 2. Kiến trúc
Sơ đồ đầy đủ ở mục "Kiến trúc" của README. Bản ngắn:

- **Renderer (Angular 21, standalone, signals):**
  - `src/app/core`: services và contracts
  - `src/app/features`: từng trang
  - `src/app/shared`: component, pipe và util dùng chung
- **Gateway:** mọi truy cập dữ liệu đi qua gateway trong `core/contracts`. `app.config.ts` chọn adapter Electron (`core/desktop`) khi chạy desktop, và adapter mock (`core/mock`) khi chạy trên trình duyệt. Nhờ đó, `npm start` chạy được toàn bộ UI bằng dữ liệu giả.
- **Phát nhạc:**
  - `PlayerService` (`core/player`) giữ queue và trạng thái phát.
  - `PlaybackEngine` là ranh giới với backend: Native Shared (Native Audio Host, mặc định) hoặc Chromium Shared (dự phòng).
- **Electron (`electron/`):** main process, IPC đã validate, SQLite, scanner và protocol `music://`. Renderer không chạm filesystem hay IPC thô.

**Ranh giới quan trọng:** việc thuần giao diện chỉ sửa `features/`, `shared/` và `src/styles/`. Hành vi phát nhạc, gateway, IPC và database là những thay đổi riêng, phải được yêu cầu rõ.

### Các service UI hay dùng (`core/layout`, `core/theme`)
- `LayoutPreferenceService`: layout hiện tại, lưu trong `lutsra.layout.*`.
- `ThemeService`: theme Graphite/Cloud và accent. Service này gắn `data-theme`, `data-accent` và `data-layout` lên `<html>`.
- `TrackSelectionService`: track đang chọn. Inspector của Console đọc giá trị này.
- `RecentPlaysService`: lịch sử nghe, lưu trong `lutsra.recentPlays` dạng `[{ trackId, playedAt }]`, mới nhất trước, tối đa 20. Lịch sử được ghi khi `player.currentTrack` đổi.
- `RightPanelService`: panel nào đang mở bên phải (queue drawer hoặc track details).
- `NavigationHistoryService`: lịch sử điều hướng cho nút back/forward.

## 3. Ba layout, một bảng màu
`<html data-layout>` nhận một trong ba giá trị. Mỗi layout khác nhau ở **vị trí** của điều hướng, nội dung và player, không khác nhau ở màu.

| | Gallery (`inset`) | Console (`classic`) | Ambient (`liquid-glass`) |
|---|---|---|---|
| Điều hướng | tab chữ trên header | cây thư viện kèm nhóm Quality | rail icon bằng kính |
| Player | rail Now Playing 300px, có Up next | thanh strip 52px kèm signal path | dock dạng viên thuốc, nổi giữa màn hình |
| Mật độ | hàng 52px | hàng 30px, inspector dock ở cạnh | hàng 44px |

Component không viết `if layout === ...`. Thay vào đó, chúng đọc token theo layout: `--surface-radius`, `--control-radius`, `--row-height`, `--cover-*`, `--type-display*`, `--motion-*`. Chỉ khi topology thật sự khác (ví dụ Up next chỉ có trong rail Gallery) mới tách theo layout.

Responsive tính theo **container** `.main-content` (`@container main-content`, đơn vị `cqi`), không theo viewport. Lý do: ở Console, cây thư viện và inspector chiếm chỗ, nên cùng một cửa sổ nhưng phần nội dung hẹp hơn nhiều.

## 4. Token, theme và màu
- **Nguồn token:**
  - `src/styles/_tokens.scss`: thang spacing, cỡ chữ, bo góc, scrim và các token ngữ nghĩa.
  - `_themes.scss`: hai preset Graphite và Cloud, sáu accent, và token theo từng layout.
- **Accent chỉ dùng để mang nghĩa:** Hi-Res, mục đang active, tiến trình, focus.
  - Chữ màu accent dùng `--text-accent`.
  - Nền có chữ trên accent dùng `--color-accent-fill` với `--color-on-accent`.
- **Amber là dấu hiệu thiếu:** file thiếu hoặc unavailable, output mất kết nối. Chữ màu amber dùng `--status-warning-text`. Với accent Amber, màu cảnh báo tự chuyển sang cam để không trùng với accent.
- **Nút xóa:** dùng `--status-error-fill`, `--status-error-fill-hover` và `--color-on-error`.
- **Nút Play màu mực:** nền `--text-primary`, icon `--text-inverse`.
- **Chữ trên ảnh:** chữ trắng đặt trên scrim (`--scrim-soft`, `--scrim-strong`, `--scrim-heavy`). Đặt nền tối bên dưới ảnh để chữ vẫn đọc được trong lúc ảnh đang tải.
- **Script contrast:** `node scripts/check-accent-contrast.mjs` kiểm mọi cặp accent × theme, cặp nút xóa và khoảng cách màu (ΔE) giữa accent và màu cảnh báo. Chạy lại mỗi khi đổi token màu.

## 5. Chất lượng file và câu chữ
- **Hàm format:** dùng chung trong `src/app/features/home/library-quality.ts`. Không tự viết chuỗi "kHz" ở từng chỗ.
  - `trackQuality`: trả về `lossy` / `lossless` / `hires`. Hi-Res nghĩa là lossless và 24-bit trở lên hoặc trên 48 kHz.
  - `formatTrackFormat`: dạng "FLAC 24/96".
  - `formatResolution`: dạng "24/96" hoặc "256k".
- **Signal path** (`shared/components/signal-path`): dòng mono `nguồn → đường ra`, có tooltip giải thích trạng thái. Settings › Audio output giải thích engine và shared mixer ngay tại chỗ.
- **Câu chữ:**
  - Mọi nhãn viết sentence case: nút, tiêu đề, aria-label, tooltip.
  - Tên trang và tên engine giữ chữ hoa.
  - Một bài gọi là **track**.
  - Toggle hiển thị On/Off, kèm `aria-pressed`.

## 6. Thành phần dùng chung đáng biết
- **`album-card`:** thẻ không viền. Nhận `imageUrls` để ghép 2×2 khi có 4 ảnh. Nút phụ chèn qua slot `[card-actions]`.
- **`shared/utils/list-media.ts`:**
  - `selectPlaylistArtwork`: chọn 4 ảnh khác nhau làm bìa playlist.
  - `nextQueueEntries`: lấy các bài cho Up next.
- **`player-bar`:** gồm cả ba dạng player. Up next trong rail Gallery chỉ vẽ những dòng vừa khít, và ẩn khi cửa sổ nhỏ hơn 1101×701.
- **`track-details-panel`:** inspector của Console. Hiển thị khối chất lượng file trước, rồi mới đến tag.
- **Xóa có hoàn tác:** xóa playlist không còn hộp xác nhận. Playlist ẩn ngay, toast "Deleted … · Undo" hiện 6 giây. Gateway chỉ xóa thật khi hết giờ, khi xóa playlist khác, hoặc khi rời trang. Xóa queue cũng có Undo (`QueueActionsService.clearWithUndo`).
- **`spectrum-visualizer`:** khi tạm dừng, vẽ đường phẳng kèm chữ "Paused", và giữ nguyên chiều cao khung.

## 7. Bảng track và bàn phím
Mọi bảng track (Songs, chi tiết album/artist/playlist, Home của Console, queue) đi theo một mẫu:
- `role="grid"`, roving tabindex: chỉ một hàng nằm trong thứ tự Tab.
- Phím ↑/↓/Home/End/PageUp/PageDown di chuyển qua `nextRowIndex` (`shared/utils/row-navigation.ts`).
- Enter chạy hành động chính của hàng. Space để dành cho play/pause toàn cục.
- Selection đi theo focus (`aria-selected`).
- Nút trên hàng chỉ vào thứ tự Tab ở hàng đang active.

**Chọn nhiều** (Songs, chi tiết album/artist/playlist; `aria-multiselectable="true"`). Logic chung nằm ở `shared/utils/row-selection.ts`, là hàm thuần và có test.
- Ctrl+click hoặc Ctrl+Space: bật/tắt một hàng.
- Shift+click hoặc Shift+phím mũi tên: chọn dải từ anchor.
- Ctrl+phím mũi tên: chỉ di chuyển focus, giữ nguyên selection.
- Ctrl+A: chọn mọi hàng đang hiển thị.
- Esc hoặc nút Clear: thu selection về hàng đang focus. Luôn có ít nhất một hàng được chọn, nên inspector vẫn khớp.
- Từ hai hàng trở lên, `app-track-selection-bar` phủ lên header bảng. Header bên dưới bị `inert`, các hàng không bị đẩy xuống.
  - Thanh có Play next, Add to queue, Add to playlist (popover, có tạo playlist mới) và Clear.
  - Track unavailable bị bỏ qua, và toast báo rõ số track bị bỏ qua.
  - Playlist detail chọn theo entry id, nên một track xuất hiện hai lần thì được gửi hai lần.

Trang chi tiết đọc `route.paramMap` để tải lại khi router dùng lại component. Một lượt tải về muộn không được ghi đè trang mới.

## 8. Test và kiểm tra
1. `npx ng build`.
2. `npx vitest run`. Test nằm trong `tests/`. `.gitignore` bỏ qua `*.spec.ts`, nên file test mới phải thêm bằng `git add -f`, hoặc đặt đuôi `.spec.mts`.
3. `node scripts/check-accent-contrast.mjs` khi đổi màu.
4. **Xem giao diện thật:** chạy dev server (`npm start`), rồi chạy
   `env -u ELECTRON_RUN_AS_NODE npx electron scripts/ui-sweep.cjs`.
   - Script duyệt mọi route × 3 layout × 2 theme × 1440/560.
   - Nó báo contrast thấp, cuộn ngang, control thiếu tên, ảnh thiếu alt và lỗi console.
   - Kết quả phải là 0 trang bị báo lỗi.
   - Script không đo được chữ nằm trên ảnh, nên các chỗ đó phải xem ảnh chụp bằng mắt.
   - Nếu tự viết probe: chèn style tắt transition **trước** khi đo, vì cửa sổ ẩn làm transition đứng yên và cho kết quả sai.

## 9. Làm việc nhiều agent cùng lúc
Dự án từng được làm song song bởi nhiều agent: một bên review, các bên khác thực hiện.
- Mỗi agent làm trong git worktree và branch riêng, với cổng dev server riêng. Mỗi agent chỉ sửa những file được giao, để hai bên không đụng cùng một file.
- Agent thực hiện **không** commit, push, checkout, stash hay reset. Họ gửi plan ngắn, chờ duyệt, rồi báo cáo kèm: file đổi, output test, ảnh chụp, chỗ làm khác yêu cầu, và lỗi ngoài phạm vi.
- Người review tự đọc diff thật và tự kiểm trên giao diện. Sau đó mới commit, rebase và merge fast-forward vào `main`.
- Các lỗi phát hiện ngoài phạm vi được ghi vào backlog và sửa ở đợt sau, không sửa lẫn vào đợt đang làm.
