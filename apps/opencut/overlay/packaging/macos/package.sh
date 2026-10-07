#!/usr/bin/env bash
# Build ThaiCutCut for macOS: a universal (Apple Silicon + Intel) ThaiCutCut.app on a
# drag-to-Applications DMG. Signed ad-hoc and not notarized, so Gatekeeper asks the user to
# approve the app on first launch (the DMG carries a short Vietnamese note about it).
#
# Output: $DIST/thaicutcut-<version>-macos-universal.dmg   (DIST defaults to dist/release)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$ROOT/packaging/macos"
DIST="${DIST:-$ROOT/dist/release}"
mkdir -p "$DIST"

# The version lives in one place: [workspace.package] version in the root Cargo.toml.
VERSION="$(awk '/^\[/ { in_pkg = ($0 == "[workspace.package]"); next } in_pkg && $1 == "version" { gsub(/"/, "", $3); print $3; exit }' "$ROOT/Cargo.toml")"
[ -n "$VERSION" ] || { echo "error: could not read the workspace version" >&2; exit 1; }
SHORT_VERSION="${VERSION%%-*}"

export MACOSX_DEPLOYMENT_TARGET=11.0
TARGETS=(aarch64-apple-darwin x86_64-apple-darwin)
WORK="$ROOT/target/macos-package"
APP="$WORK/ThaiCutCut.app"
DMG="$DIST/thaicutcut-$VERSION-macos-universal.dmg"

echo "==> ThaiCutCut $VERSION for macOS (universal)"
args=()
for t in "${TARGETS[@]}"; do args+=(--target "$t"); done
(cd "$ROOT" && cargo build --release --locked -p opencut-desktop "${args[@]}")

rm -rf "$WORK"
mkdir -p "$WORK/bin" "$APP/Contents/MacOS" "$APP/Contents/Resources"
inputs=()
for t in "${TARGETS[@]}"; do inputs+=("$ROOT/target/$t/release/thaicutcut"); done
lipo -create -output "$WORK/bin/thaicutcut" "${inputs[@]}"
lipo -info "$WORK/bin/thaicutcut"

cp "$WORK/bin/thaicutcut" "$APP/Contents/MacOS/ThaiCutCut"
cp "$HERE/ThaiCutCut.icns" "$APP/Contents/Resources/ThaiCutCut.icns"
cp "$ROOT/LICENSE" "$APP/Contents/Resources/LICENSE-OpenCut.txt"
cp "$ROOT/THIRD_PARTY_LICENSES.md" "$APP/Contents/Resources/"
cp "$ROOT/packaging/README.txt" "$APP/Contents/Resources/"
printf 'APPL????' >"$APP/Contents/PkgInfo"

cat >"$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ThaiCutCut</string>
  <key>CFBundleDisplayName</key><string>ThaiCutCut</string>
  <key>CFBundleIdentifier</key><string>store.thaipro.thaicutcut</string>
  <key>CFBundleExecutable</key><string>ThaiCutCut</string>
  <key>CFBundleIconFile</key><string>ThaiCutCut</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$SHORT_VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Based on OpenCut. Copyright 2026 OpenCut (MIT).</string>
</dict>
</plist>
EOF
plutil -lint "$APP/Contents/Info.plist"

codesign --force --sign - --timestamp=none "$APP"
codesign --verify --strict --verbose=2 "$APP"

STAGE="$WORK/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/ThaiCutCut.app"
ln -s /Applications "$STAGE/Applications"
cat >"$STAGE/Doc truoc khi mo.txt" <<'EOF'
Lần đầu mở ThaiCutCut, macOS có thể báo không xác minh được nhà phát triển, vì bản này chưa được Apple xác minh.

1. Kéo ThaiCutCut vào thư mục Applications.
2. Mở ThaiCutCut. Nếu bị chặn, vào Cài đặt hệ thống > Quyền riêng tư và Bảo mật, kéo xuống bấm "Vẫn mở" (Open Anyway), rồi xác nhận.
3. Nếu vẫn không mở được, mở Terminal và chạy:
   xattr -dr com.apple.quarantine /Applications/ThaiCutCut.app

Hướng dẫn và trang tải: https://thaipro.store/phan-mem
EOF
rm -f "$DMG" "$WORK/raw.dmg"
# makehybrid + convert builds the image without attaching a device, which is flaky on CI runners.
hdiutil makehybrid -hfs -hfs-volume-name "ThaiCutCut $VERSION" -hfs-openfolder "$STAGE" -o "$WORK/raw.dmg" "$STAGE"
hdiutil convert "$WORK/raw.dmg" -format UDZO -imagekey zlib-level=9 -o "$DMG"
rm -f "$WORK/raw.dmg"
codesign --force --sign - --timestamp=none "$DMG"
codesign --verify --strict --verbose=2 "$DMG"

ls -l "$DMG"
