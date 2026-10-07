#!/usr/bin/env python3
"""Rebrand a prepared copy of an upstream app (build/<app>) with the names in names.json.

Run by scripts/prepare.sh between the patches and the overlay:

    brand.py rebrand <dir> <app>       rename the app (and every sibling app mentioned in it) in text and paths
    brand.py verify <dir> <overlay> <app>   fail when an old name or an upstream icon survived
    brand.py set-version <dir> <version>    make the workspace version (Cargo.toml and Cargo.lock) our own

The upstream name is a mark of the ArtCraft team, so the shipped build must not carry it. Doing the
rename as a script on the pristine base, instead of as a patch, keeps upstream upgrades free: a new
base needs no patch rework, only a re-run.

Case variants are mapped together (PhotoCraft, Photocraft, photocraft, PHOTOCRAFT). Anything that
points at the upstream project (URLs, storytold/..., getartcraft.com) and the upstream licence files
are left alone: they are attribution, not branding. freeze.json lists names that must stay as they are
because another upstream repo defines them (EffectCraft builds crates straight from the FilmCraft repo). The one exception is the app page on
getartcraft.com, which becomes the app page on thaipro.store, and the publisher shown by the
installer, which becomes thaipro.store (the copyright notices in the licence files keep the authors).
"""
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
NAMES = json.loads((HERE / "names.json").read_text(encoding="utf-8"))

SKIP_CONTENT_PREFIXES = ("LICENSE", "NOTICE", "COPYRIGHT", "COPYING")
MAX_BYTES = 20 * 1024 * 1024
REMOVE_GLOBS = [
    "docs/brand/**/*.attribution",
    "assets/app-icon/**/*.attribution",
    "assets/app-icon/icon-source.*",
]
UPSTREAM = re.compile(rb"storytold|getartcraft")
FREEZE = None
TOKEN_END = frozenset(b" \t\r\n\f\v\"'<>()[]{}`,;|")


def _forms(display):
    return [display, display[0].upper() + display[1:].lower(), display.lower(), display.upper(), display[0].lower() + display[1:]]


MAPPING = {}
for entry in NAMES.values():
    for old, new in zip(_forms(entry["old"]), _forms(entry["new"])):
        MAPPING[old] = new
ANY_CASE = re.compile("|".join(re.escape(e["old"]) for e in NAMES.values()), re.I)
PATTERN = re.compile("|".join(re.escape(k) for k in sorted(MAPPING, key=len, reverse=True)))
APP_ID = re.compile(r"ai\.storyteller\.(" + "|".join(e["old"].lower() for e in NAMES.values()) + ")")
APP_ID_NEW = {e["old"].lower(): e["new"].lower() for e in NAMES.values()}


APP_PAGE = re.compile(rb"https://getartcraft\.com/apps/(" + "|".join(e["old"].lower() for e in NAMES.values()).encode() + rb")\b")


def own_links(data):
    data = APP_PAGE.sub(lambda m: b"https://thaipro.store/phan-mem/" + APP_ID_NEW[m.group(1).decode()].encode(), data)
    return data.replace(b"Learning Machines LLC", b"thaipro.store")


def map_text(text):
    text = APP_ID.sub(lambda m: "store.thaipro." + APP_ID_NEW[m.group(1)], text)
    return PATTERN.sub(lambda m: MAPPING[m.group(0)], text)


def upstream_tokens(data):
    spans = []
    for hit in UPSTREAM.finditer(data):
        start, end = hit.start(), hit.end()
        while start > 0 and data[start - 1] not in TOKEN_END:
            start -= 1
        while end < len(data) and data[end] not in TOKEN_END:
            end += 1
        spans.append((start, end))
    if FREEZE is not None:
        spans.extend(hit.span() for hit in FREEZE.finditer(data))
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def use_frozen_names(app):
    global FREEZE
    patterns = json.loads((HERE / "freeze.json").read_text(encoding="utf-8")).get(app, [])
    FREEZE = re.compile("|".join(patterns).encode()) if patterns else None


def map_bytes(data):
    data = own_links(data)
    out, last = [], 0
    for start, end in upstream_tokens(data):
        out.append(map_text(data[last:start].decode("utf-8", errors="surrogateescape")).encode("utf-8", errors="surrogateescape"))
        out.append(data[start:end])
        last = end
    out.append(map_text(data[last:].decode("utf-8", errors="surrogateescape")).encode("utf-8", errors="surrogateescape"))
    return b"".join(out)


def without_upstream_tokens(data):
    out, last = [], 0
    for start, end in upstream_tokens(data):
        out.append(data[last:start])
        last = end
    out.append(data[last:])
    return b"".join(out)


def is_text(path):
    try:
        if path.stat().st_size > MAX_BYTES:
            return False
        with open(path, "rb") as handle:
            return b"\0" not in handle.read(8192)
    except OSError:
        return False


def walk(root):
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d != ".git"]
        yield Path(current), dirs, files


