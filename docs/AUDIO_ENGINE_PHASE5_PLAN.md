# Kế hoạch triển khai Audio Engine — Giai đoạn 5 (WASAPI Exclusive)

> Thuộc [lộ trình Audio Engine](AUDIO_ENGINE_PLAN.md). Bắt đầu 04/10/2026, ngay sau khi đóng Giai đoạn 3.
> Ước lượng: 7–11 ngày làm việc.

## 1. Mục tiêu và phạm vi

Black Pearl (TE-C) nhận đúng sample rate gốc của từng bài. Lutsra chiếm riêng thiết bị, không qua mixer của Windows.

**Trong phạm vi:**

- Chế độ `exclusive-dsp`, hiển thị trên UI là "Exclusive".
- Chọn format theo từng bài.
- Đọc danh sách format DAC hỗ trợ.
- Fade chống click.
- Báo lỗi rõ ràng.
- Cấu hình buffer.

**Ngoài phạm vi (để Giai đoạn 6):**

- Chế độ `exclusive-bitperfect`.
- Khóa EQ/volume.
- Nhãn "Bit-perfect".
- Audio Path Inspector đầy đủ.

Trong Giai đoạn 5, `bitPerfectEligible` luôn là `false`. Tuy vậy, Giai đoạn 5 phải để lại đường tín hiệu **có khả năng** bit-perfect: khi volume ở 100%, không DSP và cùng format, mẫu ra phải bằng đúng mẫu nguồn (xem M1).

## 2. Hiện trạng code liên quan

| Chỗ | Hiện tại | Phải đổi |
|---|---|---|
| [audio_host.cpp `createEndpoint`](../native/audio-host/audio_host.cpp) | Luôn `Initialize(AUDCLNT_SHAREMODE_SHARED, …, mixFormat)` | Nhận thêm mode và format mong muốn; thương lượng format ở Exclusive |
| `load` / `prepare` | Mở decoder theo `mixFormat_` của endpoint | Ở Exclusive: format endpoint đi theo bài, không ngược lại |
| `swapEndpoint` | Mở lại cả hai decoder khi rate đổi | Chỉ mở lại decoder có rate khác với endpoint mới |
| `renderLoopSafe` | Ghi `bufferFrames_ - padding` frame | Exclusive event-driven ghi đủ `bufferFrames_` mỗi event |
| Bộ ghi integer trong render | 16-bit nhân `32767`, 32-bit nhân `2147483647.0f`, không có 24-bit packed | Nhân `32768` / `2^31` có clamp; thêm 24-bit packed |
| `pause()` | `Stop()` ngay (TODO ở dòng 545) | Fade-out ~10 ms trên render thread rồi mới `Stop()` |
| `onDevicesChanged` → `reinitIfFormatChanged` | Theo dõi mix format của Windows | Bỏ qua khi đang Exclusive |
| [main.cpp `deviceJson`](../native/audio-host/main.cpp) | `supportedModes:["shared"]`, `supportedFormats:null` | Điền từ kết quả dò format |
| [native-audio-playback.engine.ts](../src/app/core/desktop/native-audio-playback.engine.ts) `setOutputMode` | Từ chối mọi mode khác `shared` | Gửi lệnh `set-output-mode` |
| [settings.model.ts](../src/app/core/models/settings.model.ts), [settings-validation.ts](../electron/ipc/settings-validation.ts) | `outputMode: 'shared'` | `'shared' \| 'exclusive-dsp'` |
| [player.service.ts](../src/app/core/player/player.service.ts) `selectAudioOutput` | Luôn ghi đè `outputMode: 'shared'` | Không đụng tới mode |

Lỗi ở bộ ghi integer hiện chưa lộ ra vì Shared luôn dùng float. Ở Exclusive nó sẽ làm sai từng mẫu: ví dụ mẫu 16-bit `0x7FFF` ra thành `0x7FFE`.

