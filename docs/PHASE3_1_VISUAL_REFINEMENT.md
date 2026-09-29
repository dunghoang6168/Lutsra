# Phase 3.1 — Visual refinement

> Tài liệu này ghi lại brief và baseline của Phase 3.1. Trạng thái sản phẩm hiện tại và kết quả kiểm thử 0.2.2 nằm trong [README](../README.md); các ràng buộc trong brief có thể đã được thay đổi ở những phase sau.

## Mục tiêu

Phase 3 đã hoàn thành nền tảng giao diện, theme persistence và icon abstraction. Phase 3.1 chỉ tinh chỉnh cách trình bày để Lutsra có cảm giác gọn, cân đối và phù hợp với desktop music library hơn. Playback, queue behavior, Electron IPC, database, scanner và public contracts không thay đổi.

Hướng hình ảnh chính là **desktop library hiện đại, mật độ vừa phải**, lấy Feishin làm tham khảo cấu trúc. Musicat, Tauon và Harmonoid chỉ bổ sung các pattern phù hợp; không sao chép source code, icon hay asset của các dự án này.

## Nguồn tham khảo

| Dự án | Điểm nên tham khảo | Điểm không đưa vào | License và lưu ý |
| --- | --- | --- | --- |
| [Feishin](https://github.com/jeffvli/feishin) | Shell desktop rõ ràng, sidebar gọn, library hierarchy, album detail và player cố định | Tính năng server, lyrics và mức độ tùy biến ngoài V1 | GPL-3.0; chỉ tham khảo bố cục và hành vi trực quan |
| [Musicat](https://github.com/basharovV/musicat) | Cách ưu tiên local library, queue, metadata và mật độ bảng | Tag editor, map, stats, waveform và smart playlists | GPL-3.0; không lấy code hoặc asset |
| [Tauon](https://github.com/Taiko2k/Tauon) | Quan hệ giữa artwork, danh sách phát và Now Playing; cách tạo điểm nhấn từ artwork | Visualizer, widget tùy biến và hiệu ứng nền phức tạp | GPL-3.0; chỉ dùng làm đối chiếu thị giác |
| [Harmonoid](https://github.com/harmonoid/harmonoid) | Tính nhất quán của spacing, alignment và Material-style controls | Mobile layout, animation lớn và các tính năng audio ngoài V1 | PolyForm Strict 1.0.0; tuyệt đối không sao chép code hoặc asset |

## Design brief cho Gemini

### Nguyên tắc chung

- Giữ shell hiện tại gồm sidebar, main content, queue drawer và bottom player.
- Giữ toàn bộ Angular bindings, event handlers, signals, router links và gateway calls.
- Dùng semantic tokens trong `src/styles.scss`; không hard-code màu accent trong feature component.
- Accent chỉ dùng cho primary action, active navigation, playing state và focus ring. Surface và border giữ trung tính để giao diện bớt chói.
- Hạn chế gradient, glow và glass effect. Chỉ dùng chúng cho artwork placeholder hoặc điểm nhấn có chủ đích.
- Không thêm dependency, không đổi `ThemeService` hoặc public API của `IconComponent`.

### Layout và mật độ

- Giữ sidebar rộng `240px`, collapsed `72px`, player bar cao `84px` và queue drawer rộng `340px` trên cửa sổ lớn.
- Dùng spacing scale sẵn có `4/8/12/16/24/32px`. Khoảng cách trong control là 8–12px; giữa các vùng nội dung là 16–24px.
- Page header cao gọn, title 24px, body 13–14px, metadata 12px. Không dùng quá ba cấp độ font weight trong cùng một vùng.
- Card radius ưu tiên 8–12px. Shadow nhẹ và chỉ dùng cho elevated surface, menu hoặc artwork nổi.

### Library views

- Songs là view có mật độ cao: row cao khoảng 48–52px, sticky header, artwork 36–40px và title là thông tin nổi bật nhất.
- Thứ tự ưu tiên cột: Title, Artist, Album, Duration, Codec, Sample Rate. Ở chiều rộng hẹp, ẩn lần lượt Sample Rate rồi Codec; không ép bảng làm main content tràn ngang.
- Albums dùng grid co giãn, cover vuông, title tối đa hai dòng và metadata một dòng. Quick play chỉ nổi rõ khi hover hoặc focus.
- Artists và Playlists dùng cùng rhythm, hover, empty state và card treatment với Albums.
- Folder view giữ cây filesystem là trọng tâm; giảm decoration để đường dẫn và cấp thư mục dễ quét bằng mắt.

### Player và Now Playing

- Player bar chia ba vùng: track identity, transport/timeline và volume/quality/queue. Cụm transport phải nằm đúng tâm cửa sổ, không bị độ rộng hai bên kéo lệch.
- Play/Pause là nút chính; Previous, Next, Shuffle và Repeat cùng kích thước và optical alignment. Không thay đổi logic timeline hoặc keyboard seek.
- Timeline luôn có hit area tối thiểu 16px dù track hiển thị mảnh. Hover/focus làm thumb rõ hơn nhưng không đổi layout.
- Now Playing dùng artwork và track identity làm hai điểm chính. Technical source information là vùng phụ, không cạnh tranh với title và controls.
- Quality label luôn mô tả source file; không thêm nội dung gợi ý bit-perfect hoặc output DAC.

### Icon

- Giữ một phong cách line icon 24px, stroke khoảng 1.75–2px; chỉ Play hoặc trạng thái cần nhấn mạnh mới dùng filled icon.
- Icon-only button phải giữ `aria-label`, tooltip/title hiện có và hit target tối thiểu 32px.
- Nếu thay bằng Lucide hoặc bộ khác, chỉ sửa mapping bên trong `IconComponent`; feature components tiếp tục dùng `IconName` hiện tại.

### Responsive và accessibility

- Nghiệm thu ở `1280 × 800` và `900 × 600` với sidebar, player bar và queue drawer.
- Tại 900px, ưu tiên nội dung và transport; có thể ẩn metadata kỹ thuật thứ cấp bằng CSS nhưng không ẩn thao tác playback hoặc queue.
- Không để player bar che hàng cuối, drawer che control bắt buộc hoặc focus ring bị cắt.
- Giữ keyboard navigation, visible focus, contrast đọc được và `prefers-reduced-motion` hiện có.

## Definition of Done

- Các màn hình Home, Songs, Albums, Album Detail, Artists, Artist Detail, Folders, Playlists, Playlist Detail, Now Playing và Settings dùng cùng hierarchy, spacing và interaction states.
- Cả hai theme (`dark`, `light`) không có màu chữ, border hoặc control bị mất tương phản.
- Kiểm tra mỗi theme với ít nhất một accent tối và một accent sáng trong sáu accent hiện có.
- Không có regression ở scan, playlist, queue, playback, timeline hoặc settings persistence.
- Angular tests, Electron backend tests, production build và Electron smoke test thành công.
- Người dùng nghiệm thu trực quan ở cả hai kích thước cửa sổ trước khi bắt đầu Phase 4.

Baseline khi đóng Phase 3: 59 Angular tests và 5 backend tests thành công; production build và Electron smoke test thành công. Build đang có warning không chặn vì SCSS của Settings đạt `10.71 kB`, vượt component style budget `10 kB` khoảng `712 bytes`. Khi tinh chỉnh Settings, ưu tiên tái sử dụng global primitives để đưa stylesheet về dưới budget thay vì tăng budget ngay.
