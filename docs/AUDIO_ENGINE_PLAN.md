# Lộ trình Audio Engine — Lutsra Desktop

> Tài liệu sống. Cập nhật lần cuối: 03/10/2026.
> Phạm vi: chỉ Windows desktop. Không phát triển iOS/macOS trong lộ trình này.

## 1. Mục tiêu

Lutsra là trình phát nhạc **offline cho Windows**, phát từ các thư mục nhạc trên máy. Không web, không streaming, không đồng bộ. Mọi tính năng mới cần khớp với câu này trước khi được đưa vào lộ trình.

Hai hướng sử dụng:

- **Tiện dụng:** chọn thiết bị, EQ, volume, crossfade, visualizer.
- **Chất lượng cao:** WASAPI Exclusive, tự đổi sample rate theo bài, có khả năng bit-perfect.

## 2. Quyết định đã chốt

| Ngày | Quyết định | Lý do |
|---|---|---|
| 03/10/2026 | **Native Shared là backend mặc định**; Chromium Shared chỉ còn là dự phòng, **đóng băng** (chỉ sửa lỗi, không thêm tính năng). | Gapless, EQ và mọi cải tiến âm thanh chỉ khả thi đúng nghĩa trên native. Gapless trên Chromium cần viết lại bằng Web Audio, không xứng công sức cho một backend dự phòng. |
| 03/10/2026 | **Làm Giai đoạn 5 (Exclusive) trước Giai đoạn 4 (EQ)**, trừ khi cần EQ cho nghe hằng ngày. | Thư viện thực tế lẫn sample rate (xem mục 3); Exclusive định hình cách mở thiết bị nên làm trước giúp EQ thiết kế cho cả Shared lẫn Exclusive DSP ngay từ đầu. |
| 03/10/2026 | Ưu tiên của kế hoạch tối ưu cho thư viện 20.000 bài được hạ xuống. | Thư viện thực tế khoảng 900 bài. |

## 3. Bối cảnh thực tế

- **Thiết bị:** DAC TRN Black Pearl (Windows nhận tên `TE-C`), loa Realtek onboard, loa Bluetooth HM-805.
- **Thư viện (03/10/2026):** 876 bài, 100% FLAC, 129 album.

| Sample rate | Tỉ lệ |
|---|---|
| 44.1 kHz (16/24-bit) | 44% |
| 48 kHz | 27% |
| 96 kHz | 24% |
| 88.2 kHz | 5% |
| 176.4 kHz | 1% |

Hai họ 44.1 và 48 kHz gần như chia đôi, nên Shared Mode luôn resample khoảng một nửa thư viện dù đặt Windows ở format nào. Chỉ 2/129 album trộn sample rate giữa các bài, nên đổi sample rate trong Exclusive hầu như chỉ xảy ra ở ranh giới album và ít ảnh hưởng gapless. Toàn FLAC nên không có vấn đề encoder delay/padding của MP3/AAC.

## 4. Kiến trúc

```text
Angular UI → PlayerService → SwitchingPlaybackEngine
                                ├── NativeAudioPlaybackEngine ──IPC (named pipe)──► Native Audio Host (mặc định)
                                │                                                   ├── FFmpeg decoder (LGPL-shared)
                                │                                                   ├── Mailbox / render thread / gapless splice
                                │                                                   └── WASAPI Shared
                                └── HtmlAudioPlaybackEngine (dự phòng, đóng băng)
```

IPC chỉ mang lệnh và trạng thái, không mang PCM. Chi tiết kỹ thuật: [native/audio-host/README.md](../native/audio-host/README.md).

## 5. Trạng thái các giai đoạn

| # | Giai đoạn | Trạng thái |
|---|---|---|
| 1 | Củng cố engine hiện tại | Xong |
| 2 | Quản lý thiết bị đầu ra | Xong |
| 3 | Native Audio Host + WASAPI Shared | **Đang nghiệm thu**: kiểm thử tự động đạt; chờ checklist thủ công ([biên bản](AUDIO_ENGINE_PHASE3_CLOSEOUT.md)) |
| 5 | WASAPI Exclusive | Tiếp theo |
| 6 | Bit-perfect + Audio Path Inspector | Sau Giai đoạn 5 |
| 4 | In-app EQ/DSP | Sau Giai đoạn 5 hoặc 6 (sớm hơn nếu cần EQ hằng ngày) |
| 7 | Hoàn thiện (crossfade equal-power, latency, installer) | Cuối |

