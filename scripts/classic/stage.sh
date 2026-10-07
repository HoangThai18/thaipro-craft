#!/usr/bin/env bash
# Stage the built ThaiCutCut 1.0 web app (Next.js standalone server) where the Electron shell
# expects it: build/opencut-classic/desktop/web. Run after `next build` in apps/web.
#
# Usage: scripts/classic/stage.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
app="$root/build/opencut-classic"
web="$app/apps/web"
standalone="$web/.next/standalone"
dest="$app/desktop/web"

[ -f "$standalone/apps/web/server.js" ] || { echo "error: no standalone build at $standalone" >&2; exit 1; }

rm -rf "$dest"
mkdir -p "$dest"
# bun links packages through symlinks; copy their targets so the installer holds plain files.
cp -RL "$standalone/." "$dest/"
mkdir -p "$dest/apps/web/.next"
cp -R "$web/.next/static" "$dest/apps/web/.next/static"
rm -rf "$dest/apps/web/public"
cp -R "$web/public" "$dest/apps/web/public"

# Images are served unoptimized, so the platform-specific image libraries are not needed. A
# universal macOS build also cannot merge two different native add-ons.
find "$dest" -type d -name '@img' -prune -exec rm -rf {} +
find "$dest" -type d -name '@img+*' -prune -exec rm -rf {} +
if [ -n "$(find "$dest" -name '*.node' | head -n 1)" ]; then
  echo "error: native add-ons are left in the staged web app:" >&2
  find "$dest" -name '*.node' >&2
  exit 1
fi

mkdir -p "$app/desktop/licenses" "$app/desktop/build"
cp "$app/LICENSE" "$app/desktop/licenses/LICENSE-OpenCut.txt"
cp "$app/LICENSE" "$app/desktop/build/license.txt"
[ ! -f "$app/THIRD_PARTY_LICENSES.md" ] || cp "$app/THIRD_PARTY_LICENSES.md" "$app/desktop/licenses/THIRD_PARTY_LICENSES.md"

du -sh "$dest"
echo "staged $dest"
