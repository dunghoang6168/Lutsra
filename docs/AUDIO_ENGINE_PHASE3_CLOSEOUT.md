# Nghiệm thu Audio Engine — Giai đoạn 3 (Native Audio Host + WASAPI Shared)

> Không nhầm với "Phase 3 UI foundation" trong README. Tài liệu này thuộc [lộ trình Audio Engine](AUDIO_ENGINE_PLAN.md).

## 1. Đã bàn giao

- Native host C++20: FFmpeg (LGPL-shared), WASAPI Shared event-driven, buffer 100 ms, prebuffer 250 ms trước khi phát.
- Mô hình luồng an toàn: mailbox lệnh và graveyard decoder; telemetry không phụ thuộc `controlMutex_`; seek theo epoch giữa producer và consumer.
- Thiết bị:
  - Tạo endpoint mới trước khi thay endpoint cũ.
  - Mở lại decoder khi mix format đổi.
  - Khôi phục khi `DEVICE_INVALIDATED`, bỏ qua tín hiệu đến muộn sau khi đã fallback.
  - Fallback giữ trạng thái paused, không bị ngắt bởi sự kiện của thiết bị không liên quan.
  - Đổi thiết bị khi đang phát thì phát tiếp trên thiết bị mới.
- Gapless thật: nối bài đã chuẩn bị ngay trong cùng buffer WASAPI.
- Hàng đợi IPC có ưu tiên. Electron kill và khởi động lại host khi host không phản hồi.
- Audio Path hiển thị Engine mix (float32) và Device format (đọc từ Windows).
- Native Shared là backend mặc định. Chromium là dự phòng.

## 2. Kiểm thử tự động (03/10/2026)

Chạy với cấu hình: TE-C, Realtek và HM-805; thư viện thật.

| Lệnh | Kết quả |
|---|---|
| `npm run test:audio-host` | Đạt |
| `npm run test:audio-host:smoke` | Đạt: 5 endpoint |
| `npm run test:audio-host:codecs` (mute) | Đạt: WAV/FLAC/MP3/M4A/OGG/Opus, crossfade, gapless, seek |
| `npm run test:audio-host:stress` × 4 (mute) | Đạt: 531/531 phản hồi mỗi lượt, 10 lần đổi Realtek ↔ TE-C, không treo, không sót tiến trình |

Đã chạy lại cả bốn lệnh sau các commit cuối (`0846715`, `af7f986`, `e5cd15f`) và bản Native mặc định: đều đạt.

Lưu ý: `npm run build:electron` xóa sạch `dist-electron`, nên luôn chạy `build:audio-host` **sau** nó. Các script `electron` và `package:win` đã làm đúng thứ tự này.

## 3. Checklist thủ công

Build bằng `npm run electron`. Đánh dấu `[x]` khi đạt; ghi ngày và ghi chú nếu có lỗi.

### Thiết bị và fallback

- [ ] Fallback **tắt**, đang phát, rút TE-C: nhạc dừng, không phát ra thiết bị khác. Bấm Play thì báo lỗi. (×5)
- [ ] Fallback **bật**, đang phát, rút TE-C: nhạc dừng; thông báo "System Default is ready". Bấm Play thì phát tiếp qua System Default. (×5)
- [ ] Bật fallback, **tắt hẳn app rồi mở lại**, rút TE-C ngay mà không vào Settings: hành vi giống mục trên.
- [ ] Đang phát qua fallback, cắm hoặc tắt một thiết bị khác (Bluetooth, USB): nhạc **không** dừng.
- [ ] Cắm lại TE-C: chuyển về TE-C, giữ paused, không tự phát.
- [ ] Đổi Realtek ↔ TE-C trong Settings khi đang phát: phát tiếp trên thiết bị mới, đúng tốc độ.
- [ ] Đổi thiết bị mặc định của Windows khi preferred là System Default: nhạc dừng, không tự phát.

### Format và khôi phục

- [ ] Đổi **sample rate** của TE-C trong Sound settings khi đang phát: báo gián đoạn, Engine mix cập nhật theo rate mới, phát lại đúng tốc độ.
- [ ] Chỉ đổi **bit depth** của TE-C: Device format cập nhật, Engine mix vẫn là 32-bit float.
- [ ] App khác chiếm TE-C ở Exclusive (ví dụ foobar2000 WASAPI exclusive): Lutstra báo thiết bị bận. Đóng app kia rồi bấm Play: phát lại được.
- [ ] Sleep rồi resume máy: phát tiếp được, không treo.
- [ ] Kill `lutstra-audio-host.exe` lần 1: host khởi động lại, paused đúng vị trí. Kill lần 2: chuyển về Chromium, paused.

### Nghe

- [ ] Gapless trên album nối liền (crossfade tắt): không nghe khoảng ngắt giữa các bài.
- [ ] Seek gần cuối bài rồi để chuyển bài tự động: vẫn liền mạch.
- [ ] Crossfade bật: chuyển bài mượt, không hụt âm bất thường.
- [ ] Quét thư viện trong lúc phát: không giật, bài vẫn tự chuyển đúng.

### Đóng gói

- [ ] `npm run package:win`: bản NSIS và bản portable đều có host, DLL, license và source FFmpeg; cả hai phát được bằng Native.

## 4. Giới hạn đã biết (chấp nhận cho Giai đoạn 3)

- Có thể có tiếng click nhẹ khi Pause (chưa fade-out). Sẽ làm trong Giai đoạn 5.
- Crossfade linear (hụt khoảng −3 dB ở giữa). Equal-power sẽ làm cùng headroom ở Giai đoạn 4/7.
- `prepare` giữa lúc crossfade sẽ cắt fade. Renderer đã chặn; chỉ còn rủi ro lý thuyết.
- Backend Chromium vẫn có khoảng ngắt nhỏ giữa các bài (giới hạn của `HTMLAudioElement`).
- Fallback đi tới System Default của Windows, không nhất thiết là Realtek.

## 5. Đóng giai đoạn

Khi checklist mục 3 đạt và đã dùng Native hằng ngày khoảng 1–2 tuần không có lỗi mới:

1. Đánh dấu Giai đoạn 3 là "Xong" trong [AUDIO_ENGINE_PLAN.md](AUDIO_ENGINE_PLAN.md).
2. Bắt đầu Giai đoạn 5 (WASAPI Exclusive).

Native Shared đã phát hành làm mặc định trong bản **0.2.3**; checklist trên là nghiệm thu sau phát hành.
