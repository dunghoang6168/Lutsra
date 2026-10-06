# Phase 5 — Đợt 2: báo cáo triển khai (06/10/2026)

Branch `feat/phase5-exclusive-dot2`, worktree `.worktrees/phase5-exclusive-dot2`, base `63ccff1` của main tại lúc bắt đầu. Không merge/push; không sửa working tree chính. Mang theo trạng thái M0/M1 và bảng TE-C/Realtek ngày 06/10. Không commit `docs/AUDIO_ENGINE_PLAN.md` hoặc `skills-lock.json`.

**Triển khai và kiểm tra tự động hoàn tất; nghiệm thu hardware bằng người còn mở.** Lượt codecs xác nhận ban đầu phát hiện timeout fade 80 ms phụ thuộc pha. Chủ dự án đã đồng ý tách hạn: chờ submit tối đa một period + 20 ms; drain tối đa 2 × period + fade + 20 ms từ timestamp submit cuối. Bản sửa đạt tất cả tám pha Pause ở 80 ms, vẫn giữ đúng hai hardware event. Shared giữ công thức cũ.

## Commit và thay đổi

| Mốc | Commit | Nội dung |
|---|---|---|
| M2 | `1de79ee` | Selector theo bảng thật, endpoint Exclusive/alignment, fade drain hai event, endpoint transaction |
| M3 | `24dd06e` | Source-preserving decoder, format theo bài, prepare precision boundary, mode command/recovery |
| Sửa native | `8455605` | EOF Exclusive drain trước ended; fallback recovery Shared |
| M5 | `3569737` | Validation, persistence, rehydrate paused, IPC/engine/PlayerService, Settings/signal path, unit tests |
| Sửa fade đã duyệt | `93531e0` | Tách hạn submit/drain; timestamp atomic sau ReleaseBuffer, không thêm lock/allocation/string vào render |
| M6 | Commit bàn giao chứa báo cáo này | Scripts kiểm tra, README, trạng thái mốc, raw evidence và checklist |

Các file native: `audio_host.cpp`, `audio_host.h`, `decoder.cpp`, `exclusive_format.h`, `main.cpp`, `tests/native_tests.cpp`, `README.md` trong `native/audio-host/`.

Electron: `electron/ipc/{ipc-validation,register-ipc,settings-validation}.ts`, `electron/preload.cts`, `electron/services/{audio-host,database}.service.ts`. Database chỉ đổi defaults/normalization, không đổi schema.

Renderer: `src/app/core/contracts/playback-engine.contract.ts`, `core/desktop/{desktop-api,native-audio-playback.engine,switching-playback.engine}.ts`, `core/mock/mock-settings.gateway.ts`, `core/models/{audio-output,playback,settings}.model.ts`, `core/player/player.service.ts`; ba file Settings và ba file signal-path. Unit renderer: `tests/exclusive-output.spec.mts`.

M6: `scripts/integration-audio-host-codecs.mjs`, `scripts/stress-audio-host.mjs`, `scripts/ui-sweep.cjs`, `scripts/capture-exclusive-settings.cjs`; `docs/AUDIO_ENGINE_PHASE5_PLAN.md` và báo cáo này. Không thêm dependency/token.

## Kết quả thực tế

Các kiểm tra được người dùng cho phép. Audio luôn muted, không bật `LUTSRA_STRESS_AUDIBLE`. Các lượt Exclusive đã chiếm TE-C thực tế, tạm thời chặn ứng dụng khác dùng endpoint này. Host đã dừng sau kiểm tra.