## 3. Quyết định đã chốt (có thể đổi trước khi bắt đầu M2)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Giữ pipeline float32 từ decoder đến bộ ghi; không thêm đường decode integer riêng. | float32 chứa chính xác mọi mẫu 16/24-bit. Nếu cùng rate và không có gain thì quy đổi int → float → int là đồng nhất. Một đường decode duy nhất, ít code. |
| D2 | Hai bài liền nhau khác format: không gapless, không crossfade. Bài đầu fade-out, khởi tạo lại endpoint, rồi phát bài sau. | Theo thống kê thư viện, chỉ 2/129 album trộn rate. Nối liền mạch qua ranh giới đổi rate thì phần cứng không làm được. |
| D3 | Fallback khi rút DAC luôn mở System Default ở **Shared**. Panel Audio Path ghi rõ lý do. | Thiết bị dự phòng (Realtek, Bluetooth) thường không hỗ trợ Exclusive. Vẫn giữ quy tắc paused, không tự phát. |
| D4 | Exclusive thất bại (bận, không được phép, không hỗ trợ format) thì báo lỗi và dừng ở trạng thái paused. **Không** tự rơi về Shared. | Quy tắc trải nghiệm ở mục 7 của lộ trình. |
| D5 | Không upsample. Rate nguồn không được hỗ trợ thì chọn rate cùng họ (44.1k ↔ 88.2k ↔ 176.4k, 48k ↔ 96k ↔ 192k) gần nhất phía trên, ghi lý do "Sample-rate conversion". | Chỉ resample khi bắt buộc; resample theo bội số nguyên ít artefact hơn. |
| D6 | Bit depth: ưu tiên container giữ nguyên số bit của nguồn. Thứ tự: 32-bit container (valid 24) → 24 packed → 32/32 → 16. Chỉ hạ bit depth khi thiết bị không còn lựa chọn nào khác, và ghi lý do. | Tuân thủ "chỉ đổi bit depth khi thiết bị yêu cầu". Thêm số 0 vào container lớn hơn không làm mất dữ liệu. |

## 4. Các mốc triển khai

Mỗi mốc là một commit (hoặc một nhóm commit nhỏ) có thể build được. Kiểm thử chỉ chạy khi chủ dự án cho phép.

### M0 — Dò format DAC (0,5 ngày) — làm trước tiên

**Trạng thái (04/10/2026):** Đã triển khai ma trận dò, cache theo endpoint và xuất capability qua IPC/smoke. Đã dò 06/10/2026 bằng `test:audio-host:smoke`; kết quả ở mục 8.

Build Electron → Audio Host và Angular thành công. `supportedFormats.bitDepth` là số bit hợp lệ; trường bổ sung `containerBits` phân biệt 32/24 với 24 packed. System Default lấy capability của endpoint mặc định hiện tại.

- Thêm `WasapiHost::probeFormats(endpointId)`. Hàm gọi `IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, …)` trên ma trận rate {44.1, 48, 88.2, 96, 176.4, 192 kHz} × container {32/24, 24/24, 32/32, 16/16} × kênh {2}.
- Cache kết quả theo endpoint ID và xóa cache khi có `devices-changed`. Kết quả dùng để điền `supportedFormats` và `supportedModes`: thêm `exclusive-dsp` khi có ít nhất một format đạt.
- Chạy lệnh dò trên TE-C, Realtek và HM-805, ghi kết quả vào mục 8 của tài liệu này. **Nếu TE-C thiếu rate nào thì điều chỉnh D5/D6 trước khi làm M2.**
- Driver USB đôi khi báo hỗ trợ một format nhưng `Initialize` vẫn thất bại. Vì vậy kết quả `IsFormatSupported` chỉ dùng để gợi ý; `Initialize` mới là căn cứ cuối cùng.

### M1 — Bộ ghi mẫu integer chính xác (0,5 ngày)

**Trạng thái (04/10/2026):** Đã tách `writeSamples`, hỗ trợ float32/int16/int24 packed/int32 (valid 24 hoặc 32). Đã viết test round-trip `swr` với biên, ±1 LSB và 4096 mẫu có seed cố định, cùng test clamp/padding/float copy. `test:audio-host` đạt (06/10/2026).

Build Audio Host và biên dịch/link executable unit test thành công; không chạy executable. Script unit test chuẩn bị DLL FFmpeg khi chủ dự án tự chạy.

- Tách việc chuyển float sang định dạng thiết bị thành hàm thuần `writeSamples(const float*, size_t, const WAVEFORMATEX*, BYTE*)`. Hỗ trợ:
  - float32
  - int16 (×32768, clamp)
  - int24 packed
  - int32 container có valid 24 hoặc 32 bit (×2^31, clamp về `INT32_MAX`)
- Unit test trong [native_tests.cpp](../native/audio-host/tests/native_tests.cpp): chuyển mẫu int16 và int24 qua `swr` (chỉ đổi định dạng, cùng rate), đưa qua `writeSamples`, kết quả phải đồng nhất với đầu vào. Test này làm nền cho Giai đoạn 6.

