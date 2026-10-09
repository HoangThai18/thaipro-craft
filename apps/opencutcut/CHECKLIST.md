# Checklist tính năng OpenCutCut so với CapCut

Cập nhật: 08/10/2026. Trạng thái lấy bằng cách đọc mã trong `desktop/src/` và
`desktop/src-tauri/src/lib.rs` (không phải đoán, không phải hỏi).

Ký hiệu: ✅ có · 🟡 mới có một phần · ❌ chưa có · ❓ chưa xác minh

Đáng tin ở mức nào: chứng minh đọc được **chỉ kiểm chứng được mức "có"**. Các mục
❌ được đánh dấu sau khi không thấy từ khoá tương ứng trong mã; điều đó nói "không
thấy bằng cách này", không nói "chắc chắn không có". Mục nào đổi thành ✅ thì
phải ghi kèm bằng chứng (tên hàm hoặc tên bảng giao diện).

Vòng lặp tự động chỉ chạy tới khi hết mục ❌ 🟡 ❓. Thêm mục mới: thêm dòng `❌`.

---

## A. Nhập và quản lý phương tiện

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| A1 | Nhập video/ảnh/nhạc từ máy | ✅ | bảng "Phương tiện" |
| A2 | Ảnh nhỏ clip trên dòng thời | ✅ | `clip_thumbnails` |
| A3 | Dòng thời nhiều lớp, kéo thả, bám mép | ✅ | `timeline.ts`, `snap` |
| A4 | Cắt / tách / chỉnh đầu cuối clip | ✅ | `split`/`trim` |
| A5 | Lịch sử chỉnh sửa, hoàn tác/làm lại | ✅ | `history.ts` |
| A6 | Zoom dòng thời, con trỏ phát | ✅ | `playhead`, `zoom` |
| A7 | Bản nháp tự lưu khi mất điện | ✅ | `draft_path` + `ghiBanNhap`, thanh "Có bản nháp từ lần trước" |
| A8 | Ghép nhiều dự án | ✅ | nút "Ghép" + `noiDuAn` |
| A9 | Danh sách dự án mở gần đây | ✅ | `recent_projects`/`recent_push`, menu "Mở ▾" |
| A10 | Kéo thả file từ máy vào cửa sổ | ✅ | bảng "Phương tiện" |
| A11 | Thư mục/tìm kiếm trong danh sách phương tiện nhiều | ✅ | ô "Tìm trong thư viện" + `hienThi` |
| A12 | Ghim tài nguyên hay dùng nhiều | ✅ | nút ★ trên ô media, `pinned` |

## B. Tốc độ và thời gian

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| B1 | Tốc độ clip (0.1x–10x), giữ cao độ | ✅ | `atempo_chain`, `speed` |
| B2 | Đảo ngược clip | ✅ | `reverse` |
| B3 | Khung hình đứng yên (freeze frame) | ✅ | `clip.freeze` + `tpad=clone`, nút trên thanh công cụ, test `khung_hinh_dung_yen_giu_mot_khung_va_giu_tien` |
| B4 | Lặp một đoạn | ✅ | `lapLai` + nút "Lặp" kèm ô số lần |
| B5 | Tốc độ theo đường cong (montay, bullet, hero) | ✅ | keyframe `speed`, 7 mẫu sẵn (Montage, Bullet, Hero…), `setpts` giải nghịch đường cong, test `duong_cong_toc_do_*` |
| B6 | Tỷ lệ giảm tốc kèm mượt (nội suy khung) | ✅ | `clip.smooth` + `minterpolate`, ô "Nội suy khung", test `noi_suy_khung_khong_con_khung_lap` |
| B7 | Xoay/lật clip | ✅ | `rotate`/`xoay` |

