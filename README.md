# thaipro-craft

Bản custom của ba app mã nguồn mở, phát hành tại [thaipro.store/phan-mem](https://thaipro.store/phan-mem):

- **PhotoCraft** (sửa ảnh) và **PrintCraft** (PDF) của đội [ArtCraft](https://getartcraft.com), cho Windows và Mac.
- **ThaiCutCut**, dựa trên [OpenCut](https://github.com/opencut-app/opencut) (trình chỉnh sửa video).

Nguyên tắc: **không bao giờ sửa trực tiếp mã của họ**. Mã gốc nằm nguyên trong `upstream/`, mọi tuỳ biến nằm riêng ngoài đó. Nhờ vậy khi upstream ra bản mới, bạn chỉ việc nâng base rồi build lại, giống cách làm với Odoo.

## Cấu trúc

```
upstream/photocraft/     submodule → HoangThai18/photocraft (bản sao nhánh main của storytold/photocraft)
upstream/printcraft/     submodule → HoangThai18/printcraft (bản sao nhánh main của storytold/printcraft)
upstream/opencut/        submodule → HoangThai18/OpenCut (bản sao nhánh main của opencut-app/opencut)
apps/<app>/app.env       cấu hình từng app (kho gốc, kho bản sao, phiên bản craft-fonts)
apps/<app>/patches/      patch tuỳ biến (*.patch), áp theo thứ tự tên file
apps/<app>/overlay/      file thêm hoặc thay (icon, wxs, Info.plist, ...), chép đè lên sau khi áp patch
scripts/prepare.sh       tạo build/<app>: bản sao sạch của base + patch + overlay
scripts/sync-upstream.sh đồng bộ bản sao với upstream main, nâng base, thử áp lại patch
scripts/third-party-licenses.py  sinh danh sách giấy phép bên thứ ba (kèm nguyên văn bản quyền của base)
scripts/refresh-opencut.sh       làm mới file khoá JS và danh sách giấy phép của ThaiCutCut sau khi nâng base
.github/workflows/       build.yml (build Windows + Mac + Release nháp), upstream-check.yml (báo upstream có bản mới)
```

`upstream/` chỉ đọc: không áp patch, không build tại chỗ. `prepare.sh` xuất base ra `build/<app>` (thư mục này bị git bỏ qua) rồi mới sửa trên bản sao đó.

## Build

```sh
git clone --recurse-submodules https://github.com/HoangThai18/thaipro-craft
scripts/prepare.sh printcraft      # tạo build/printcraft
```

Bản Windows (`.msi`, `.zip`) và Mac (`.dmg`) build trên GitHub Actions bằng chính script đóng gói của upstream: **Actions > Build > Run workflow**, chọn app và có tạo Release nháp hay không. Release nháp có tên `<app>-<phiên bản>-<commit upstream>`; kiểm tra rồi bấm Publish để trang tải cập nhật.

## ThaiCutCut (OpenCut)

Base là bản **viết lại** `opencut-app/opencut`, hiện còn rất sơ khai: web chỉ có trang "hello world" và `/editor` ghi "Coming soon", bản desktop chỉ mở một cửa sổ. Bản `opencut-classic` dùng được nhưng đã lưu trữ, không chọn. Khi upstream có trình chỉnh sửa thật thì nâng base là có ngay.

- `apps/opencut/patches/0001-rebrand-thaicutcut.patch` đổi tên hiển thị, gỡ cấu hình trỏ tới domain của OpenCut.
- `apps/opencut/overlay/brand/` logo ThaiCutCut (thay các dấu hiệu OpenCut), `apps/web/public/` favicon và icon.
- `apps/opencut/overlay/apps/web/bun.lock` ghim phiên bản thư viện web (upstream để `latest`, không có file khoá).
- `LICENSE` của upstream giữ nguyên văn ("Copyright 2026 OpenCut", MIT) và được chép kèm trong mọi bản build; `THIRD_PARTY_LICENSES.md` liệt kê thư viện đi kèm và gắn cờ các giấy phép cần chú ý (LGPL, MPL).
- Workflow **Build ThaiCutCut** build web (và bản desktop nếu bật) và đóng kèm các thông báo giấy phép.

Nâng base: `scripts/sync-upstream.sh opencut`, rồi `scripts/refresh-opencut.sh`, xem `git diff --stat apps/opencut` và commit.

## Ký số

Chưa có chứng chỉ: file Windows không ký số (SmartScreen cảnh báo), file Mac ký ad-hoc và chưa notarize (Gatekeeper yêu cầu "Vẫn mở").

## Nâng base khi upstream ra bản mới

```sh
scripts/sync-upstream.sh printcraft   # đồng bộ bản sao, nâng con trỏ, thử áp lại patch
git add upstream/printcraft
git commit -m "Base PrintCraft: nâng lên upstream main <sha>"
```

- Patch áp được thì xong, chạy lại workflow Build.
- Upstream đã tự có thay đổi của patch thì `prepare.sh` bỏ qua patch đó (`skipped`), có thể xoá patch.
- Patch không áp được thì `prepare.sh` dừng, nêu đúng patch lỗi. Chỉ sửa patch đó.
- Workflow **Upstream check** chạy mỗi thứ Hai, mở một issue nếu upstream đi trước base và cho biết patch còn áp được không.

Muốn ghim base vào một bản phát hành thay vì `main`, checkout tag trong submodule (`git -C upstream/printcraft checkout v0.2.1`) rồi commit con trỏ.

## Viết patch

```sh
PREPARE_COMMITS=1 scripts/prepare.sh printcraft
cd build/printcraft            # repo git riêng, sửa thoải mái
# ...sửa file...
git diff > ../../apps/printcraft/patches/0002-ten-patch.patch
```

`PREPARE_COMMITS=1` ghi hai commit (base sạch, rồi patch + overlay hiện có) nên `git diff` chỉ ra phần bạn vừa sửa. `git diff HEAD~1` ra toàn bộ tuỳ biến so với base.

Giữ mỗi patch nhỏ và một mục đích; càng ít dòng vá càng ít xung đột khi nâng base. Thêm file mới (icon, cấu hình) thì đặt vào `overlay/` thay vì patch.

## Giấy phép và thương hiệu

Mã gốc theo MIT hoặc Apache-2.0. Tên và logo ArtCraft **không** thuộc giấy phép đó (xem `docs/brand/LICENSE-brand.txt` trong mỗi app): bản đã sửa đổi phải gỡ hoặc thay các dấu hiệu này, không được tự nhận là sản phẩm của ArtCraft, chỉ được ghi bằng chữ thường rằng bản này dựa trên app của đội ArtCraft.
