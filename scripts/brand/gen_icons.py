#!/usr/bin/env python3
"""Render every icon file an upstream app ships from our own logo (scripts/brand/icons/<app>.png).

    gen_icons.py <app>...    (needs Pillow; run on a Mac for a native .icns)

For each file under assets/app-icon of the pinned upstream commit it writes a replacement with the
renamed path into apps/<app>/overlay/, so prepare.sh puts our icons where the build looks for them.
The outputs are committed: CI needs neither Pillow nor this script. brand.py verify fails the build
when an upstream icon is left without a replacement (for instance after a base upgrade adds one).
"""
import base64
import io
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import brand

ROOT = Path(__file__).resolve().parents[2]
ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
KEEP_OUT = (".attribution", "LICENSE.txt", "README.md")

README = """# {name} app icon

The {name} icon was made for thaipro.store and replaces the upstream artwork, which belongs to its
authors. Files are rendered from one master picture:

- `{lower}-1024.png`, `{lower}-macos-512.png` and `{lower}.icns`: macOS, on Apple's icon grid.
- `{lower}.ico`: Windows, 16 to 256 px.
- `hicolor/<size>/apps/`: Linux icon theme.
- `*.svg`: the same picture wrapped in a vector container.
"""
LICENSE = "The {name} icon is (c) thaipro.store and may be used with {name} only.\n"


