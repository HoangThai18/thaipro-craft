#!/usr/bin/env bash
# Create (or top up) the draft GitHub Release of one craft app from a folder of built packages.
#
# Usage: scripts/publish-release.sh <app> <dir>
# Env:   GH_TOKEN  token that can create releases on this repo (the workflow passes github.token)
# The release is named <app>-<version>-<upstream short sha>, so the site can pick it by tag prefix.
# It is skipped, not failed, when the Windows or Mac package is missing: one broken app must not
# hold back the others.
set -euo pipefail

app="${1:?usage: scripts/publish-release.sh <app> <dir>}"
dir="${2:?usage: scripts/publish-release.sh <app> <dir>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sha="$(git -C "$root" ls-tree HEAD "upstream/$app" | awk '{print $3}')"
short="${sha:0:7}"
if [ ! -d "$dir" ]; then
  echo "::warning::$app: no build output at $dir, release skipped"
  exit 0
fi
cd "$dir"

for pattern in "$app-*-windows-x64.msi" "$app-*-windows-x64-setup.exe" "$app-*-macos-universal.dmg"; do
  if ! compgen -G "$pattern" >/dev/null; then
    echo "::warning::$app: no file matches $pattern, release skipped"
    exit 0
  fi
done

version="$(ls "$app"-*-windows-x64.msi | head -n 1 | sed -E "s/^$app-(.*)-windows-x64\.msi$/\1/")"
tag="$app-$version-$short"
sha256sum -- * >SHA256SUMS.txt
notes="Bản build Windows và Mac của $app từ mã nguồn mở của đội ArtCraft (https://github.com/storytold/$app, giấy phép MIT hoặc Apache-2.0), commit $short trên nhánh main. Không phải bản chính thức; bản Windows chưa ký số và bản Mac chưa được Apple xác minh nên hệ điều hành có thể cảnh báo. Đối chiếu SHA256SUMS.txt trước khi cài."

if gh release view "$tag" >/dev/null 2>&1; then
  gh release upload "$tag" --clobber -- *
else
  # A target older than the tip of main is refused with 403 once newer commits touch workflows.
  gh release create "$tag" --draft --target main \
    --title "$app $version ($short) cho Windows và Mac" --notes "$notes" -- *
fi
echo "$tag"
