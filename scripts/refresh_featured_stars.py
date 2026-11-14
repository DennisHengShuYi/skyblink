"""Refresh only the Gaia star lists of the featured views (no IRSA, no image rebuild).

Usage (from repo root): python scripts/refresh_featured_stars.py
Asks ESA Gaia once per featured position, rewrites each manifest's `stars`, then run
scripts/export_static.py so public/ picks up the change.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink import storage  # noqa: E402
from skyblink.config import FEATURED_DIR  # noqa: E402
from skyblink.stars import gaia_stars  # noqa: E402


def main() -> None:
    manifests = sorted(FEATURED_DIR.glob("*/D[1-6]/manifest.json"))
    by_position: dict[str, list] = {}
    updated = 0
    for path in manifests:
        m = json.loads(path.read_text(encoding="utf-8"))
        pos = path.parent.parent.name
        if pos not in by_position:  # one Gaia query per position, shared by its detectors
            by_position[pos] = gaia_stars(m["ra"], m["dec"], m["fov"] * math.sqrt(2) / 2)
        if not by_position[pos] and m.get("stars"):
            print(f"{pos}: Gaia returned nothing; keeping the existing star list")
            continue
        storage.atomic_write(path, json.dumps({**m, "stars": by_position[pos]}).encode("utf-8"))
        updated += 1
    print(f"updated {updated} manifests from {len(by_position)} Gaia queries")


if __name__ == "__main__":
    main()
