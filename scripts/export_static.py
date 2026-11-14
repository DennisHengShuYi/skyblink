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
STATIC_FILES = ("manifest.json", "cube.bin", "deep.png")
STATIC_PREFIXES = ("visit_", "flags_", "stack_")


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
            for f in src.iterdir():
                if f.name in STATIC_FILES or f.name.startswith(STATIC_PREFIXES):
                    shutil.copy2(f, dst / f.name)
            m = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
            m["siblings"] = {d: k for d, k in siblings.items() if d != det}
            (dst / "manifest.json").write_text(json.dumps(m), encoding="utf-8")
            keys.append(key)

    shutil.copy2(FEATURED / "featured.json", data / "featured.json")
    (ROOT / "backend" / "skyblink" / "static_keys.json").write_text(json.dumps(sorted(keys)), encoding="utf-8")
    size = sum(f.stat().st_size for f in PUBLIC.rglob("*") if f.is_file())
    print(f"exported {len(keys)} views, {size / 1e6:.1f} MB into {PUBLIC}")


if __name__ == "__main__":
    main()
