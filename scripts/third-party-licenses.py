#!/usr/bin/env python3
"""Write the third-party license notice for an app built on an upstream base.

Usage: scripts/third-party-licenses.py <app> <output.md>

Reads upstream/<app> (read-only): its LICENSE is copied verbatim, then every library it ships is
listed with its license, looked up from the npm registry (bun.lock, runtime dependencies of the
web workspace only) and from `cargo metadata` (Cargo.lock, no dev dependencies). Libraries under
copyleft, weak-copyleft or unclear terms are called out in their own section. Nothing from the
upstream tree is executed or installed.
"""
import json
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_WORKSPACE = "apps/web"
FLAG = re.compile(r"GPL|AGPL|LGPL|MPL|SSPL|BUSL|CC-BY-NC|CC-BY-SA|SEE LICENSE|UNLICENSED|UNKNOWN|PROPRIETARY|ELASTIC", re.I)


def needs_attention(license_expr):
    """Flag an expression unless it offers a permissive alternative (`X OR Y`)."""
    if " OR " in license_expr:
        return all(needs_attention(part) for part in license_expr.split(" OR "))
    return bool(FLAG.search(license_expr))


def read_env(path):
    out = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            out[key.strip()] = value.strip()
    return out


def find_lock(app, src):
    for candidate in (
        ROOT / "apps" / app / "overlay" / WEB_WORKSPACE / "bun.lock",
        src / WEB_WORKSPACE / "bun.lock",
        src / "bun.lock",
    ):
        if candidate.exists():
            return candidate
    return None


def npm_packages(app, src):
    lock = find_lock(app, src)
    if lock is None:
        return []
    data = json.loads(re.sub(r",(\s*[}\]])", r"\1", lock.read_text(encoding="utf-8")))
    pkgs = data["packages"]
    workspaces = data["workspaces"]
    ws = workspaces.get(WEB_WORKSPACE) or workspaces.get("", {})
    stack = list(ws.get("dependencies", {})) + list(ws.get("optionalDependencies", {}))
    reach = set()
    while stack:
        name = stack.pop()
        if name in reach or name not in pkgs:
            continue
        reach.add(name)
        meta = pkgs[name][2] if len(pkgs[name]) > 2 and isinstance(pkgs[name][2], dict) else {}
        for kind in ("dependencies", "optionalDependencies", "peerDependencies"):
            stack.extend(meta.get(kind, {}))

    def lookup(key):
        ident = pkgs[key][0]
        name, _, version = ident.rpartition("@")
        url = "https://registry.npmjs.org/%s/%s" % (urllib.parse.quote(name, safe="@"), version)
        for _ in range(4):
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "license-audit"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    meta = json.load(resp)
                lic = meta.get("license")
                if isinstance(lic, dict):
                    lic = lic.get("type")
                if lic is None and meta.get("licenses"):
                    lic = " OR ".join(x.get("type", "?") for x in meta["licenses"])
                repo = meta.get("repository")
                repo = repo.get("url") if isinstance(repo, dict) else repo
                return {"kind": "npm", "name": name, "version": version, "license": lic or "UNKNOWN", "repo": repo or ""}
            except Exception:
                continue
        return {"kind": "npm", "name": name, "version": version, "license": "UNKNOWN (registry lookup failed)", "repo": ""}

    with ThreadPoolExecutor(16) as pool:
        return list(pool.map(lookup, sorted(reach)))


def cargo_packages(src):
    manifest = src / "Cargo.toml"
    if not manifest.exists():
        return []
    with tempfile.TemporaryDirectory() as neutral:
        meta = json.loads(
            subprocess.run(
                ["cargo", "metadata", "--format-version", "1", "--locked", "--manifest-path", str(manifest)],
                cwd=neutral, check=True, capture_output=True, text=True,
            ).stdout
        )
    pk = {p["id"]: p for p in meta["packages"]}
    members = set(meta["workspace_members"])
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    reach, stack = set(), list(members)
    while stack:
        i = stack.pop()
        if i in reach:
            continue
        reach.add(i)
        for dep in nodes[i]["deps"]:
            if all(k["kind"] == "dev" for k in dep["dep_kinds"]):
                continue
            stack.append(dep["pkg"])
    out = []
    for i in reach - members:
        p = pk[i]
        lic = p.get("license") or ("see " + str(p["license_file"]) if p.get("license_file") else "UNKNOWN")
        out.append({"kind": "crate", "name": p["name"], "version": p["version"], "license": lic, "repo": p.get("repository") or ""})
    return sorted(out, key=lambda x: (x["name"], x["version"]))


def main():
    app, out_path = sys.argv[1], Path(sys.argv[2])
    src = ROOT / "upstream" / app
    cfg = read_env(ROOT / "apps" / app / "app.env")
    upstream_license = (src / "LICENSE").read_text(encoding="utf-8").strip()
    sha = subprocess.run(["git", "-C", str(src), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()

    npm, crates = npm_packages(app, src), cargo_packages(src)
    flagged = [p for p in npm + crates if needs_attention(p["license"])]

    lines = [
        "# Giấy phép bên thứ ba",
        "",
        "%s là bản tuỳ biến dựa trên **%s** (https://github.com/%s, commit %s), phát hành theo giấy phép MIT. Thông báo bản quyền và giấy phép gốc được giữ nguyên văn dưới đây." % (cfg.get("BRAND_NAME", app), app, cfg["UPSTREAM_REPO"], sha),
        "",
        "## %s" % app,
        "",
        "```text",
        upstream_license,
        "```",
        "",
        "Phần mã do chúng tôi tự viết thêm nằm ngoài thư mục gốc của dự án này và theo giấy phép của kho chứa nó.",
        "",
    ]

    if flagged:
        lines += [
            "## Thư viện cần chú ý",
            "",
            "Các thư viện dưới đây theo giấy phép copyleft (toàn phần hoặc theo từng file) hoặc chưa rõ giấy phép. Khi phân phối, phải giữ nguyên thông báo của chúng, không sửa file của chúng nếu chưa sẵn sàng công bố phần sửa theo cùng giấy phép, và với LGPL phải cho phép người dùng thay thế thư viện.",
            "",
            "| Thư viện | Phiên bản | Giấy phép |",
            "| --- | --- | --- |",
        ]
        lines += ["| %s | %s | %s |" % (p["name"], p["version"], p["license"]) for p in flagged]
        lines.append("")

    for title, group in (("Thư viện JavaScript đi kèm bản web", npm), ("Thư viện Rust đi kèm bản desktop", crates)):
        if not group:
            continue
        lines += ["## %s (%d)" % (title, len(group)), "", "| Thư viện | Phiên bản | Giấy phép |", "| --- | --- | --- |"]
        lines += ["| %s | %s | %s |" % (p["name"], p["version"], p["license"]) for p in group]
        lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print("%s: %d npm, %d crates, %d flagged -> %s" % (app, len(npm), len(crates), len(flagged), out_path))


if __name__ == "__main__":
    main()
