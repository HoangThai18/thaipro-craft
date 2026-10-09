# CapCut: bộ tính năng thu thập bằng REA

Nguồn: quét thụ động bản web CapCut bằng REA (`capture_browser_scenario`, Chrome
headless, profile tạm riêng của REA), đọc cây accessibility. Không suy đoán.

- https://www.capcut.com/
- https://www.capcut.com/creative-suite  (CapCut Online)
- https://www.capcut.com/tools/desktop-video-editor

Mã bằng chứng REA: `ev_568e116596f9e1be67117117af4f7dd8db3dcfb883a2086dec1f95260599184c`
(lượt chạy đầu tiên) và các lượt sau trong cùng phiên.

## 1. Trang công cụ CapCut công bố (`/tools/`)

Đây là danh sách CapCut tự quảng cáo, nên là mặt bằng tối thiểu phải có:

| Trang | Tính năng tương ứng | Trạng thái OpenCutCut |
|---|---|---|
| `/tools/green-screen-editor` | Nền xanh | ✅ F1 |
| `/tools/keyframe-animation` | Keyframe | ✅ nhiều mục |
| `/tools/motion-tracking` | Theo dõi chuyển động | ❌ **chưa có — thêm mục K9** |
| `/tools/remove-background-noise-from-audio` | Khử tiếng ồn | ❌ H6 |
| `/tools/video-cropper` | Cắt và thu phóng video | 🟡 E1/F1 |
| `/tools/video-resizer` | Đổi kích thước | ✅ I6 một phần |
| `/tools/video-translator` | Dịch phụ đề | ❌ G8 |
| `/tools/vocal-remover` | Tách lời hát khỏi nền | ❌ H8 |
| `/tools/voice-enhancer` | Tăng chất giọng nói | ❌ **chưa có — thêm mục H11** |
| `/tools/voice-recorder` | Ghi âm trực tiếp | ❌ H5 |

## 2. Trang tạo video nhanh (`/create/`)

CapCut có cả các luồng tạo nhanh, mỗi luồng là một quy trình dựng sẵn:

`animation-maker`, `boomerang-video`, `credits-maker`,
`educational-video`, `reddit-video-maker`, `stop-motion-video`,
`tiktok-video-editor`, `time-lapse-video-maker`, `video-montage`

OpenCutCut chưa có luồng nào kiểu này → thêm mục J5 (quy trình dựng sẵn).

## 3. Trang hướng dẫn (`/resource/`) — chứng minh tính năng ẩn

Trang hướng dẫn phản ánh thứ người dùng thật sự hỏi, tức là tính năng có thật:

- `capcut-3d-zoom` → đã có (D1 3D Zoom)
- `how-to-change-background-color` → đổi màu nền, nhắm mặt nạ
- `remove-subtitles-from-video` → CapCut **có gắn phụ đề tự động**, nên G6 là gap thật
- `convert-youtube-video-to-mp4`, `youtube-to-mp3-converter` → CapCut làm được tải và xuất; mục H9, I10 còn thiếu

## 4. Tích hợp bên ngoài (chân trang)

CapCut nối với: TikTok, YouTube, Instagram, SoundOn (nhạc), shop.tiktok.com.

Điều này xác nhận **M1–M4 không phải tính năng xa xôi** — phần nhạc (SoundOn) và
phần đăng mạng xã hội là có thật, cần quyết định có làm bản ngoại tuyến tương đương
hay không.

## 5. Sản phẩm anh em (không nhắm tới)

CapCut Desktop, CapCut Online, CapCut Pad, CapCut Mobile, Plugin (CapCut × Codex),
Dreamina AI, Pippit AI, Hypic (sửa ảnh AI). OpenCutCut chỉ tương đương CapCut
Desktop/Online, không nhắm các sản phẩm còn lại.

## 6. Những gì KHÔNG thu được được

Quyết định rõ để khỏ tưởng checklist đã đầy đủ:

- **Chưa vào được bộ sửa.** Editor cần đăng nhập, REA không có tài khoản. Vậy
  kho hiệu ứng, chuyển cảnh, hoạt ảnh chữ **chưa đếm được số lượng thật**.
- **Số lượng hiệu ứng thật vẫn chưa biết**, chỉ biết 31 của ta chưa đủ.
- **Kho nhạc, nhãn dán, font** chưa thể liệt kê vì là dữ liệu nền tảng.

Bước tiếp theo nếu cần đếm chính xác: dùng Google tra cứu trang "CapCut effects
list" hoặc "CapCut transitions list", hoặc mở bộ sửa CapCut trên máy
(`capcut.com/desktop` có bản Mac) và REA dùng `inspect_web_page` trên tiến trình
còn chạy — nhưng cần bạn tự đăng nhập.
