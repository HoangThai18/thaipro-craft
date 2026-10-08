# Checklists tính năng OpenCutCut so với CapCut

Cập nhật lần cuối: 08/10/2026. Khảo sát bằng cách đọc mã trong
`desktop/src/` và `desktop/src-tauri/src/lib.rs`.

Ký hiệu: ✅ có · 🟡 mới có một phần · ❌ chưa có

Vòng lặp tự động chỉ chạy tới khi **hết mục ❌ và mọi 🟡 lên ✅**.

## A. Phương tiện và dòng thời

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| A1 | Nhập video/ảnh/nhạc | ✅ | bảng "Phương tiện" |
| A2 | Ảnh nhỏ clip trên dòng thời | ✅ | `clip_thumbnails` |
| A3 | Dòng thời nhiều lớp, kéo thả, bám mép | ✅ | `timeline.ts`, `snap` |
| A4 | Cắt / tách / chỉnh đầu cuối clip | ✅ | `split`/`trim`, 33 chỗ |
| A5 | Lịch sử chỉnh sửa, hoàn tác/làm lại | ✅ | `history.ts` |
| A6 | Zoom dòng thời, con trỏ phát | ✅ | `playhead`, `zoom` |
| A7 | Bản nháp tự lưu khi mất điện | ❌ | chưa có ghi tự động |
| A8 | Ghép nhiều dự án | ❌ | chưa có |

## B. Tốc độ và thời gian

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| B1 | Tốc độ clip (0.1x–10x), giữ cao độ | ✅ | `atempo_chain`, `speed` |
| B2 | Đảo ngược clip | ✅ | `reverse` |
| B3 | Khung hình đứng yên (freeze frame) | ❌ | chưa có |
| B4 | Lặp một đoạn | 🟡 | Rust có `loop`, chưa thấy ở giao diện |

## C. Chuyển cảnh

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| C1 | 24 chuyển cảnh cơ bản | ✅ | `transition_kind` |
| C2 | Chuyển cảnh có keyframe | ❌ | chưa có |
| C3 | Thư viện chuyển cảnh rút gọn theo video | ❌ | chưa có |

## D. Hiệu ứng video

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| D1 | Kho hiệu ứng, chia 7 nhóm | ✅ | `effects.ts`, 31 hiệu ứng |
| D2 | Xem trước hiệu ứng | ✅ | nền CSS `mau` |
| D3 | Mức mạnh vừa/mạnh cho hiệu ứng | ✅ | `ffmpegManh` |
| D4 | Số lượng hiệu ứng ngang CapCut | 🟡 | CapCut hàng trăm, hiện có 31 |

## E. Màu và bộ lọc

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| E1 | Điều chỉnh thông số | ✅ | bảng "Điều chỉnh" |
| E2 | Đường cong màu (curves) | ✅ | bảng "Đường cong" |
| E3 | LUT | ✅ | bảng "LUT" |
| E4 | Bộ lọc màu | ✅ | bảng "Bộ lọc" |
| E5 | Tách nền AI | ❌ | chưa có |

## F. Nền xanh, mặt nạ, hòa trộn

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| F1 | Nền xanh (chroma key) | ✅ | bảng "Nền xanh" |
| F2 | Chế độ hòa trộn (blend) | ✅ | `map_mix_mode` |
| F3 | Mặt nạ hình học | ❌ | chưa có |
| F4 | Cắt hình người (chân dung) | ❌ | chưa có |

## G. Văn bản và trang trí

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| G1 | Thêm văn bản, đổi font, cỡ, màu | ✅ | bảng "Văn bản" |
| G2 | Keyframe cho văn bản | ✅ | `keyframe` 56 chỗ |
| G3 | Nhãn dán / sticker | 🟡 | bảng "Nhãn dán", thư viện mỏng |
| G4 | Hoạt ảnh chữ (kiểu đánh máy, nở dần) | ❌ | chưa có |
| G5 | Văn bản theo đường cong | ❌ | chưa có |
| G6 | Phụ đề tự động từ lời nói | ❌ | chưa có |

## H. Âm thanh

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| H1 | Thêm nhạc, chỉnh âm lượng | ✅ | bảng "Âm thanh", `volume` |
| H2 | Vẽ sóng âm thanh | ✅ | `audio_waveform` |
| H3 | Bám nhịp (beat sync) | ✅ | `detect_beats`, `nhịp` 18 chỗ |
| H4 | Thư viện hiệu ứng âm thanh | ❌ | chưa có |
| H5 | Lời thoại (ghi âm trực tiếp) | ❌ | chưa có |
| H6 | Khử tiếng ồn | ❌ | chưa có |
| H7 | Tự động hạ nhạc khi có lời thoại | ❌ | chưa có |

## I. Khung hình và xuất

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| I1 | Tỉ lệ khung hình (9:16, 1:1, 16:9, 4:5) | ✅ | `ratio` 190 chỗ |
| I2 | Xuất video qua ffmpeg | ✅ | `export_video`, 420 dòng |
| I3 | Chọn mức chất lượng | ✅ | `quality`, `preset` |
| I4 | Chọn 4K / bitrate / codec | ❌ | Rust nhắc `codec`, giao diện chưa có |
| I5 | Tự động canh khung theo người nói | ❌ | chưa có |

## J. Dự án và mẫu

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| J1 | Lưu / mở dự án | ✅ | `save_project`, `load_project` |
| J2 | Mẫu dự án (template) | ❌ | chưa có |

## K. Độ ổn định

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| K1 | Kiểm thử tự động | ✅ | `timeline.test.ts`, `#[cfg(test)]` |
| K2 | Mọi hiệu ứng phải xuất video chạy thật | 🟡 | chưa có bài kiểm thử xuất từng hiệu ứng |
| K3 | Giao diện không vỡ khi thao tác liên tục | 🟡 | cần dò thủ công |

## Cách dùng

Watchdog đọc file này để biết còn mục nào chưa xong, rồi giao tiếp cho
session tiếp tục làm tới khi cạn. Thêm mục mới bằng cách thêm dòng `❌`.

Cột "Bằng chứng" ghi tên hàm hoặc bảng giao diện đã kiểm chứng bằng cách đọc
mã, không phải phỏng đoán. Mục nào đánh dấu `✅` mà không có bằng chứng thì
coi như chưa có.
