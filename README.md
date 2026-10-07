# thaipro-craft

Bản custom của các app mã nguồn mở, phát hành tại [thaipro.store/phan-mem](https://thaipro.store/phan-mem):

- Họ app "Crafting Apps" của đội [ArtCraft](https://getartcraft.com), cho Windows và Mac, dựng lại dưới tên và biểu tượng riêng (thương hiệu ArtCraft không thuộc giấy phép mã nguồn mở): **Pixelume** (từ PhotoCraft, sửa ảnh), **Pagena** (PrintCraft, PDF), **Clipora** (FilmCraft, dựng video), **Focalo** (LightCraft, thư viện ảnh và RAW), **Bezio** (VectorCraft), **Fluxa** (EffectCraft), **Layouta** (DesignCraft, dàn trang), **Stagely** (DeckCraft, trình chiếu), **Cellaro** (GridCraft, bảng tính), **Inkora** (WordCraft, soạn văn bản), **Wavely** (SoundCraft, thu âm) và **Drafta** (CADCraft). Thư mục `apps/<app>` và `upstream/<app>` vẫn mang tên gốc.
- **ThaiCutCut**, dựa trên [OpenCut](https://github.com/opencut-app/opencut) (trình chỉnh sửa video).

Không lấy `storytold/artcraft` và `artcraftx`: giấy phép của chúng là "fair source" (cấm bán, cấm gỡ liên kết quyên góp, cấm làm sản phẩm cạnh tranh), không phải mã nguồn mở nên không phân phối lại.

Nguyên tắc: **không bao giờ sửa trực tiếp mã của họ**. Mã gốc nằm nguyên trong `upstream/`, mọi tuỳ biến nằm riêng ngoài đó. Nhờ vậy khi upstream ra bản mới, bạn chỉ việc nâng base rồi build lại, giống cách làm với Odoo.

## Cấu trúc

```
upstream/<app>/          submodule → HoangThai18/<app> (bản sao nhánh main của storytold/<app>; opencut → HoangThai18/OpenCut)
apps/<app>/app.env       cấu hình từng app (kho gốc, kho bản sao, phiên bản craft-fonts, tên và exe để dựng Setup.exe, cách kiểm thử cài đặt)
apps/<app>/patches/      patch tuỳ biến (*.patch), áp theo thứ tự tên file
apps/<app>/overlay/      file thêm hoặc thay (icon, wxs, Info.plist, ...), chép đè lên sau khi áp patch
scripts/prepare.sh       tạo build/<app>: bản sao sạch của base + patch + đổi tên và biểu tượng + overlay
scripts/brand/           đổi tên app và thay biểu tượng (names.json, brand.py, gen_icons.py, gen_thaicutcut.py, literals.json, icons/)
scripts/windows/         Setup.exe (Inno Setup, bọc MSI, giao diện tiếng Việt) và bài kiểm thử cài đặt trên CI
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

Bản Windows (`Setup.exe`, `.msi`, `.zip`) và Mac (`.dmg`) build trên GitHub Actions bằng chính script đóng gói của upstream: **Actions > Build > Run workflow**, điền `all` hoặc danh sách app cách nhau dấu phẩy (ví dụ `effectcraft,wordcraft`) và chọn có tạo Release nháp hay không. Release nháp có tên `<app>-<phiên bản>-<commit upstream>`; kiểm tra rồi bấm Publish để trang tải cập nhật.

## Đổi tên và biểu tượng (scripts/brand)

Tên và logo ArtCraft là thương hiệu của họ, nên bản sửa đổi phải gỡ chúng. Việc này làm bằng script chứ không bằng patch, để nâng base không phải sửa patch nào:

1. `scripts/prepare.sh` áp patch (viết theo tên gốc), rồi chạy `brand.py rebrand`: đổi mọi cách viết hoa thường của tên gốc sang tên mới trong nội dung và tên file (kể cả tên crate, exe, ProgId, id gói `ai.storyteller.*` thành `store.thaipro.*`), đổi nhà phát hành "Learning Machines LLC" thành thaipro.store, và trỏ trang app trên getartcraft.com về trang trên thaipro.store.
2. Giữ nguyên các liên kết tới upstream (`github.com/storytold/...`, `getartcraft.com`), file giấy phép (`LICENSE*`, `NOTICE`) và bản quyền trong đó: đó là ghi công, không phải thương hiệu.
3. Chép overlay: icon (`assets/app-icon/**`) và hình thay cho logo ArtCraft nhúng trong giao diện (`docs/brand/artcraft-*`), đều sinh sẵn từ `scripts/brand/icons/<app>.png`.
4. `brand.py verify` dừng build nếu còn sót tên gốc hoặc còn icon/logo của upstream chưa được thay (ví dụ sau khi nâng base thêm file icon mới).
5. `literals.json` thay vài đoạn mã cố định không đổi tên được bằng cách trên (ví dụ DesignCraft vẽ dấu ArtCraft bằng đường vector trong mã); script dừng nếu đoạn đó đổi ở upstream.

Đổi tên: sửa `names.json`, rồi `python3 scripts/brand/gen_icons.py` (cần Pillow; chạy trên Mac để có `.icns` chuẩn), sửa `NAME`, `FOLDER`, `EXE`, `FILE_PREFIX`, `ICON`, `SMOKE_PROGID` trong `app.env` cho khớp và `config/software.php` của trang web. Đổi logo: thay `icons/<app>.png` (1024 px, nền trong suốt, ô vuông bo góc) rồi chạy lại `gen_icons.py` và `gen_thaicutcut.py` (ThaiCutCut 1.0 và 2.0).

## ThaiCutCut (OpenCut)

Base là bản **viết lại** `opencut-app/opencut`, hiện còn rất sơ khai: web chỉ có trang "hello world" và `/editor` ghi "Coming soon", bản desktop chỉ mở một cửa sổ. Bản `opencut-classic` dùng được nhưng đã lưu trữ, không chọn. Khi upstream có trình chỉnh sửa thật thì nâng base là có ngay.

- `apps/opencut/patches/0001-rebrand-thaicutcut.patch` đổi tên hiển thị, gỡ cấu hình trỏ tới domain của OpenCut.
- `apps/opencut/overlay/brand/` logo ThaiCutCut (thay các dấu hiệu OpenCut), `apps/web/public/` favicon và icon.
- `apps/opencut/overlay/apps/web/bun.lock` ghim phiên bản thư viện web (upstream để `latest`, không có file khoá).
- `LICENSE` của upstream giữ nguyên văn ("Copyright 2026 OpenCut", MIT) và được chép kèm trong mọi bản build; `THIRD_PARTY_LICENSES.md` liệt kê thư viện đi kèm và gắn cờ các giấy phép cần chú ý (LGPL, MPL).
- Workflow **Build ThaiCutCut** build web (và bản desktop nếu bật) và đóng kèm các thông báo giấy phép.

Nâng base: `scripts/sync-upstream.sh opencut`, rồi `scripts/refresh-opencut.sh`, xem `git diff --stat apps/opencut` và commit.

## Thêm một app của đội ArtCraft

```sh
gh repo fork storytold/<app> --clone=false --default-branch-only
git submodule add -b main https://github.com/HoangThai18/<app>.git upstream/<app>
```

Rồi tạo `apps/<app>/app.env` (copy từ một app cùng họ, sửa tên, exe, thư mục cài, `CRAFT_FONTS_REF` đúng như `release.yml` của upstream, `SMOKE_*` theo `OpenWithProgids` trong file `.wxs`) cùng hai thư mục `patches/` và `overlay/`. Workflow Build tự nhận app có `KIND=craft`.

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