### M2 — Mở endpoint ở Exclusive (2–3 ngày)

**Trạng thái (06/10/2026):** Đã triển khai endpoint Exclusive, chọn format thuần theo bảng mục 8, retry alignment/device period và lỗi Exclusive riêng. Fade chờ event thứ hai sau buffer cuối. Sau lỗi timeout 80 ms phụ thuộc pha, chủ dự án đã duyệt tách hạn chờ submit tối đa một period + 20 ms và drain tối đa 2 × period thực tế + fade + 20 ms từ timestamp submit. Kiểm tra muted đạt bốn period, gồm tám pha Pause ở 80 ms với 0 timeout. Khác endpoint tạo thất bại vẫn giữ phiên cũ phát tiếp; cùng endpoint giải phóng trước khi mở mode mới.

- `EndpointBundle` lưu thêm `mode` và stream format. Ở Exclusive, format được cấp phát bằng `CoTaskMemAlloc` để dùng chung đường giải phóng với `mixFormat`.
- `createEndpoint(id, mode, desiredSource, error)` làm như sau:
  - Ở Exclusive: duyệt danh sách ứng viên theo D5/D6 và gọi `Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE, AUDCLNT_STREAMFLAGS_EVENTCALLBACK, period, period, &wfx)`.
  - Gặp `AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED`: lấy `GetBufferSize`, tính lại period đã căn, `Activate` lại client rồi `Initialize` lần nữa (theo mẫu của Microsoft).
  - Ánh xạ lỗi:
    - `AUDCLNT_E_DEVICE_IN_USE` → `OUTPUT_DEVICE_BUSY`
    - `AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED` → `OUTPUT_EXCLUSIVE_NOT_ALLOWED` (mã mới)
    - Hết ứng viên → `OUTPUT_FORMAT_UNSUPPORTED`
- Buffer mặc định 20 ms; nếu thất bại thì thử period mặc định của thiết bị (`GetDevicePeriod`). Giá trị chọn được: 10/20/40/80 ms.
- Render loop: khi Exclusive thì `frames = bufferFrames_`; khi Shared giữ nguyên cách tính bằng padding.
- `recoverInvalidated`, `selectDevice` và `play` (thử lại) tạo endpoint theo mode hiện tại và source đang phát.
- `enterFallback` luôn mở ở Shared (D3).
- `onDevicesChanged`: không gọi `reinitIfFormatChanged` khi đang Exclusive.

### M3 — Format theo từng bài (2 ngày)

**Trạng thái (06/10/2026):** Đã triển khai decoder giữ format nguồn, load theo format thương lượng, prepare so với stream thực tế (gồm valid/container bits), set-output-mode và kFormatSwitchPrerollMs = 0. Native recovery luôn paused; chỉ fallback System Default dùng Shared. EOF Exclusive fade và drain đủ hai event trước ended. Test TE-C 16-bit → 24-bit cùng rate trả false; gapless/crossfade cùng format và khác-rate load đạt trong lượt muted.

- `DecoderPipeline::open` nhận `outputRate = 0` / `outputChannels = 0` với nghĩa "giữ nguyên rate và số kênh của nguồn". Thêm hàm truy cập `outputRate()`.
- `load` ở Exclusive:
  1. Mở decoder theo format gốc.
  2. Nếu format endpoint khác với nguồn: fade-out (M4), tạo endpoint mới theo nguồn, rồi `swapEndpoint`.
  3. `SetActive`.
- `swapEndpoint` chỉ mở lại decoder có `outputRate()` khác rate của endpoint mới.
- `prepare` ở Exclusive: nếu bài kế tiếp khác format thì trả `false` (D2). Renderer khi đó đi đường `ended` → `load` như bình thường, nên không phải sửa `player.service`. Cần kiểm tra lại bằng cách đọc code `preparationReady`.
- Lệnh mới `set-output-mode {mode, bufferMs}`, xử lý giống `selectDevice`:
  - Tạo endpoint mới trước.
  - Lỗi thì giữ nguyên endpoint cũ và trả mã lỗi.
  - Thành công thì phát tiếp nếu trước đó đang phát.
- Thêm một hằng số hiệu chỉnh `kFormatSwitchPrerollMs` (mặc định 0): số ms im lặng phát trước sau khi đổi rate. Nhiều DAC USB tắt tiếng 100–300 ms khi đổi clock và nuốt mất vài nốt đầu. Chỉ tăng giá trị này nếu nghe thấy hiện tượng đó trên TE-C.

