"""Planet X Replay, step 0: did SPHEREx photograph Pluto several times in one visit?

Offline, gentle, run once by hand (not by tests, not in a loop):
1. one NASA JPL Horizons request for Pluto's daily sky positions over the survey so far;
2. one IRSA image search (per configured data release) every SAMPLE_DAYS, at Pluto's
   position that day, keeping pictures taken within +/- KEEP_DAYS of it (Pluto then lies
   well inside SPHEREx's 3.5-degree detector).
It prints, for each group of pictures, how many there are, over how many days, and how
many SPHEREx pixels a day Pluto crawls then. The pixel-flag question (does cleaning blank
Pluto as TRANSIENT/OUTLIER?) needs one real cutout afterwards and is not answered here.

    python scripts/check_pluto_coverage.py
"""
from __future__ import annotations

import math
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from skyblink.archive import find_visits  # noqa: E402

HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
START, STOP = "2025-04-01", "2026-10-01"
SAMPLE_DAYS, KEEP_DAYS, PIXEL_ARCSEC = 20, 3.0, 6.15


def pluto_track() -> list[tuple[float, float, float, float]]:
    """[(mjd, ra, dec, arcsec_per_day)] from Horizons, one row a day."""
    params = {
        "format": "text", "COMMAND": "'999'", "OBJ_DATA": "'NO'", "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'500@399'", "START_TIME": f"'{START}'",
        "STOP_TIME": f"'{STOP}'", "STEP_SIZE": "'1d'", "QUANTITIES": "'1,3'", "ANG_FORMAT": "'DEG'",
        "CAL_FORMAT": "'JD'",
    }
    text = httpx.get(HORIZONS, params=params, timeout=120).text
    rows = text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines()
    out = []
    for r in rows:
        jd, ra, dec, dra, ddec = (float(x) for x in r.split()[:5])
        out.append((jd - 2400000.5, ra, dec, math.hypot(dra, ddec) * 24))
    return out


def main() -> None:
    track = pluto_track()
    found: dict[str, tuple[float, float]] = {}  # obs_id -> (mjd, rate)
    for k in range(0, len(track), SAMPLE_DAYS):
        mjd, ra, dec, rate = track[k]
        try:
            visits = find_visits(ra, dec)
        except RuntimeError as exc:
            print(f"MJD {mjd:.0f}: archive error ({exc}); stopping. Try again later.", file=sys.stderr)
            return
        near = [v for v in visits if abs(v.mjd - mjd) <= KEEP_DAYS]
        for v in near:
            found[v.obs_id] = (v.mjd, rate)
        print(f"MJD {mjd:.0f} RA {ra:.3f} Dec {dec:.3f}: {len(near)} pictures within {KEEP_DAYS} days", file=sys.stderr)
        time.sleep(3)  # be gentle with IRSA
    times = sorted(found.values())
    groups: list[list[tuple[float, float]]] = []
    for t in times:
        if groups and t[0] - groups[-1][-1][0] < 30:
            groups[-1].append(t)
        else:
            groups.append([t])
    for g in groups:
        span = g[-1][0] - g[0][0]
        rate = sum(r for _, r in g) / len(g) / PIXEL_ARCSEC
        verdict = "GOOD for a replay" if len(g) >= 3 and span >= 1 and rate >= 2 else "weak"
        print(f"{len(g)} pictures over {span:.1f} days, Pluto crawls ~{rate:.1f} px/day: {verdict}")
    if not groups:
        print("No SPHEREx pictures of Pluto found in this period.")


if __name__ == "__main__":
    main()
