#!/usr/bin/env bash
# Move the base to the newest upstream main and prove our patches still apply to it.
#
# Usage: scripts/sync-upstream.sh <app>
# Needs: gh (logged in). It fast-forwards our mirror of upstream, bumps the submodule pointer in
# the working tree and runs prepare.sh. It never commits: review `git diff --submodule` first.
set -euo pipefail

app="${1:?usage: scripts/sync-upstream.sh <app>}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
. "$root/apps/$app/app.env"

before="$(git -C "$root/upstream/$app" rev-parse --short HEAD)"
gh repo sync "$MIRROR_REPO" --branch main
git -C "$root" submodule update --init --remote "upstream/$app"
after="$(git -C "$root/upstream/$app" rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
  echo "$app: already on upstream main ($after)"
else
  count="$(git -C "$root/upstream/$app" rev-list --count "$before..$after")"
  echo "$app: $before -> $after ($count new upstream commits)"
fi

"$root/scripts/prepare.sh" "$app"
echo "Patches apply. To adopt: git add upstream/$app && git commit"
