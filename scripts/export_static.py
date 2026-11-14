"""Assemble public/ for static hosting (Vercel): frontend + featured views.

Usage (from repo root): python scripts/export_static.py
- copies frontend/ to public/
- copies each featured view (PNGs, cube.bin, manifest.json) to public/data/<key>/
- adds "siblings" (other detectors at the same position) to every manifest
- writes backend/skyblink/static_keys.json so the serverless API knows what is pre-built
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
FEATURED = ROOT / "featured"
PUBLIC = ROOT / "public"


def _referenced_files(manifest: dict) -> set[str]:
    urls = [manifest["deep"]["png"], manifest["cube"]["url"]]
    urls += [s["png"] for s in manifest["stacks"]]
    urls += [u for v in manifest["visits"] for u in (v["png"], v["flags_png"])]
    return {u.rsplit("/", 1)[-1] for u in urls if u}


def main() -> None:
    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    shutil.copytree(FRONTEND, PUBLIC)
    data = PUBLIC / "data"
    data.mkdir()

    views: dict[str, dict[str, Path]] = {}
    for manifest in sorted(FEATURED.glob("*/D[1-6]/manifest.json")):
        pos_dir = manifest.parent
        views.setdefault(pos_dir.parent.name, {})[pos_dir.name] = pos_dir

    keys: list[str] = []
    for pos, dets in views.items():
        siblings = {det: f"{pos}-{det}" for det in sorted(dets)}
        for det, src in dets.items():
            key = f"{pos}-{det}"
            dst = data / key
            dst.mkdir()
            m = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
            for name in _referenced_files(m):  # only what this build references, no stale files
                shutil.copy2(src / name, dst / name)
            m["siblings"] = {d: k for d, k in siblings.items() if d != det}
            (dst / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
            keys.append(key)

    shutil.copy2(FEATURED / "featured.json", data / "featured.json")
    (ROOT / "backend" / "skyblink" / "static_keys.json").write_text(json.dumps(sorted(keys)), encoding="utf-8")
    size = sum(f.stat().st_size for f in PUBLIC.rglob("*") if f.is_file())
    print(f"exported {len(keys)} views, {size / 1e6:.1f} MB into {PUBLIC}")


if __name__ == "__main__":
    main()
