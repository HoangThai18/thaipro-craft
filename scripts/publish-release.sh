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
# gh is told the repository explicitly: the package folder may sit outside any git checkout.
repo="${GITHUB_REPOSITORY:-$(git -C "$root" remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')}"

sha="$(git -C "$root" ls-tree HEAD "upstream/$app" | awk '{print $3}')"
short="${sha:0:7}"
cfg="$root/apps/$app/app.env"
prefix="$(sed -n 's/^FILE_PREFIX=//p' "$cfg")"
prefix="${prefix:-$app}"
has_msi="$(sed -n 's/^HAS_MSI=//p' "$cfg")"
if [ ! -d "$dir" ]; then
  echo "::warning::$app: no build output at $dir, release skipped"
  exit 0
fi
cd "$dir"

patterns=("$prefix-*-windows-x64-setup.exe" "$prefix-*-macos-universal.dmg")
[ "${has_msi:-1}" = 0 ] || patterns+=("$prefix-*-windows-x64.msi")
for pattern in "${patterns[@]}"; do
  if ! compgen -G "$pattern" >/dev/null; then
    echo "::warning::$app: no file matches $pattern, release skipped"
    exit 0
  fi
done

version="$(ls "$prefix"-*-windows-x64-setup.exe | head -n 1 | sed -E "s/^$prefix-(.*)-windows-x64-setup\.exe$/\1/")"
tag="$prefix-$version-$short"
sha256sum -- * >SHA256SUMS.txt
if [ -f "$root/apps/$app/release-notes.txt" ]; then
  notes="$(sed "s/{short}/$short/g" "$root/apps/$app/release-notes.txt")"
else
  notes="Bản build Windows và Mac của $app từ mã nguồn mở của đội ArtCraft (https://github.com/storytold/$app, giấy phép MIT hoặc Apache-2.0), commit $short trên nhánh main. Không phải bản chính thức; bản Windows chưa ký số và bản Mac chưa được Apple xác minh nên hệ điều hành có thể cảnh báo. Đối chiếu SHA256SUMS.txt trước khi cài."
fi
title_name="$(sed -n 's/^NAME=//p' "$cfg")"
title_name="${title_name:-$app}"

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release upload "$tag" --repo "$repo" --clobber -- *
else
  # A target older than the tip of main is refused with 403 once newer commits touch workflows.
  gh release create "$tag" --repo "$repo" --draft --target main \
    --title "$title_name $version ($short) cho Windows và Mac" --notes "$notes" -- *
fi
echo "$tag"