## C. Chuyển cảnh

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| C1 | 24 chuyển cảnh cơ bản | ✅ | `transition_kind` |
| C2 | Chuyển cảnh có keyframe | ✅ | `bieu_thuc_theo_lat` + `ap_keyframe_hinh_anh`, ô "Keyframe trong chuyển cảnh", test `keyframe_hinh_anh_*` |
| C3 | Chỉnh được độ dài chuyển cảnh | ✅ | `transition_duration` |
| C4 | Áp chuyển cảnh cho tất cả mối nối một lần | ✅ | `mocNoiKeNhau` + `apChuyenCanhMoiNoi`, khối "Áp cho mọi mối nối (n)" |
| C5 | Chuyển cảnh loại mặt nạ, wiggle, mờ | ✅ | 52 loại (thêm Mờ hình/xám/nhanh/chậm, Gió, Che/Lộ, Cắt dải, Bóp, Thu vào), test `moi_loai_chuyen_canh_trong_bang_deu_chay_duoc`. Wiggle để ở kho hiệu ứng (D4) |

## D. Hiệu ứng video

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| D1 | Kho hiệu ứng, chia 7 nhóm | ✅ | `effects.ts`, 31 hiệu ứng |
| D2 | Xem trước hiệu ứng | ✅ | nền CSS `mau` |
| D3 | Mức mạnh vừa/mạnh cho hiệu ứng | ✅ | `ffmpegManh` |
| D4 | Số lượng hiệu ứng ngang CapCut | 🟡 | 31, CapCut hàng trăm |
| D5 | Ghi nhớ hiệu ứng vừa dùng | ✅ | Nhóm "Vừa dùng" trong panel Hiệu ứng, lưu 8 mục gần nhất vào bộ nhớ tạm |
| D6 | Tìm kiếm hiệu ứng theo tên | ✅ | Ô "Tìm hiệu ứng" lọc theo tên, nhóm và mô tả |

## E. Màu và bộ lọc

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| E1 | Điều chỉnh thông số | ✅ | bảng "Điều chỉnh" |
| E2 | Đường cong màu (curves) | ✅ | bảng "Đường cong" |
| E3 | LUT | ✅ | bảng "LUT" |
| E4 | Bộ lọc màu | ✅ | bảng "Bộ lọc" |
| E5 | Tách nền AI | ❌ | chưa có |
| E6 | Chỉnh màu theo từng dải màu (HSL) | ✅ | Bảng HSL 6 dải (sắc/bão hoà/sáng) dùng `huesaturation`, test `hsl_doi_dung_dai_mau` đo màu từng dải |
| E7 | Tự động cải thiện màu | ✅ | Nút "Cải thiện tự động" đo `signalstats` rồi bù sáng/tương phản/bão hoà, test `cai_thien_tu_dong_keo_mau_ve_gan_chuan` |
| E8 | Chỉnh độ nhạy mỗi thông số bằng kéo | ✅ | 3 mức (Rất tinh/Tinh/Thô), chọn chung hoặc riêng từng thông số; mũi tên và Shift+← → cũng nhảy đúng bước |

## F. Nền xanh, mặt nạ, hòa trộn

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| F1 | Nền xanh (chroma key) | ✅ | bảng "Nền xanh" |
| F2 | Chế độ hòa trộn (blend) | ✅ | `map_mix_mode` |
| F3 | Mặt nạ hình học (tròn, chữ nhật, gradient) | ✅ | Tròn, bầu dục, chữ nhật; chỉnh tâm, kích thước, góc xoay, mép mềm. Dựng bằng `geq` nên giữ kênh alpha cho clip. Test `mat_na_*` đo màu trong và ngoài vùng khoanh |
| F4 | Cắt hình người (chân dung) | ❌ | chưa có |
| F5 | Mặt nạ đẹp dần theo dòng thời | ✅ | Mép mặt nạ chạy theo `T`: nở ra, thu vào, quét ngang, quét dọc, chọn giây bắt đầu và độ dài. Test `mat_na_chay_theo_dong_thoi` đo cùng một điểm ở đầu và cuối clip |

