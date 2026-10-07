#!/usr/bin/env bash
# Turn the edits in build/<app> into the next numbered patch of apps/<app>/patches, then prove the
# whole pipeline (patches, rebrand, version, overlay, verify) still works on a clean copy.
#
# Usage: PREPARE_RAW=1 scripts/prepare.sh <app>   # once: raw tree with upstream names
#        ...edit and test in build/<app>...
#        scripts/new-patch.sh <app> <slug>        # slug: lower-case words joined by dashes
#
# The edits are committed in build/<app> afterwards, so the next patch only holds what you change next.
set -euo pipefail

app="${1:?usage: scripts/new-patch.sh <app> <slug>}"
slug="${2:?usage: scripts/new-patch.sh <app> <slug>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$root/build/$app"
patches="$root/apps/$app/patches"

[[ "$slug" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "error: slug must be lower-case words joined by dashes" >&2; exit 2; }
[ -f "$root/apps/$app/app.env" ] || { echo "error: unknown app '$app'" >&2; exit 2; }
git -C "$work" log --format=%s 2>/dev/null | grep -qx "thaipro patches" \
  || { echo "error: $work is not a raw tree; run: PREPARE_RAW=1 scripts/prepare.sh $app" >&2; exit 2; }

# Respect the base's .gitignore (target/ and friends); new files are included.
git -C "$work" add -A
if git -C "$work" diff --cached --quiet HEAD; then
  echo "error: nothing changed in $work" >&2
  exit 1
fi

mkdir -p "$patches"
last="$(find "$patches" -maxdepth 1 -name '[0-9][0-9][0-9][0-9]-*.patch' | sed -E 's#.*/([0-9]{4})-.*#\1#' | sort | tail -n 1)"
number="$(printf '%04d' $((10#${last:-0} + 1)))"
file="$patches/$number-$slug.patch"
git -C "$work" diff --cached --binary HEAD >"$file"

check="$(mktemp -d)"
trap 'rm -rf "$check"' EXIT
if ! PREPARE_OUT="$check/tree" "$root/scripts/prepare.sh" "$app" >"$check/log" 2>&1; then
  cat "$check/log" >&2
  rm -f "$file"
  echo "error: the full pipeline fails with this patch; it was removed. Fix the edits and run again." >&2
  exit 1
fi

git -C "$work" -c user.name=prepare -c user.email=prepare@localhost commit -q -m "$number-$slug"
echo "wrote ${file#"$root/"} ($(git -C "$work" show --stat --format= HEAD | tail -n 1 | sed 's/^ *//'))"
echo "the full pipeline passes; commit apps/$app and run the Build workflow to ship it"
