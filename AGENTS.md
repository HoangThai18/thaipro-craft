# AGENTS.md

Hướng dẫn cho agent lập trình (Claude Code, Codex, Cursor, Gemini…) làm việc trong repo thaipro-craft. Commit message, tài liệu và chuỗi hiển thị viết bằng tiếng Việt như phần còn lại của repo; chú thích trong code (script bash, Python) viết bằng tiếng Anh và chỉ chú thích chỗ cần: giải thích *tại sao*, cảnh báo gotcha.

## Repo gồm gì

thaipro-craft dựng lại các app mã nguồn mở thành bản của [thaipro.store](https://thaipro.store/phan-mem) cho Windows và Mac. **Mã gốc (base) nằm nguyên trong `upstream/`, mọi tuỳ biến nằm ngoài nó**, để khi upstream ra bản mới chỉ việc nâng base rồi build lại. Hai thư mục cùng tên một app (`upstream/<app>`, `apps/<app>`) luôn dùng **tên gốc** của app, còn tên crate, file `.exe`, tên hiển thị và tên gói là **tên mới**.

| Thư mục (tên gốc) | Tên mới | Upstream | Loại |
|---|---|---|---|
| photocraft | Pixelume | storytold/photocraft | craft |
| printcraft | Pagena | storytold/printcraft | craft |
| filmcraft | Clipora | storytold/filmcraft | craft |
| lightcraft | Focalo | storytold/lightcraft | craft |
| vectorcraft | Bezio | storytold/vectorcraft | craft |
| effectcraft | Fluxa | storytold/effectcraft | craft |
| designcraft | Layouta | storytold/designcraft | craft |
| deckcraft | Stagely | storytold/deckcraft | craft |
| gridcraft | Cellaro | storytold/gridcraft | craft |
| wordcraft | Inkora | storytold/wordcraft | craft |
| soundcraft | Wavely | storytold/soundcraft | craft |
| cadcraft | Drafta | storytold/cadcraft | craft |
| opencut | ThaiCutCut 2.0 | opencut-app/opencut | opencut |
| opencut-classic | ThaiCutCut 1.0 | opencut-app/opencut-classic | classic |

- **craft**: workspace Rust (egui) của đội ArtCraft. Tên và logo ArtCraft là thương hiệu của họ nên bản này đã đổi tên và biểu tượng bằng `scripts/brand/` (xem README, mục "Đổi tên và biểu tượng").
- **opencut**: ThaiCutCut 2.0, base là bản viết lại OpenCut; có patch và overlay riêng.
- **classic**: ThaiCutCut 1.0, bản OpenCut cũ đã lưu trữ, bọc trong Electron. Base ghim cứng (`PINNED`), không nâng.
- `upstream/<app>` là submodule trỏ tới bản fork `HoangThai18/<app>` (riêng classic trỏ thẳng kho gốc). Chỉ đọc: không sửa, không build tại chỗ, không để bẩn.
- Mỗi app có `apps/<app>/{app.env,patches/,overlay/,release-notes.txt}`. `build/` là kết quả chuẩn bị, bị git bỏ qua.
- Trang tải ở kho khác: `HoangThai18/thaidev` (thư mục `../thaidev`), file `config/software.php`. Nó tự lấy bản mới nhất từ Release của kho này.
- Cấu trúc đầy đủ, cách build và đổi tên: [README.md](README.md).

## Lệnh

```sh
git submodule update --init upstream/<app>        # lấy base của một app (lịch sử đầy đủ: fetch --unshallow)
scripts/prepare.sh <app>                           # build/<app>: base + patch + đổi tên + phiên bản + overlay, rồi kiểm tra
PREPARE_RAW=1 scripts/prepare.sh <app>             # build/<app>: base + patch, còn tên gốc (nơi viết mã mới)
scripts/new-patch.sh <app> <slug>                  # biến phần vừa sửa ở build/<app> thành patch kế tiếp
scripts/sync-upstream.sh <app>                     # nâng base lên upstream main, thử áp lại patch
python3 scripts/brand/gen_icons.py                 # sinh lại icon (cần Pillow, chạy trên Mac)
```

Chạy thử bản đã đổi tên trên Mac: `scripts/prepare.sh photocraft && cd build/photocraft && cargo run --release -p pixelume`. Windows chỉ build và kiểm tra được trên GitHub Actions (phần mã `cfg(windows)` không biên dịch trên Mac).

Ổ đĩa Mac thường chỉ còn vài GB: mỗi `target/` của một app Rust nặng hàng GB. Dùng `CARGO_TARGET_DIR` ngoài repo và xoá sau khi xong, đừng build cả 12 app cùng lúc.

## Quy tắc bắt buộc

- Không bao giờ sửa trực tiếp `upstream/`. Mọi thay đổi mã đi qua patch, mọi file thêm vào đi qua overlay.
- **Patch viết theo tên gốc**, trong cây `PREPARE_RAW=1`. Quy trình đổi tên chạy sau khi áp patch nên không viết patch trên cây đã đổi tên.
- Giữ mỗi patch nhỏ và một mục đích. Mã mới nằm trong file mới (do patch thêm), nối vào mã gốc bằng vài dòng; không định dạng lại, không đổi tên hàng loạt, không xoá mã của upstream. Càng ít dòng vá càng ít xung đột khi nâng base.
- `overlay/` chỉ dành cho file không phải mã (icon, `.wxs`, `Info.plist`, `package.json` của shell Electron…). Icon và logo của craft app **không** sửa tay: đổi `scripts/brand/icons/<app>.png` rồi chạy `gen_icons.py`.
- Không đưa tên "ArtCraft" vào tên, logo, icon, tiêu đề hay quảng bá của sản phẩm. Chỉ được ghi bằng chữ thường rằng bản này dựa trên app của đội ArtCraft. `brand.py verify` (chạy cuối `prepare.sh`) dừng build nếu còn sót tên gốc hoặc icon của upstream; đừng tắt nó.
- Giữ nguyên file giấy phép của upstream (`LICENSE*`, `NOTICE`) và các liên kết `github.com/storytold/...`: đó là ghi công, không phải thương hiệu.
- Tên mới của app đặt ở `scripts/brand/names.json`, không có tiền tố "Thai" (trừ ThaiCutCut), tra web để không trùng phần mềm đã có.
- Nhật ký phát hành (`release-notes.txt`) chỉ nói tính năng và sửa lỗi người dùng thấy, không nêu cơ chế bên trong.
- Commit thẳng lên `main`. Message tiếng Việt, một dòng, mở đầu bằng tên app hoặc khu vực (`Pixelume: …`, `ThaiCutCut 1.0: …`, `Công cụ: …`). `git add` từng đường dẫn cụ thể, không `-A`, không thêm dòng `Co-Authored-By`.
- Chỉ push, chạy build trên GitHub, đăng Release và xoá Release khi được yêu cầu. Đăng và xoá Release là việc công khai, không hoàn tác được với người đã tải.

## Phát triển một tính năng

1. `PREPARE_RAW=1 scripts/prepare.sh <app>` rồi `cd build/<app>`. Cây này có hai commit (base, patch hiện có) và giữ tên gốc, nên lệnh cargo dùng tên gốc: `cargo run -p photocraft`.
2. Sửa và thử ở đó. Chạy test của crate vừa đụng tới (`cargo test -p <crate>`). Mã dành riêng cho Windows hoặc Mac chỉ kiểm được trên nền đó; chỗ nào có `cfg` thì đọc kỹ và để CI kiểm tra phần còn lại.
3. `scripts/new-patch.sh <app> <slug>` (slug là các từ thường nối bằng dấu gạch). Script ghi patch kế tiếp, chạy lại cả quy trình trên bản sạch và tự xoá patch nếu không qua.
4. Thử bản đã đổi tên: `scripts/prepare.sh <app>`, rồi `cargo run --release -p <tên mới viết thường>` trong `build/<app>`.
5. Tăng `VERSION` trong `apps/<app>/app.env` và viết `apps/<app>/release-notes.txt` cho bản mới (xem mục dưới).
6. Commit `apps/<app>` (patch, app.env, release-notes). Nếu tính năng đổi điều trang web đang nói về app (tính năng, giới hạn, hỏi đáp, ảnh), sửa tiếp `config/software.php` ở kho trang web.
7. Build và đăng khi được yêu cầu (mục "Phát hành").

Ảnh chụp màn hình cho trang web lấy từ chính bản mới: mở app Mac với `--control <cổng>` rồi gọi `ui.screenshot` (giao thức trong `docs/control-protocol.md` của từng app; Pagena dùng file token và JSON-RPC).

## Phiên bản và tag

- Phiên bản của sản phẩm là `VERSION=` trong `apps/<app>/app.env` (craft và opencut). `prepare.sh` ghi nó vào `[workspace.package] version` của `Cargo.toml` và vào `Cargo.lock` cùng lúc (bản Mac build với `--locked`), nên file cài, tên file và số phiên bản trong app luôn khớp. Không có `VERSION` thì app giữ phiên bản của upstream.
- ThaiCutCut 1.0 (classic) không có `VERSION`: sửa `"version"` trong `apps/opencut-classic/overlay/desktop/package.json`.
- Quy ước số: `x.y.z`. Sửa lỗi tăng `z`; tính năng mới hoặc nâng base có thay đổi người dùng thấy tăng `y`; thay đổi làm hỏng dữ liệu hay cách dùng cũ tăng `x`. Bản thử dùng `x.y.z-beta.1`. MSI chỉ nhận `x.y.z` nên phần sau dấu gạch bị bỏ ở file `.msi` (tên file vẫn đầy đủ).
- **Mỗi thay đổi đã phát hành phải tăng `VERSION`.** `publish-release.sh` từ chối ghi đè một Release đã đăng. Muốn làm lại đúng phiên bản đó thì xoá Release và tag cũ trước, có chủ ý.
- Tag của Release: `<FILE_PREFIX>-<VERSION>-<7 ký tự đầu của commit base>`, ví dụ `pixelume-0.2.0-8f0f959`. `FILE_PREFIX` là tên mới viết thường (`thaicutcut2` cho 2.0, `thaicutcut` cho 1.0). Trang web đọc phiên bản và "bản dựng" từ tag này.
- Trang tải chọn Release **mới nhất, không nháp, không đánh dấu prerelease** có tag bắt đầu bằng `tag_prefix` (`<FILE_PREFIX>-`). Dấu gạch cuối quan trọng: `thaicutcut-` không khớp `thaicutcut2-…`. Đổi `FILE_PREFIX` thì đổi `tag_prefix` ở trang web.
- Một app lên bản mới không cần đụng trang web: nó tự đọc Release, trễ tối đa khoảng một giờ do bộ nhớ đệm.

## Phát hành

```sh
gh workflow run build.yml --repo HoangThai18/thaipro-craft -f app=photocraft -f publish=true   # một hay nhiều app (cách nhau dấu phẩy), hoặc all
gh workflow run build-classic.yml --repo HoangThai18/thaipro-craft -f publish=true             # ThaiCutCut 1.0
gh workflow run build-opencut.yml --repo HoangThai18/thaipro-craft -f publish=true             # ThaiCutCut 2.0
```

Mỗi app dựng trên Windows (`.msi`, bộ cài `Setup.exe`, `.zip` portable, có chạy thử cài đặt và gỡ cài đặt) và Mac (`.dmg`), rồi tạo Release **nháp** `<tag>` kèm `SHA256SUMS.txt`. Kiểm tra đủ file, rồi đăng: `gh release edit <tag> --repo HoangThai18/thaipro-craft --draft=false --latest=false`. `build.yml` nhận tên gốc của app (`photocraft`), không phải tên mới. Nếu job release lỡ lỗi mà gói đã dựng xong, `release-from-run.yml` đăng lại từ kết quả của lượt trước. Không ký số: Windows và Mac cảnh báo lần mở đầu, trang web đã nói rõ điều này.

## Nâng base khi upstream ra bản mới

Workflow **Upstream check** chạy mỗi thứ Hai, mở issue nếu upstream đi trước base và báo patch còn áp được không.

1. `scripts/sync-upstream.sh <app>`: đồng bộ bản fork, nâng con trỏ submodule, chạy lại `prepare.sh`. Nó không commit.
2. Đọc thay đổi: `git -C upstream/<app> log --oneline <cũ>..<mới>`. Lịch sử đầy đủ có sẵn; thiếu thì `git -C upstream/<app> fetch --unshallow origin`.
3. Patch áp được: không cần làm gì. Upstream đã tự có thay đổi của patch: `prepare.sh` báo `skipped`, xoá patch đó. Patch không áp được: `prepare.sh` dừng và nêu patch lỗi, xem mục dưới.
4. `brand.py verify` báo `icon not replaced` nghĩa là upstream thêm file icon hoặc logo mới: chạy `gen_icons.py`. Báo `leftover` nghĩa là có tên gốc mới xuất hiện (ví dụ tên một app anh em): thêm vào `scripts/brand/names.json` hoặc xử lý bằng `literals.json` / `freeze.json`.
5. Với craft app, đối chiếu `CRAFT_FONTS_REF` trong `app.env` với `release.yml` của upstream.
6. Tăng `VERSION` (thường tăng `y` nếu upstream có tính năng mới) và ghi những gì người dùng sẽ thấy vào `release-notes.txt`.
7. Commit: `git add upstream/<app> apps/<app>` với message kiểu `Base Pixelume: nâng lên upstream main <sha>`. Rồi build như mục Phát hành.

**Patch không áp được.** Lấy base trơn của bản mới, mang từng patch sang và sinh lại đúng file patch đó:

```sh
PREPARE_RAW=1 PREPARE_NO_PATCHES=1 scripts/prepare.sh <app>
cd build/<app>
git apply --3way ../../apps/<app>/patches/000N-ten.patch     # sửa xung đột nếu có
git add -A && git diff --cached --binary HEAD > ../../apps/<app>/patches/000N-ten.patch
git -c user.name=prepare -c user.email=prepare@localhost commit -m 000N-ten
```

Làm lần lượt từ patch đầu đến patch cuối, rồi `scripts/prepare.sh <app>` ở gốc repo để chắc cả quy trình qua. ThaiCutCut 2.0 còn thêm `scripts/refresh-opencut.sh` sau khi nâng base (làm mới file khoá JS và danh sách giấy phép bên thứ ba).

## Gotcha

- `build/<app>/target` rất lớn; `build/` không vào git.
- Windows runner: `git archive` phải tắt `autocrlf` (đã làm trong `prepare.sh`), nếu không patch LF không áp được. Đừng đổi.
- Hai crate cùng một kho (EffectCraft dùng crate `filmcraft-*` lấy từ kho FilmCraft qua git) giữ nguyên tên nhờ `scripts/brand/freeze.json`.
- Tên bị tách bởi thẻ HTML (ví dụ bìa PDF mẫu của Pagena ghi `Print<span>Craft</span>`) không bắt được bằng đổi chữ: dùng `literals.json`.
- Mỗi craft app có nút "Discord" và mục menu "ArtCraft Website" trỏ tới cộng đồng của ArtCraft. Đó là ghi công bằng chữ, không phải logo; muốn gỡ thì sửa bằng patch.
- Tag đã đăng không bị ghi đè (xem trên); `release-notes.txt` có thể dùng `{short}` cho 7 ký tự commit base.
- `docs/brand/artcraft-*` của upstream được thay bằng hình thaipro.store cùng đường dẫn vì mã của vài app nhúng chúng bằng `include_bytes!`.