## G. Văn bản

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| G1 | Thêm văn bản, đổi font, cỡ, màu | ✅ | bảng "Văn bản" |
| G2 | Keyframe cho văn bản | ✅ | `keyframe` 56 chỗ |
| G3 | Nhãn dán / sticker | 🟡 | bảng "Nhãn dán", thư viện mỏng |
| G4 | Hoạt ảnh chữ vào/ra (đánh máy, mờ dần, trượt, xoay) | ✅ | 8 kiểu trong khối "Hoạt ảnh vào" của panel Văn bản; dùng `fade`/`geq`/`rotate`/`overlay` theo biến thời gian. Test `hoat_anh_chu_vao_chay_that_khi_xuat` đếm pixel chữ ở 3 mốc thời gian |
| G5 | Văn bản theo đường cong | ❌ | không thấy |
| G6 | Phụ đề tự động từ lời nói | ❌ | không thấy `caption`/`subtitle` |
| G7 | Đổi giọng đọc (text to speech) | ❌ | chưa có |
| G8 | Dịch phụ đề sang ngôn ngữ khác | ❌ | chưa có |
| G9 | Mẫu kiểu phụ đề | ❌ | chưa có |
| G10 | Viền, bóng, nền chữ | ✅ | Nút "Aa+" mở khối viền (màu, độ dày), bóng (độ lệch, độ nhò), nền (đệm, bo góc) cho từng lớp chữ. Dựng ảnh tách sang `src/chu.ts`, test `chu.test.ts` |

## H. Âm thanh

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| H1 | Thêm nhạc, chỉnh âm lượng | ✅ | bảng "Âm thanh", `volume` |
| H2 | Vẽ sóng âm thanh | ✅ | `audio_waveform` |
| H3 | Bám nhịp (beat sync) | ✅ | `detect_beats`, `nhịp` 18 chỗ |
| H4 | Thư viện hiệu ứng âm thanh | ❌ | chưa có |
| H5 | Lời thoại (ghi âm trực tiếp) | ❌ | không thấy `voiceover` |
| H6 | Khử tiếng ồn | ❌ | không thấy `denoise` |
| H7 | Tự động hạ nhạc khi có lời thoại | ❌ | chưa có |
| H8 | Tách lời hát khỏi nền | ❌ | chưa có |
| H9 | Xuất riêng phần âm thanh | ❌ | chưa có |
| H10 | Hiệu ứng giọng nói (vọng, robot, giọng mỏng) | ❌ | chưa có |
| H11 | Tăng chất giọng nói | ❌ | CapCut có `/tools/voice-enhancer`, ta chưa có |

## I. Khung hình và xuất

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| I1 | Tỉ lệ khung hình (9:16, 1:1, 16:9, 4:5) | ✅ | `ratio` 190 chỗ |
| I2 | Xuất video qua ffmpeg | ✅ | `export_video`, 420 dòng |
| I3 | Chọn mức chất lượng | ✅ | `quality`, `preset` |
| I4 | Chọn 4K / bitrate / codec | ❌ | Rust nhắc `codec`, giao diện chưa có |
| I5 | Tự động canh khung theo người nói | ❌ | chưa có |
| I6 | Xuất ở các mức 480p/720p/1080p/2K/4K | 🟡 | mới 720/1080 thấy trong mã |
| I7 | Xuất chỉ một đoạn đang chọn | ❌ | chưa có |
| I8 | Xuất dạng GIF | ❌ | chưa có |
| I9 | Xuất phụ đề thành tệp SRT | ❌ | chưa có |
| I10 | Đổi fps, định dạng H.265/MOV | ❌ | chưa có |

## J. Dự án và mẫu

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| J1 | Lưu / mở dự án | ✅ | `save_project`, `load_project` |
| J2 | Mẫu dự án (template) | ❌ | không thấy `template` |
| J3 | Ảnh/video mẫu kèm sẵn | ❌ | chưa có |
| J4 | Chia sẻ dự án ra tệp | ❌ | chưa có |
| J5 | Quy trình dựng sẵn (dựng nhanh, chữ crédit, time-lapse) | ❌ | CapCut có 9 trang `/create/*`, ta chưa có |

