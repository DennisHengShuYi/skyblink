"""Refresh the Gaia star lists of the featured views (one ESA Gaia request per position).

Adds fields that newer code reads (parallax; unknown motions as null instead of 0.0)
without touching any image. All six bands of a position share one field, so one query
serves all of them.

    python scripts/refresh_featured_stars.py
Then run scripts/export_static.py.
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink import storage  # noqa: E402
from skyblink.config import FEATURED_DIR  # noqa: E402
from skyblink.stars import gaia_stars  # noqa: E402


def main() -> None:
    by_position: dict[str, list[Path]] = {}
    for m in sorted(FEATURED_DIR.glob("*/D[1-6]/manifest.json")):
        by_position.setdefault(m.parent.parent.name, []).append(m)
    for hash_, manifests in by_position.items():
        first = json.loads(manifests[0].read_text(encoding="utf-8"))
        stars = gaia_stars(first["ra"], first["dec"], first["fov"] * math.sqrt(2) / 2)
        if not stars:
            print(f"{hash_}: Gaia returned nothing; left unchanged", file=sys.stderr)
            continue
        for m in manifests:
            manifest = json.loads(m.read_text(encoding="utf-8"))
            storage.atomic_write(m, json.dumps({**manifest, "stars": stars}).encode("utf-8"))
        with_plx = sum(1 for s in stars if s["parallax"] is not None)
        print(f"{hash_}: {len(stars)} stars ({with_plx} with parallax) -> {len(manifests)} manifests", file=sys.stderr)
        time.sleep(2)  # be gentle with ESA


if __name__ == "__main__":
    main()
