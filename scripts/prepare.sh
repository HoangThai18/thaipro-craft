#!/usr/bin/env bash
# Produce build/<app>: a clean copy of the pinned upstream commit with our overlay and patches
# applied. upstream/<app> stays read-only: it is never patched, built in place or left dirty, so
# bumping the base is just moving the submodule pointer.
#
# Usage: scripts/prepare.sh <app>
# Env:   UPSTREAM_REF    commit or ref to prepare instead of the pinned one (used to test a new base)
#        PREPARE_OUT     output directory (default: build/<app>)
#        PREPARE_COMMITS 1 = commit the pure base, then patches + overlay, so `git diff` in the
#                        output shows only new edits (for writing patches; CI skips the cost)
set -euo pipefail

app="${1:?usage: scripts/prepare.sh <app>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cfg="$root/apps/$app"
src="$root/upstream/$app"
out="${PREPARE_OUT:-$root/build/$app}"
ref="${UPSTREAM_REF:-HEAD}"

[ -f "$cfg/app.env" ] || { echo "error: unknown app '$app'" >&2; exit 2; }
git -C "$src" rev-parse --git-dir >/dev/null 2>&1 \
  || { echo "error: upstream/$app is empty; run: git submodule update --init upstream/$app" >&2; exit 2; }

sha="$(git -C "$src" rev-parse "$ref^{commit}")"
short="$(git -C "$src" rev-parse --short "$sha")"

rm -rf "$out"
mkdir -p "$out"
# No end-of-line conversion: Windows defaults to autocrlf=true, which would turn the base into CRLF and
# stop LF patches from applying.
git -c core.autocrlf=false -C "$src" archive --format=tar "$sha" | tar -x -C "$out"

# A repo of its own so `git apply` resolves paths against build/<app>, not against this repo.
git init -q "$out"
git -C "$out" config core.autocrlf false

commit_all() {
  git -C "$out" add -A -f
  git -C "$out" -c user.name=prepare -c user.email=prepare@localhost commit -q --allow-empty -m "$1"
}
[ "${PREPARE_COMMITS:-0}" != 1 ] || commit_all "upstream $short"

shopt -s nullglob
failed=0
for patch in "$cfg"/patches/*.patch; do
  name="$(basename "$patch")"
  if git -C "$out" apply --check "$patch" 2>/dev/null; then
    git -C "$out" apply "$patch"
    echo "applied  $name"
  elif git -C "$out" apply --reverse --check "$patch" 2>/dev/null; then
    echo "skipped  $name (upstream $short already has it)"
  else
    echo "FAILED   $name does not apply to upstream $short:" >&2
    git -C "$out" apply --check "$patch" 2>&1 | sed 's/^/           /' >&2 || true
    failed=1
  fi
done
[ "$failed" = 0 ] || exit 1

# Apps listed in scripts/brand/names.json lose the upstream name and icons here: the base is rebranded
# as a whole after the patches (which are written against upstream names) and before the overlay
# (which carries the new icons under the new names).
rebranded=0
if grep -q "\"$app\"" "$root/scripts/brand/names.json"; then
  # python3 on a Windows runner can be the Microsoft Store stub, which exists but cannot run.
  py=""
  for candidate in python3 python; do
    if "$candidate" -c "import sys" >/dev/null 2>&1; then py="$candidate"; break; fi
  done
  [ -n "$py" ] || { echo "error: Python 3 is needed to rebrand $app" >&2; exit 2; }
  "$py" -I "$root/scripts/brand/brand.py" rebrand "$out" "$app"
  rebranded=1
fi

if [ -n "$(find "$cfg/overlay" -type f ! -name .gitkeep 2>/dev/null | head -n 1)" ]; then
  # An overlay file that shadows an upstream file may go stale when the base moves on: say so.
  while IFS= read -r file; do
    rel="${file#"$cfg/overlay/"}"
    [ ! -e "$out/$rel" ] || echo "replaced $rel (exists upstream; check it is still wanted)"
  done < <(find "$cfg/overlay" -type f ! -name .gitkeep)
  cp -R "$cfg/overlay/." "$out/"
  rm -f "$out/.gitkeep"
  echo "overlay  copied"
fi

[ "$rebranded" = 0 ] || "$py" -I "$root/scripts/brand/brand.py" verify "$out" "$cfg/overlay" "$app"

[ "${PREPARE_COMMITS:-0}" != 1 ] || commit_all "thaipro patches and overlay"

echo "$app ready in $out (upstream $short)"

if [ -n "${GITHUB_ENV:-}" ]; then
  upper="$(printf '%s' "$app" | tr '[:lower:]' '[:upper:]')"
  echo "${upper}_BUILD_SHA=$sha" >>"$GITHUB_ENV"
  if [ "$rebranded" = 1 ]; then
    new="$("$py" -I -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]['new'].upper())" "$root/scripts/brand/names.json" "$app")"
    echo "${new}_BUILD_SHA=$sha" >>"$GITHUB_ENV"
  fi
fi
