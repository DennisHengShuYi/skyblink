"""Pre-build the featured targets into featured/ so the demo never waits on the archive.

Usage (from repo root):  python scripts/build_featured.py [slug ...] [--dets D2,D6]
Re-run after a new SPHEREx release (add it to config.COLLECTIONS first).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink.builder import build_view  # noqa: E402
from skyblink.config import DETECTORS, FEATURED_DIR  # noqa: E402
from skyblink.imaging import view_key  # noqa: E402

log = logging.getLogger("build_featured")

# Positions are for ~2025.9 (mid SPHEREx DR1): Gaia DR3 propagated with its proper
# motion, or (WISE 0855, eps Ind B) the published position and proper motion.
FEATURED = [
    {
        "slug": "wise0855", "name": "WISE 0855−0714", "ra": 133.75991, "dec": -7.24225, "fov": 0.1, "det": "D6",
        "kind": "motion",
        "caption": "The coldest known brown dwarf, 7.4 light-years away. Too cold to see in visible light, it shines at "
                   "4–5 µm (D6). It crawls ~8″ a year — watch the faint dot at the crosshair shift right (west) "
                   "between May 2025 and April 2026, or try Difference.",
    },
    {
        "slug": "barnard", "name": "Barnard's Star", "ra": 269.44629, "dec": 4.76792, "fov": 0.1, "det": "D2",
        "kind": "motion",
        "caption": "The fastest-moving star in our sky: 10.4″ a year northward. It is so bright SPHEREx saturates "
                   "(amber in the flags overlay), but the bright core still steps up between surveys — Difference "
                   "shows a blue/red pair.",
    },
    {
        "slug": "epsindib", "name": "Epsilon Indi B", "ra": 331.09592, "dec": -56.80094, "fov": 0.1, "det": "D6",
        "kind": "motion",
        "caption": "A pair of brown dwarfs orbiting the star Epsilon Indi (just outside this frame), 12 light-years "
                   "away, moving 4.7″ a year to the south-east. Compare D2 and D6: brown dwarfs are far redder "
                   "than normal stars.",
    },
    {
        "slug": "rwaur", "name": "RW Aurigae", "ra": 76.95608, "dec": 30.40120, "fov": 0.1, "det": "D3",
        "kind": "variable",
        "caption": "A young star still wrapped in its planet-forming disk, with deep, irregular dimming events. "
                   "It doesn't move — watch its brightness change between surveys, and click it for a spectrum.",
    },
    {
        "slug": "rdra", "name": "R Draconis", "ra": 248.16738, "dec": 66.75501, "fov": 0.1, "det": "D3",
        "kind": "variable",
        "caption": "A pulsating red giant (Mira variable) with a ~246-day cycle. SPHEREx catches it at different "
                   "phases each survey; click it to see water absorption in its infrared spectrum.",
    },
]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--dets", default=",".join(DETECTORS))
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    dets = [d for d in args.dets.split(",") if d in DETECTORS]
    targets = [t for t in FEATURED if not args.slugs or t["slug"] in args.slugs]

    jobs = [(t, d) for t in targets for d in dets]
    t0 = time.time()
    failed = []
    with ThreadPoolExecutor(args.workers) as pool:
        futs = {
            pool.submit(build_view, t["ra"], t["dec"], t["fov"], d, lambda p, m: None, FEATURED_DIR, None): (t["slug"], d)
            for t, d in jobs
        }
        for f in as_completed(futs):
            slug, d = futs[f]
            try:
                m = f.result()
                log.info("%s %s: %d frames, %d windows (%.0fs)", slug, d, len(m["visits"]), len(m["stacks"]), time.time() - t0)
            except Exception as exc:
                failed.append((slug, d))
                log.error("%s %s failed: %s", slug, d, exc)

    listing = [{**{k: t[k] for k in ("slug", "name", "ra", "dec", "fov", "det", "caption", "kind")},
                "key": view_key(t["ra"], t["dec"], t["fov"], t["det"])} for t in FEATURED]
    (FEATURED_DIR / "featured.json").write_text(json.dumps(listing, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("done in %.0fs; failed: %s", time.time() - t0, failed or "none")


if __name__ == "__main__":
    main()