def load_tile(app):
    master = Image.open(ROOT / "scripts" / "brand" / "icons" / f"{app}.png").convert("RGBA")
    box = master.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    tile = master.crop(box)
    side = max(tile.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(tile, ((side - tile.width) // 2, (side - tile.height) // 2))
    return square.resize((1024, 1024), Image.LANCZOS)


def on_mac_grid(tile, size):
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.paste(tile.resize((824, 824), Image.LANCZOS), (100, 100))
    return canvas.resize((size, size), Image.LANCZOS)


def save_png(image, path):
    image.save(path, format="PNG", optimize=True)


def save_ico(tile, path):
    tile.resize((256, 256), Image.LANCZOS).save(path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])


def save_icns(tile, path):
    if shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "icon.iconset"
            iconset.mkdir()
            for size in (16, 32, 128, 256, 512):
                on_mac_grid(tile, size).save(iconset / f"icon_{size}x{size}.png")
                on_mac_grid(tile, size * 2).save(iconset / f"icon_{size}x{size}@2x.png")
            subprocess.run(["iconutil", "-c", "icns", "-o", str(path), str(iconset)], check=True)
    else:
        on_mac_grid(tile, 1024).save(path, format="ICNS")


def save_svg(tile, path):
    buffer = io.BytesIO()
    tile.resize((512, 512), Image.LANCZOS).save(buffer, format="PNG", optimize=True)
    data = base64.b64encode(buffer.getvalue()).decode()
    path.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'viewBox="0 0 512 512" width="512" height="512">'
        f'<image width="512" height="512" xlink:href="data:image/png;base64,{data}"/></svg>\n',
        encoding="utf-8",
    )


FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
WORDMARK = "thaipro.store"
BRAND_DIR = "docs/brand"


def wordmark(width, height, ink):
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    size = int(height * 0.8)
    font = ImageFont.truetype(FONT, size)
    while font.getlength(WORDMARK) > width * 0.9:
        size -= 4
        font = ImageFont.truetype(FONT, size)
    ImageDraw.Draw(image).text((width // 2, height // 2), WORDMARK, font=font, fill=ink, anchor="mm")
    return image


def silhouette(tile, size):
    shape = tile.resize((size, size), Image.LANCZOS).getchannel("A")
    black = Image.new("RGBA", (size, size), (11, 11, 12, 255))
    black.putalpha(shape)
    return black


def svg_with_picture(image, viewbox, path):
    x, y, width, height = (float(v) for v in viewbox.split())
    buffer = io.BytesIO()
    shown = image.resize((1600, max(1, round(1600 * image.height / image.width))), Image.LANCZOS)
    shown.save(buffer, format="PNG", optimize=True)
    data = base64.b64encode(buffer.getvalue()).decode()
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{viewbox}">'
        f'<image x="{x}" y="{y}" width="{width}" height="{height}" xlink:href="data:image/png;base64,{data}"/></svg>\n',
        encoding="utf-8",
    )


def render_brand_marks(app, tile, overlay):
    src = ROOT / "upstream" / app
    names = subprocess.run(
        ["git", "-C", str(src), "ls-tree", "-r", "--name-only", "HEAD", BRAND_DIR],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    shutil.rmtree(overlay / BRAND_DIR, ignore_errors=True)
    written = 0
    for name in names:
        base = name.rsplit("/", 1)[-1]
        if not base.startswith("artcraft-") or base.endswith(".attribution"):
            continue
        data = subprocess.run(["git", "-C", str(src), "show", f"HEAD:{name}"], check=True, capture_output=True).stdout
        out = overlay / name
        out.parent.mkdir(parents=True, exist_ok=True)
        white = "-white" in base
        black = "-black" in base
        if base.endswith(".png"):
            width, height = Image.open(io.BytesIO(data)).size
            if "logo" in base:
                picture = wordmark(width, height, (255, 255, 255, 255) if white else (11, 11, 12, 255))
            else:
                picture = silhouette(tile, width) if black else tile.resize((width, height), Image.LANCZOS)
            save_png(picture, out)
        elif base.endswith(".svg"):
            viewbox = re.search(rb'viewBox="([^"]+)"', data).group(1).decode()
            _, _, width, height = (float(v) for v in viewbox.split())
            if "logo" in base:
                picture = wordmark(3200, round(3200 * height / width), (255, 255, 255, 255) if white else (11, 11, 12, 255))
            else:
                picture = silhouette(tile, 1024) if black else tile
            svg_with_picture(picture, viewbox, out)
        else:
            continue
        written += 1
    return written


def upstream_icons(app):
    src = ROOT / "upstream" / app
    names = subprocess.run(
        ["git", "-C", str(src), "ls-tree", "-r", "--name-only", "HEAD", "assets/app-icon"],
        check=True, capture_output=True, text=True,
    ).stdout.split()
    for name in names:
        data = subprocess.run(["git", "-C", str(src), "show", f"HEAD:{name}"], check=True, capture_output=True).stdout
        yield name, data


def render(app):
    tile = load_tile(app)
    entry = brand.NAMES[app]
    overlay = ROOT / "apps" / app / "overlay"
    shutil.rmtree(overlay / "assets" / "app-icon", ignore_errors=True)
    written = 0
    for name, data in upstream_icons(app):
        base = name.rsplit("/", 1)[-1]
        if base.endswith(KEEP_OUT) or base.startswith("icon-source."):
            continue
        out = overlay / brand.map_text(name)
        out.parent.mkdir(parents=True, exist_ok=True)
        if base.endswith(".ico"):
            save_ico(tile, out)
        elif base.endswith(".icns"):
            save_icns(tile, out)
        elif base.endswith(".svg"):
            save_svg(tile, out)
        elif base.endswith(".png"):
            width, height = Image.open(io.BytesIO(data)).size
            if width != height:
                sys.exit(f"error: {name} is not square")
            if base.endswith("-macos-512.png") or base.endswith("-1024.png"):
                save_png(on_mac_grid(tile, width), out)
            else:
                save_png(tile.resize((width, height), Image.LANCZOS), out)
        else:
            sys.exit(f"error: no rule for {name}")
        written += 1
    folder = overlay / "assets" / "app-icon"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "README.md").write_text(README.format(name=entry["new"], lower=entry["new"].lower()), encoding="utf-8")
    (folder / "LICENSE.txt").write_text(LICENSE.format(name=entry["new"]), encoding="utf-8")
    marks = render_brand_marks(app, tile, overlay)
    print(f"{app}: {written} icon files and {marks} brand images in {overlay.relative_to(ROOT)}")


if __name__ == "__main__":
    apps = sys.argv[1:] or sorted(brand.NAMES)
    for app in apps:
        render(app)