| Kiểm tra | Kết quả | Raw log |
|---|---|---|
| Angular build | Đạt | [angular-build-final.log](../artifacts/phase5/angular-build-final.log) |
| Vitest | 10 file, 143 test đạt | [vitest-final.log](../artifacts/phase5/vitest-final.log) |
| Electron build | Đạt | [electron-build-final.log](../artifacts/phase5/electron-build-final.log) |
| Audio Host build sau sửa fade | Đạt, 10 warning/0 error | [audio-host-build-fade.log](../artifacts/phase5/audio-host-build-fade.log) |
| Native unit sau sửa fade | Exit 0; incremental 0 warning/0 error | [test-audio-host-split-deadline.log](../artifacts/phase5/test-audio-host-split-deadline.log) |
| Smoke | 3 endpoint | [test-audio-host-smoke-final.log](../artifacts/phase5/test-audio-host-smoke-final.log) |
| Codecs sau sửa fade | Đạt, sáu codecs, 11 trường hợp fade có 0 timeout | [test-audio-host-codecs-split-deadline.log](../artifacts/phase5/test-audio-host-codecs-split-deadline.log) |
| Stress sau sửa fade | Đạt 605/605 response, 10 endpoint + 10 mode switch | [test-audio-host-stress-split-deadline.log](../artifacts/phase5/test-audio-host-stress-split-deadline.log) |
| UI sweep xác nhận | 0 flagged pages | [ui-sweep-final.log](../artifacts/phase5/ui-sweep-final.log) |
| Settings capture | 12 ảnh | [settings-capture-final.log](../artifacts/phase5/settings-capture-final.log) |

Trích output thật của Vitest và stress:

```text
Test Files  10 passed (10)
     Tests  143 passed (143)
```

```json
{"requests":605,"responses":605,"endpointSwitches":10,"exclusiveModeSwitches":10,"muted":true}
```

Codecs sau sửa fade đi qua source-rate, prepare 16 → 24 bit cùng rate trên TE-C trả false, gapless/crossfade cùng format, EOF drain và lỗi khác endpoint vẫn phát phiên cũ. Sáu codecs: wav 44.1 kHz/16 bit, flac 96 kHz/16 bit, mp3 44.1 kHz/24 bit, m4a 48 kHz/16 bit, ogg và opus 48 kHz/24 bit. Tất cả output integer, không resample; `deviceFormat` null.

Nguyên nhân lỗi đã sửa: Pause đến giữa các hardware event có thể phải chờ gần một period để submit fade, rồi hai period nữa để drain. Ở 80 ms, tổng gần 240 ms vượt hạn cũ 190 ms tính từ yêu cầu. Log lỗi được giữ tại [test-audio-host-codecs-deadline-failure.log](../artifacts/phase5/test-audio-host-codecs-deadline-failure.log). Điểm bắt đầu hạn drain đã đổi theo chấp thuận của chủ dự án. Không dùng mailbox wake giả để tăng bộ đếm.

Kết quả fade thật từ log xác nhận (elapsed gồm IPC):

| Period yêu cầu/thực tế (ms) | Delay trước Pause (ms) | Elapsed (ms) | Timeouts |
|---|---|---|---|
| 10/10 | 200 | 31 | 0 |
| 20/20 | 200 | 65 | 0 |
| 40/40 | 200 | 124 | 0 |
| 80/80 | 0 | 248 | 0 |
| 80/80 | 20 | 231 | 0 |
| 80/80 | 40 | 204 | 0 |
| 80/80 | 60 | 245 | 0 |
| 80/80 | 80 | 250 | 0 |
| 80/80 | 120 | 216 | 0 |
| 80/80 | 160 | 252 | 0 |
| 80/80 | 200 | 204 | 0 |

Unit bao phủ ma trận TE-C/Realtek, chuyển rate/thiếu ứng viên, precision boundary và hai-event drain; renderer tests bao phủ validation, persistence/defaults, thứ tự rehydrate, position snapshot, lỗi live host, giữ mode khi chọn output, Chromium notice và xử lý lỗi đổi mode. Những test này không thay thế nghiệm thu hardware unplug/sleep/crash thật.

## UI và screenshots

Sweep mọi route × 3 layout × 2 theme × 1440/560: lượt xác nhận 0 flag, 132 cấu hình trang, 99 PNG. Lượt đầu có một flag Settings Ambient light trong lúc HMR; đã giữ log đầu và xác nhận lại trên server ổn định/profile riêng. Không kết luận chắc nguyên nhân chỉ từ lượt đó. Probe có style tắt transition. Dev server đã dừng, port 4315 không còn listen.