## K. Tự động hoá và AI

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| K1 | Kiểm thử tự động | ✅ | `timeline.test.ts`, `#[cfg(test)]` |
| K2 | Mỗi hiệu ứng phải xuất video chạy thật | 🟡 | chưa có bài kiểm thử xuất từng hiệu ứng |
| K3 | Giao diện không vỡ khi thao tác liên tục | 🟡 | cần dò thủ công |
| K4 | Tự động cắt bỏ đoạn im lặng | ❌ | chưa có |
| K5 | Tự động cắt phim dài thành đoạn hay | ❌ | chưa có |
| K6 | Nội suy làm mượt video quay chậm | ❌ | chưa có |
| K7 | Tự tạo video từ kịch bản | ❌ | chưa có |
| K8 | Đổi giọng/khớp môi | ❌ | chưa có |
| K9 | Theo dõi chuyển động | ❌ | CapCut có `/tools/motion-tracking`, ta chưa có |

## L. Giao diện và thao tác

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| L1 | 14 bảng công cụ | ✅ | `tools[]` 14 mục |
| L2 | Tìm kiếm xuyên suốt các bảng công cụ | ❌ | chưa có |
| L3 | Bảng lịch sử thao tác dạng danh sách | 🟡 | chỉ có hoàn tác/làm lại |
| L4 | Menu chuột phải trên clip và dòng thời | 🟡 | cần kiểm |
| L5 | Phím tắt đầy đủ (JKL, IO, ,. S, +-) | ❌ | không thấy hệ thống phím tắt |
| L6 | Bảng hướng dẫn phím tắt | ❌ | chưa có |
| L7 | Đổi cỡ panel, thu gõ panel | ❌ | chưa có |
| L8 | Đánh dấu điểm nhớ trên dòng thời | ❌ | chưa có |
| L9 | Thông báo cho mỗi thao tác | 🟡 | có thông báo hệ thống |
| L10 | Giao diện nhiều ngôn ngữ | ❌ | chỉ có tiếng Việt |
| L11 | Cửa sổ nhỏ không vỡ giao diện | ❌ | chưa có |
| L12 | Chuyển chất lượng xem trước để bớt nặng | ❌ | chưa có |

## M. Ghi chú CapCut chưa rõ có nên làm

Các tính năng đặc thù nền tảng của CapCut, cần quyết định trước khi làm vì có
thể không áp dụng được với app offline: nhạc/thư viện có bản quyền, mẫu trending
trực tuyến, đồng bộ đám mây, đăng trực tiếp lên mạng xã hội, gói trả phí.

| # | Tính năng | Trạng thái | Bằng chứng |
|---|---|---|---|
| M1 | Thư viện nhạc có bản quyền | ❌ | ngoại tuyến, cần quyết |
| M2 | Mẫu trending lấy trực tuyến | ❌ | ngoại tuyến, cần quyết |
| M3 | Đồng bộ dự án trên đám mây | ❌ | ngoại tuyến, cần quyết |
| M4 | Đăng thẳng lên mạng xã hội | ❌ | ngoại tuyến, cần quyết |

## Cách cập nhật

Khi làm xong một mục: sửa cột Trạng thái từ ❌/🟡/❓ sang ✅, và ghi bằng chứng
(tên hàm, bảng giao diện, hoặc tệp kiểm thử). Không đổi sang ✅ nếu không có
bằng chứng — mục ✅ không bằng chứng sẽ được đọc lại coi như chưa làm.

Mục nào lấy từ bản web CapCut thì tra `CAPCUT-THAM-CHIEU.md` xem nguồn. Mục lấy
theo suy đoán của mình thì ghi rõ là suy đoán, đừng ghi như đã xác nhận.