### M4 — Dừng không click (1–2 ngày)

**Bổ sung đợt 2 (06/10/2026):** Exclusive dùng hai buffer luân phiên; event đầu sau submit chỉ báo buffer bắt đầu phát, event thứ hai mới xác nhận drain. Theo chấp thuận bổ sung, chờ submit tối đa period + 20 ms, rồi drain tối đa 2 × period + fade + 20 ms từ submit; Shared không đổi. Kiểm tra muted bốn period và tám pha 80 ms đạt; click/vị trí resume bằng tai còn cần chủ dự án xác nhận.

**Trạng thái (04/10/2026):** Đã triển khai `FadeOutThenSignal` tuyến tính 10 ms theo stream rate, chờ tối đa thời lượng buffer endpoint + fade + 20 ms (kể cả mailbox đầy), áp dụng pause/load/đổi endpoint. Mỗi `Start()` reset gain để fade-in; splice không reset. Lệnh fade quá hạn không tác động tới lần Start sau. Chưa chạy kiểm thử/nghe xác nhận click hay vị trí resume.

**Cách dừng sau hiệu chỉnh:** Shared giữ nguyên buffer/prime 100 ms; phát bình thường ghi `bufferFrames_ - padding` frame như Giai đoạn 3. Khi nhận lệnh dừng, đoạn fade 10 ms nối ngay sau PCM đã xếp, có thể trải qua nhiều lần ghi nếu chỗ trống nhỏ hơn đoạn fade. Chỉ đọc decoder đủ số frame còn lại của fade; phần còn lại của buffer và các lần ghi sau chỉ là silence, không đọc thêm active/incoming. Sau `ReleaseBuffer` thành công, cộng số frame silence đã ghi sau fade. Render chỉ báo hoàn tất khi `GetCurrentPadding <= số frame silence đã ghi`, tức toàn bộ nhạc đã xếp và đoạn fade đã tiêu thụ. Control chờ tối đa buffer + fade + 20 ms (Shared ≈ 130 ms; endpoint Exclusive 20 ms ≈ 50 ms), rồi vẫn `Stop()` khi quá hạn/invalidation.

Vị trí decoder và `position_` dừng tại cuối đoạn fade, không tăng trong lúc ghi silence. Khi drain hoàn tất, nhạc đã tiêu thụ khớp với vị trí resume; `startClientWithSilence()` giữ `Reset()`, chỉ bỏ đuôi silence. Pause gửi snapshot thời gian cuối trước trạng thái paused để renderer/Electron lưu đúng vị trí; snapshot được đồng bộ với telemetry và thay thế các bản tin time lossy cũ đang chờ. Nếu driver/render quá hạn hoặc thiết bị bị invalidated thì không thể bảo đảm toàn bộ PCM đã phát hết.

Build Audio Host sau hiệu chỉnh M4 thành công (0 lỗi, 11 warning hiện có về alignment/signedness và header FFmpeg). Chưa chạy kiểm thử. Đã tới điểm dừng 1: M2/M3/M5/M6 chưa triển khai. Chủ dự án chạy `npm run test:audio-host` và `npm run test:audio-host:smoke`, điền mục 8 rồi xác nhận trước đợt 2.

- Thêm lệnh render `FadeOutThenSignal`: render thread giảm gain về 0 trong khoảng 10 ms, sau đó chỉ ghi silence và chờ padding xác nhận fade đã phát hết trước khi đánh dấu cờ. Thread điều khiển chờ tối đa thời lượng buffer + fade + 20 ms rồi gọi `Stop()` để không bao giờ treo.
- Áp dụng cho: pause, `load` khi đang phát, đổi format, đổi mode, đổi thiết bị.
- Sau mỗi lần `Start()`, đặt lại `smoothedGain = 0` để có fade-in. Hiện tại resume sau pause không có fade-in.
- Áp dụng cho cả Shared. Mục này xóa TODO còn lại từ Giai đoạn 3.

### M5 — Electron, renderer và UI (2 ngày)

**Trạng thái (06/10/2026):** Đã nối IPC/preload/engine, validation mode/buffer, persistence settings và khôi phục mode trước select-device. Lỗi output khi recovery không tự rơi về Chromium; snapshot vị trí được giữ và gửi lại cho renderer. Settings và signal path phản ánh Shared/Exclusive, integer output, processingReasons và trạng thái disabled. Angular/Electron build đạt, Vitest 143/143. UI sweep xác nhận 0 trang bị flag; 12 screenshot Settings dùng native-status fixtures (không phát audio).

