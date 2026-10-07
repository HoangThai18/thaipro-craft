#!/usr/bin/env bash
# After moving the opencut base: refresh the pinned JS lockfile and the license notice.
# Upstream keeps its web dependencies on `latest` and commits no lockfile, so the lockfile in
# apps/opencut/overlay is what makes builds reproducible and auditable. Needs node, cargo, python3.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
overlay="$root/apps/opencut/overlay"

"$root/scripts/prepare.sh" opencut
(cd "$root/build/opencut/apps/web" && npx -y bun@1.3.11 install --lockfile-only)
cp "$root/build/opencut/apps/web/bun.lock" "$overlay/apps/web/bun.lock"

python3 -I "$root/scripts/third-party-licenses.py" opencut "$overlay/THIRD_PARTY_LICENSES.md"
cp "$overlay/THIRD_PARTY_LICENSES.md" "$overlay/apps/web/public/third-party-licenses.md"

echo "Refreshed. Review with: git diff --stat apps/opencut"
