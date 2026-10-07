# thaipro-craft

Bản custom của hai app mã nguồn mở của đội [ArtCraft](https://getartcraft.com): **PhotoCraft** (sửa ảnh) và **PrintCraft** (PDF), phát hành cho Windows và Mac tại [thaipro.store/phan-mem](https://thaipro.store/phan-mem).

Nguyên tắc: **không bao giờ sửa trực tiếp mã của họ**. Mã gốc nằm nguyên trong `upstream/`, mọi tuỳ biến nằm riêng ngoài đó. Nhờ vậy khi upstream ra bản mới, bạn chỉ việc nâng base rồi build lại, giống cách làm với Odoo.

## Cấu trúc

```
upstream/photocraft/     submodule → HoangThai18/photocraft (bản sao nhánh main của storytold/photocraft)
upstream/printcraft/     submodule → HoangThai18/printcraft (bản sao nhánh main của storytold/printcraft)
apps/<app>/app.env       cấu hình từng app (kho gốc, kho bản sao, phiên bản craft-fonts)
apps/<app>/patches/      patch tuỳ biến (*.patch), áp theo thứ tự tên file
apps/<app>/overlay/      file thêm hoặc thay (icon, wxs, Info.plist, ...), chép đè lên sau khi áp patch
scripts/prepare.sh       tạo build/<app>: bản sao sạch của base + patch + overlay
scripts/sync-upstream.sh đồng bộ bản sao với upstream main, nâng base, thử áp lại patch
.github/workflows/       build.yml (build Windows + Mac + Release nháp), upstream-check.yml (báo upstream có bản mới)
```

`upstream/` chỉ đọc: không áp patch, không build tại chỗ. `prepare.sh` xuất base ra `build/<app>` (thư mục này bị git bỏ qua) rồi mới sửa trên bản sao đó.

## Build

```sh
git clone --recurse-submodules https://github.com/HoangThai18/thaipro-craft
scripts/prepare.sh printcraft      # tạo build/printcraft
```

Bản Windows (`.msi`, `.zip`) và Mac (`.dmg`) build trên GitHub Actions bằng chính script đóng gói của upstream: **Actions > Build > Run workflow**, chọn app và có tạo Release nháp hay không. Release nháp có tên `<app>-<phiên bản>-<commit upstream>`; kiểm tra rồi bấm Publish để trang tải cập nhật.

Chưa có chứng chỉ ký: file Windows không ký số (SmartScreen cảnh báo), file Mac ký ad-hoc và chưa notarize (Gatekeeper yêu cầu "Vẫn mở").

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
