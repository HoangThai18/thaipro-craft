#!/usr/bin/env python3
"""Render the ThaiCutCut icons and logos into the overlays of both versions.

    gen_thaicutcut.py        (needs Pillow; run on a Mac for a native .icns)

ThaiCutCut 1.0 (apps/opencut-classic) and 2.0 (apps/opencut) already carry their own icon files in
the overlay, so every file there is rendered again in place, keeping its size and type. The
pictures come from scripts/brand/icons/: one tile per version and the horizontal logo.
"""
import base64
import io
import sys
from pathlib import Path

from PIL import Image

import gen_icons as icons

ROOT = icons.ROOT
BRAND = ROOT / "scripts" / "brand" / "icons"
TARGETS = {"opencut-classic": "opencut-classic.png", "opencut": "opencut.png"}
LOGO_HEIGHT_RATIO = 1080 / 3714


def tile_of(name):
    master = Image.open(BRAND / name).convert("RGBA")
    box = master.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    tile = master.crop(box)
    side = max(tile.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(tile, ((side - tile.width) // 2, (side - tile.height) // 2))
    return square.resize((1024, 1024), Image.LANCZOS)


def horizontal():
    logo = Image.open(BRAND / "thaicutcut-horizontal.png").convert("RGBA")
    return logo.crop(logo.getchannel("A").getbbox())


def text_only():
    logo = Image.open(BRAND / "thaicutcut-horizontal.png").convert("RGBA")
    box = logo.getchannel("A").getbbox()
    return logo.crop((1150, box[1], box[2], box[3]))


def wrap_svg(image, path, width):
    height = round(width * image.height / image.width)
    buffer = io.BytesIO()
    image.resize((min(image.width, 1600), round(min(image.width, 1600) * image.height / image.width)), Image.LANCZOS).save(
        buffer, format="PNG", optimize=True
    )
    data = base64.b64encode(buffer.getvalue()).decode()
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="ThaiCutCut"><title>ThaiCutCut</title>'
        f'<image width="{width}" height="{height}" xlink:href="data:image/png;base64,{data}"/></svg>\n',
        encoding="utf-8",
    )


def ico_sizes(path):
    with Image.open(path) as handle:
        return sorted(handle.info.get("sizes", {(256, 256)}))


def render(app):
    tile = tile_of(TARGETS[app])
    overlay = ROOT / "apps" / app / "overlay"
    count = 0
    for path in sorted(overlay.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(overlay).as_posix()
        suffix = path.suffix.lower()
        in_brand = "icon" in path.name.lower() or "logo" in path.name.lower() or "favicon" in path.name.lower() or "symbol" in path.name.lower() or "/logos/" in rel or rel.startswith("brand/") or path.name.endswith(".icns") or path.name.endswith(".ico")
        if not in_brand or rel.endswith(("THIRD_PARTY_LICENSES.md", "third-party-licenses.md")):
            continue
        if suffix == ".ico":
            sizes = ico_sizes(path)
            top = max(size[0] for size in sizes)
            tile.resize((top, top), Image.LANCZOS).save(path, format="ICO", sizes=sizes)
        elif suffix == ".icns":
            icons.save_icns(tile, path)
        elif suffix == ".png":
            with Image.open(path) as handle:
                width, height = handle.size
            icons.save_png(tile.resize((width, height), Image.LANCZOS), path)
        elif suffix == ".svg":
            name = path.name
            if name.startswith("text"):
                wrap_svg(text_only(), path, 1200)
            elif name.startswith("logo"):
                wrap_svg(horizontal(), path, 1600)
            else:
                icons.save_svg(tile, path)
        else:
            continue
        count += 1
    print(f"{app}: {count} files rendered")


if __name__ == "__main__":
    for app in sys.argv[1:] or TARGETS:
        render(app)