def apply_literals(root, app):
    entries = json.loads((HERE / "literals.json").read_text(encoding="utf-8")).get(app, [])
    for entry in entries:
        path = Path(root) / entry["file"]
        text = path.read_text(encoding="utf-8")
        if entry["old"] not in text:
            if entry.get("optional"):
                continue
            sys.exit(f"error: {entry['file']} no longer contains the text literals.json replaces; update the entry")
        path.write_text(text.replace(entry["old"], entry["new"]), encoding="utf-8")
    return len(entries)


def rebrand(root, app):
    root = Path(root)
    use_frozen_names(app)
    for pattern in REMOVE_GLOBS:
        for path in root.glob(pattern):
            if path.is_file():
                path.unlink()
    changed = 0
    for current, _dirs, files in walk(root):
        for name in files:
            if name.startswith(SKIP_CONTENT_PREFIXES):
                continue
            path = current / name
            if path.is_symlink() or not is_text(path):
                continue
            before = path.read_bytes()
            after = map_bytes(before)
            if after != before:
                path.write_bytes(after)
                changed += 1
    renamed = 0
    for current, dirs, files in reversed(list(walk(root))):
        for name in files + dirs:
            new = map_text(name)
            if new == name:
                continue
            target = current / new
            if target.exists():
                sys.exit(f"error: cannot rename {current / name} to {new}: target exists")
            (current / name).rename(target)
            renamed += 1
    literals = apply_literals(root, app)
    print(f"brand    {changed} files rewritten, {renamed} paths renamed, {literals} literals replaced")


def leftovers(root):
    found = []
    for current, dirs, files in walk(root):
        for name in files + dirs:
            if ANY_CASE.search(name):
                found.append(str((current / name).relative_to(root)))
        for name in files:
            if name.startswith(SKIP_CONTENT_PREFIXES):
                continue
            path = current / name
            if path.is_symlink() or not is_text(path):
                continue
            body = without_upstream_tokens(path.read_bytes()).decode("utf-8", errors="replace")
            hit = ANY_CASE.search(body)
            if hit:
                found.append(f"{path.relative_to(root)}: {hit.group(0)}")
    return found


def unreplaced_icons(root, overlay):
    root, overlay = Path(root), Path(overlay)
    missing = []
    for folder, prefix in (("assets/app-icon", ""), ("docs/brand", "artcraft-")):
        base = root / folder
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            if path.is_file() and path.suffix.lower() in (".png", ".ico", ".icns", ".svg") and path.name.startswith(prefix):
                rel = path.relative_to(root)
                if not (overlay / rel).is_file():
                    missing.append(str(rel))
    return missing


VERSION_FORMAT = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$")
WORKSPACE_VERSION = re.compile(r'(\[workspace\.package\][^\[]*?^version\s*=\s*")([^"]+)(")', re.M | re.S)


def set_version(root, version):
    if not VERSION_FORMAT.match(version):
        sys.exit(f"error: VERSION {version!r} is not x.y.z or x.y.z-pre")
    manifest = Path(root) / "Cargo.toml"
    text = manifest.read_text(encoding="utf-8")
    found = WORKSPACE_VERSION.search(text)
    if not found:
        sys.exit("error: no [workspace.package] version in Cargo.toml")
    old = found.group(2)
    if old == version:
        print(f"version  {version} (unchanged)")
        return
    manifest.write_text(WORKSPACE_VERSION.sub(lambda m: m.group(1) + version + m.group(3), text, count=1), encoding="utf-8")
    lock = Path(root) / "Cargo.lock"
    moved = 0
    if lock.is_file():
        blocks = lock.read_text(encoding="utf-8").split("\n[[package]]\n")
        for index, block in enumerate(blocks):
            if "\nsource = " not in block and f'\nversion = "{old}"\n' in block + "\n":
                blocks[index] = block.replace(f'\nversion = "{old}"\n', f'\nversion = "{version}"\n', 1)
                moved += 1
        lock.write_text("\n[[package]]\n".join(blocks), encoding="utf-8")
    print(f"version  {old} -> {version} ({moved} workspace crates in Cargo.lock)")


def verify(root, overlay, app):
    use_frozen_names(app)
    bad = leftovers(root)
    for line in bad[:25]:
        print(f"leftover {line}", file=sys.stderr)
    icons = unreplaced_icons(root, overlay)
    for line in icons:
        print(f"icon not replaced {line}", file=sys.stderr)
    if bad or icons:
        sys.exit(f"error: {len(bad)} old names and {len(icons)} upstream icons survived the rebrand")
    print("verify   no old name and no upstream icon left")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "rebrand" and len(sys.argv) == 4:
        rebrand(sys.argv[2], sys.argv[3])
    elif command == "set-version" and len(sys.argv) == 4:
        set_version(sys.argv[2], sys.argv[3])
    elif command == "verify" and len(sys.argv) == 5:
        verify(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(__doc__)