- **[main.cpp](../native/audio-host/main.cpp):** thêm lệnh `set-output-mode`. `deviceJson` lấy dữ liệu từ M0. `statusJson` trả:
  - `mode`
  - `outputFormat` = stream format (integer)
  - `outputSampleType`
  - `resamplingActive` / `channelConversionActive` tính theo stream format
  - `processingReasons`: "Exclusive DSP mode", thêm "Software volume" khi volume < 100%
  - `deviceFormat: null` khi Exclusive, vì `PKEY_AudioEngine_DeviceFormat` là format của Shared và sẽ gây hiểu nhầm
- **[audio-host.service.ts](../electron/services/audio-host.service.ts):** thêm `setOutputMode`, nhớ mode để khôi phục (`rehydratePausedSession` gửi mode **trước** `select-device`).
- **Đường IPC:** cập nhật [desktop-api.ts](../src/app/core/desktop/desktop-api.ts), preload, [register-ipc.ts](../electron/ipc/register-ipc.ts) và [ipc-validation.ts](../electron/ipc/ipc-validation.ts). Mode chỉ nhận `shared` hoặc `exclusive-dsp`; bufferMs chỉ nhận một trong các giá trị {10, 20, 40, 80}.
- **Settings:** thêm `outputMode: 'shared' | 'exclusive-dsp'` và `exclusiveBufferMs`, cập nhật validation tương ứng.
- **[player.service.ts](../src/app/core/player/player.service.ts):**
  - Thêm signal `outputMode`.
  - Khôi phục mode sau khi backend được kích hoạt.
  - `selectAudioOutput` thôi ghi đè mode.
  - Khi rơi về Chromium mà mode đã lưu là Exclusive: hiện notice "Exclusive cần Native Audio Host — đang phát Shared"; **giữ nguyên** mode đã lưu.
- **Settings UI (mục Audio output):**
  - Bộ chọn Shared / Exclusive, kèm mô tả: "Lutsra chiếm riêng DAC; ứng dụng khác sẽ không phát được qua thiết bị này; sample rate đổi theo bài".
  - Vô hiệu hóa bộ chọn, có ghi lý do, khi thiết bị không có `exclusive-dsp` hoặc backend đang là Chromium.
  - Ô chọn buffer nằm dưới mục nâng cao.
  - Nhãn Audio Path:
    - Mode: "WASAPI Exclusive"
    - "Output format" thay cho "Engine mix"
    - Lý do fallback Shared (D3)
- **Copy cho các mã lỗi mới:**
  - `OUTPUT_EXCLUSIVE_NOT_ALLOWED`: "Windows đang chặn chế độ Exclusive cho thiết bị này (Sound → Properties → Advanced)."
  - `OUTPUT_DEVICE_BUSY` ở Exclusive: "Một ứng dụng khác đang dùng TE-C ở chế độ Exclusive."

### M6 — Script kiểm thử (1–2 ngày, viết sẵn, chạy khi được phép)

**Trạng thái (06/10/2026):** Đã bổ sung codecs Exclusive, precision boundary, gapless/crossfade, EOF drain, fade 10/20/40/80 ms và lỗi chọn endpoint khác; stress đổi mode 10 lượt. Native unit/smoke/codecs/stress đạt; lỗi fade 80 ms lượt đầu đã sửa theo chấp thuận bổ sung và xác nhận tám pha Pause. Các lượt đã chạy với sự cho phép của chủ dự án, toàn bộ audio muted. Stress: 605 request/605 response. Raw logs và screenshot ở artifacts/phase5 trong worktree; báo cáo ở docs/AUDIO_ENGINE_PHASE5_DOT2_REPORT.md. Nghiệm thu nghe/đèn DAC/rút-cắm/foobar/quyền Windows còn dành cho chủ dự án.