Settings screenshots dùng native-status fixtures, không thực sự thay mode hay phát audio; chứng minh UI Shared/Exclusive. Đã xem trực tiếp mẫu Gallery light Exclusive, Console dark Shared và Ambient Shared/Exclusive.

| Layout/theme | Shared | Exclusive |
|---|---|---|
| Gallery light | [Ảnh](../artifacts/phase5/settings/inset-light-shared.png) | [Ảnh](../artifacts/phase5/settings/inset-light-exclusive-dsp.png) |
| Gallery dark | [Ảnh](../artifacts/phase5/settings/inset-dark-shared.png) | [Ảnh](../artifacts/phase5/settings/inset-dark-exclusive-dsp.png) |
| Console light | [Ảnh](../artifacts/phase5/settings/classic-light-shared.png) | [Ảnh](../artifacts/phase5/settings/classic-light-exclusive-dsp.png) |
| Console dark | [Ảnh](../artifacts/phase5/settings/classic-dark-shared.png) | [Ảnh](../artifacts/phase5/settings/classic-dark-exclusive-dsp.png) |
| Ambient light | [Ảnh](../artifacts/phase5/settings/liquid-glass-light-shared.png) | [Ảnh](../artifacts/phase5/settings/liquid-glass-light-exclusive-dsp.png) |
| Ambient dark | [Ảnh](../artifacts/phase5/settings/liquid-glass-dark-shared.png) | [Ảnh](../artifacts/phase5/settings/liquid-glass-dark-exclusive-dsp.png) |

Logs, fixtures và screenshots giữ ở worktree; không commit profile/cache/media sinh ra.

## Checklist mục 7 và giới hạn

| Tiêu chí | Bằng chứng / việc còn lại |
|---|---|
| 44.1/48/96 kHz theo nguồn, không resample | Status muted đạt; đèn DAC cần chủ dự án xem |
| Audio hệ thống không chen TE-C | Chưa thử nghe thủ công |
| foobar giữ TE-C: busy + paused, Play sau khi đóng | Chưa thực hiện giữ endpoint bằng ứng dụng ngoài |
| Tắt quyền Windows Exclusive | Chưa đổi quyền hệ thống để thử |
| Không click khi pause/chuyển rate/mode | Chưa nghe; fade muted cả bốn period và tám pha 80 ms đạt |
| Pause/resume không nhảy vị trí | Kiểm tra snapshot/decoder muted; cần nghiệm thu bằng tai |
| Quét thư viện Shared, underruns = 0 | Chưa kiểm tra đồng thời scan thực tế |
| Gapless cùng format | Native muted đạt ở lượt codecs; precision/rate boundary trả false |
| Rút/cắm TE-C và fallback Shared paused | Đường code đã triển khai; chưa rút/cắm vật lý |
| Host crash khôi phục Exclusive paused đúng vị trí | Service unit đạt; chưa kill/crash app thực tế |
| M1 integer round-trip | Native unit exit 0 |
| Đóng/mở app nhớ mode/buffer | DB normalization/persistence unit đạt; chưa vòng đời desktop thực tế |

Sleep/resume vật lý và lỗi Exclusive → Shared với driver thực cũng chưa được gây ra. HM-805 chưa kết nối, không xác nhận support. `bitPerfectEligible` luôn false; `kFormatSwitchPrerollMs = 0`, chỉ đổi sau bằng chứng nghe. Chưa có bug ngoài phạm vi mới được xác nhận; compiler warnings đã lưu trong log. Sai lệch so với bản kế hoạch đầu: tách hạn submit/drain theo chấp thuận bổ sung của chủ dự án, thêm EOF drain để không cắt đuôi khi renderer load rate kế, và screenshot dùng status fixtures. Không coi các phần nghiệm thu thủ công chưa thực hiện là đạt.
