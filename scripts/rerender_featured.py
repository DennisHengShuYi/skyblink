"""Re-render featured PNG frames from saved arrays (no archive access).

Use after changing the display stretch:  python scripts/rerender_featured.py
Then run scripts/export_static.py.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink import storage  # noqa: E402
from skyblink.config import FEATURED_DIR  # noqa: E402
from skyblink.imaging import asinh_stretch_params, gray_png  # noqa: E402


def rerender(view_dir: Path) -> None:
    manifest = json.loads((view_dir / "manifest.json").read_text(encoding="utf-8"))
    with np.load(view_dir / "arrays.npz") as a:
        visits, stacks, deep = a["img"], a["stack_img"], a["deep_img"]
    if len(visits) != len(manifest["visits"]) or len(stacks) != len(manifest["stacks"]):
        raise ValueError(f"{view_dir}: arrays and manifest disagree; rebuild this view")
    stretch = asinh_stretch_params(list(stacks) + list(visits), noise_arrays=list(stacks))
    for i, img in enumerate(visits):
        storage.atomic_write(view_dir / f"visit_{i}.png", gray_png(img, stretch))
    for row, img in zip(manifest["stacks"], stacks):
        storage.atomic_write(view_dir / f"stack_{row['window']}.png", gray_png(img, stretch))
    storage.atomic_write(view_dir / "deep.png", gray_png(deep, stretch))
    storage.atomic_write(view_dir / "manifest.json", json.dumps({**manifest, "stretch": stretch}).encode("utf-8"))


def main() -> None:
    dirs = sorted(d.parent for d in FEATURED_DIR.glob("*/D[1-6]/manifest.json"))
    for d in dirs:
        rerender(d)
    print(f"re-rendered {len(dirs)} views")


if __name__ == "__main__":
    main()