Ghi chú về Giai đoạn 7: gapless cho Shared Mode đã làm xong trong Giai đoạn 3.

## 6. Các giai đoạn còn lại

### Giai đoạn 5 — WASAPI Exclusive

- Mở thiết bị ở exclusive, event-driven mode.
- Đọc danh sách format DAC hỗ trợ (`IsFormatSupported`). Trước khi làm, kiểm tra Black Pearl có hỗ trợ đủ 44.1/48/88.2/96/176.4 kHz.
- Tự chuyển sample rate theo bài; không upsample mặc định; chỉ đổi bit depth khi thiết bị yêu cầu.
- Gapless giữ nguyên khi hai bài liền nhau cùng format. Khi khác format: fade-out, khởi tạo lại thiết bị, fade-in.
- Fade-out ngắn trước `Stop()` (pause, đổi bài, đổi rate) để tránh click. Đây là TODO còn lại của Giai đoạn 3.
- Buffer cấu hình được, có giá trị mặc định an toàn.
- Thiết bị bị app khác chiếm: báo `OUTPUT_DEVICE_BUSY` rõ ràng, không âm thầm rơi về Shared.
- Không tuyên bố bit-perfect nếu đã resample hoặc qua DSP.

Kết quả: Black Pearl nhận đúng sample rate gốc của từng bài.

### Giai đoạn 6 — Bit-perfect và xác minh đường phát

Audio Path Inspector hiển thị nguồn, decoder, DSP, chế độ output, thiết bị và format thiết bị. Panel Audio Path hiện đã có "Engine mix" và "Device format", sẽ mở rộng thêm.

Chỉ hiện `Bit-perfect` khi đồng thời thỏa:

- Đang dùng WASAPI Exclusive.
- Sample rate nguồn và output khớp, không resampling.
- EQ, DSP, ReplayGain và crossfade đã bypass.
- Volume phần mềm ở 0 dB.
- Không có channel conversion.

Nếu không đạt, hiện `Processed` kèm nguyên nhân cụ thể.

### Giai đoạn 4 — In-app EQ/DSP

```text
Decode → ReplayGain → Preamp → Parametric EQ → Crossfade/Mixer → Headroom protection → Output
```

- 10 band (31 Hz đến 16 kHz). Gain mỗi band ±12 dB; preamp từ −12 đến +6 dB.
- Biquad parametric ngay từ đầu, UI phiên bản đầu dạng graphic EQ.
- Bật/tắt và A/B tức thì; reset; preset có sẵn và preset người dùng; preset riêng theo thiết bị.
- Clipping indicator; tự đề xuất preamp âm khi tăng band.
- Hoạt động giống nhau trong Shared và Exclusive DSP.

### Giai đoạn 7 — Hoàn thiện

- Crossfade equal-power **đi kèm headroom protection**. Không làm riêng, vì equal-power tăng khoảng +3 dB ở giữa fade và có thể clip.
- Không crossfade trong Bit-perfect Mode.
- Latency/buffer theo thiết bị; khôi phục sau sleep/resume.
- Kiểm tra installer NSIS và bản portable.

## 7. Quy tắc trải nghiệm

- Mặc định Shared Mode; không tự bật Exclusive.
- Bật Bit-perfect thì giải thích rằng EQ và crossfade sẽ tắt.
- Lưu thiết bị và chế độ gần nhất.
- **Không bao giờ tự phát nhạc** sau khi rút/cắm thiết bị, đổi backend hoặc host crash. Fallback chuyển sang System Default của Windows (có thể là loa Bluetooth, không nhất thiết là Realtek) nhưng luôn giữ trạng thái paused.
- Không phát qua thiết bị không được chọn khi fallback tắt.
- Không dùng nhãn "Hi-Res" chỉ dựa trên metadata của file.

## 8. Ngoài phạm vi

iOS/iPadOS, macOS/Core Audio, Android bit-perfect, ASIO, DSD Native/DoP, network audio (DLNA/UPnP), plugin DSP bên thứ ba, phát nhạc trên web. ASIO và DSD chỉ xem xét sau khi Exclusive PCM ổn định.

> Không tự động chạy kiểm thử khi chưa có sự cho phép của chủ dự án.