- [smoke-audio-host.mjs](../scripts/smoke-audio-host.mjs): in `supportedFormats` của từng endpoint.
- [integration-audio-host-codecs.mjs](../scripts/integration-audio-host-codecs.mjs): thêm một lượt Exclusive (muted), phát lần lượt file 44.1/48/96 kHz. Với mỗi file, kiểm tra `outputFormat.sampleRate` bằng rate nguồn và `resamplingActive=false`.
- [stress-audio-host.mjs](../scripts/stress-audio-host.mjs): đổi Shared ↔ Exclusive 10 lần khi đang phát, xen kẽ với `load` các bài khác rate.
- Unit test: test round-trip ở M1, cộng một hàm thuần chọn format ứng viên (đầu vào: tập format thiết bị hỗ trợ và format nguồn; đầu ra: format chọn kèm lý do).

## 5. Thứ tự và ước lượng

| Mốc | Ngày | Phụ thuộc |
|---|---|---|
| M0 Dò format | 0,5 | — |
| M1 Bộ ghi integer | 0,5 | — |
| M4 Fade chống click | 1–2 | — (có thể làm song song, giúp ích cho Shared ngay) |
| M2 Endpoint Exclusive | 2–3 | M0, M1 |
| M3 Format theo bài + `set-output-mode` | 2 | M2 |
| M5 Electron/UI | 2 | M3 |
| M6 Script kiểm thử | 1–2 | M3 |

## 6. Rủi ro

- **Driver USB** báo `IsFormatSupported` sai, hoặc chỉ nhận container 32-bit: đã xử lý bằng cách thử lần lượt các ứng viên và coi `Initialize` là căn cứ cuối cùng.
- **DAC tắt tiếng sau khi đổi clock** làm mất vài nốt đầu: dùng `kFormatSwitchPrerollMs` (M3) để hiệu chỉnh trên thiết bị thật.
- **Sleep/resume ở Exclusive:** endpoint bị invalidate và đi qua `recoverInvalidated`. Cần kiểm thủ công riêng cho Exclusive.
- **Bluetooth HM-805** gần như chắc chắn không có Exclusive: UI sẽ vô hiệu hóa lựa chọn dựa trên kết quả M0.
- **Windows tắt "Allow applications to take exclusive control":** trả mã lỗi riêng kèm hướng dẫn bật lại.
- **Buffer 10 ms** có thể gây underrun khi máy bận: mặc định 20 ms, và bộ đếm `underruns` đã có sẵn trong `statusJson`.

## 7. Tiêu chí nghiệm thu

- [ ] Phát lần lượt file 44.1, 48 và 96 kHz: đèn/trạng thái trên TE-C đổi theo; Audio Path hiện đúng rate và "No resampling".
- [ ] Âm thanh hệ thống (thông báo Windows, trình duyệt) không phát chen vào TE-C khi đang Exclusive.
- [ ] foobar2000 giữ TE-C ở Exclusive: Lutsra báo thiết bị bận và vẫn ở trạng thái paused; đóng foobar rồi bấm Play thì phát được.
- [ ] Tắt quyền Exclusive trong Windows: hiện thông báo `OUTPUT_EXCLUSIVE_NOT_ALLOWED`, không tự phát qua Shared.
- [ ] Không có pop/click khi pause/resume, chuyển bài cùng rate, chuyển bài khác rate, đổi Shared ↔ Exclusive.
- [ ] Pause/resume không nhảy vị trí.
- [ ] Quét thư viện khi đang phát ở Shared: underruns vẫn = 0.
- [ ] Album cùng rate với crossfade tắt: gapless như ở Shared.
- [ ] Rút TE-C khi đang Exclusive: nhạc dừng. Nếu fallback bật thì System Default ở Shared và vẫn paused. Cắm lại thì TE-C quay về Exclusive, không tự phát.
- [ ] Kill host khi đang Exclusive: host khởi động lại ở Exclusive, paused đúng vị trí.
- [ ] Unit test round-trip ở M1 đạt (mẫu int16/int24 đi qua đường ống không bị thay đổi).
- [ ] Tắt app rồi mở lại: vẫn nhớ mode và buffer.

## 8. Kết quả dò format (điền sau M0)

| Thiết bị | Rate Exclusive hỗ trợ | Container | Ghi chú |
|---|---|---|---|
| TE-C | 44.1, 48, 88.2, 96, 176.4, 192 kHz | 24 packed, 32/32, 16/16 — **không có 32/24** | Đủ mọi rate trong thư viện → không cần resample. Nguồn 24-bit dùng 24 packed (D6). |
| Realtek | 44.1–192 kHz (đủ 6 rate) | 32/24, 24 packed, 16/16 | Không có 32/32. |
| HM-805 | — | — | Không kết nối lúc dò (06/10/2026); dò lại khi cắm. |
