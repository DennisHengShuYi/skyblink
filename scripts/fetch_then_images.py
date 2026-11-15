"""Fetch the dated "then" pictures for SkyBlink's Then & Now tool (Decades Blink).

One-off, offline, a handful of requests: for each motion target, a single-band survey
image (AllWISE W2 ~2010, 2MASS K ~1999) is cut from CDS hips2fits on exactly the view's
north-up / east-left TAN footprint, stretched on its own, and saved as a static frontend
asset (frontend/thennow/<slug>-<survey>.png, the names js/thennow-ui.js looks for). The
demo then never depends on CDS being up; without these files the tool falls back to live
hips2fits. Targets, survey dates and credits must match THEN_TARGETS in js/thennow.js.

Only single-epoch-ish surveys are used: never unWISE/CatWISE (multi-year stacks) or DSS2
colour (plates years apart, which show fast movers twice).

    python scripts/fetch_then_images.py
"""
from __future__ import annotations

import io
import sys
import time
from pathlib import Path

import httpx
import numpy as np
from astropy.io import fits
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "thennow"
HOSTS = [
    "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",
    "https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits",
]
NPIX, SCALE_ARCSEC, OVERSAMPLE = 59, 6.15, 3
SURVEYS = {
    "allwise-w2": {"hips": "CDS/P/allWISE/W2", "label": "WISE (AllWISE, 4.6 µm)",
                   "credit": "NASA WISE / AllWISE via IRSA and CDS hips2fits"},
    "2mass-k": {"hips": "CDS/P/2MASS/K", "label": "2MASS (2.2 µm)",
                "credit": "2MASS (UMass / IPAC-Caltech, NASA, NSF) via CDS hips2fits"},
}
# Survey dates are the AllWISE w2mjdmean / 2MASS jdate of catalogue sources in each field
# (IRSA Gator, looked up once when this table was written).
TARGETS = [
    {"slug": "barnard", "hash": "768d33c99b4c", "ra": 269.44629, "dec": 4.76792,
     "survey": "allwise-w2", "mjd": 55358.9},
    {"slug": "wise0855", "hash": "e01445dc3f16", "ra": 133.75991, "dec": -7.24225,
     "survey": "allwise-w2", "mjd": 55408.5},
    {"slug": "epsindib", "hash": "85387de0fcfc", "ra": 331.09592, "dec": -56.80094,
     "survey": "2mass-k", "mjd": 51497.6},
]


def fetch(t: dict) -> np.ndarray:
    size = NPIX * OVERSAMPLE
    params = {
        "hips": SURVEYS[t["survey"]]["hips"], "width": size, "height": size,
        "fov": f"{NPIX * SCALE_ARCSEC / 3600:.5f}", "projection": "TAN", "coordsys": "icrs",
        "rotation_angle": "0.0", "ra": t["ra"], "dec": t["dec"], "format": "fits",
    }
    last = None
    for host in HOSTS:
        try:
            r = httpx.get(host, params=params, timeout=120)
            r.raise_for_status()
            with fits.open(io.BytesIO(r.content)) as hdul:
                return np.asarray(hdul[0].data, dtype=float)
        except (httpx.HTTPError, OSError) as exc:  # try the mirror
            last = exc
    raise RuntimeError(f"hips2fits failed for {t['slug']}: {last}")


def to_png(data: np.ndarray, path: Path) -> dict:
    """Own asinh stretch (sky at black, top 0.2% saturated). FITS row 0 is south: flip."""
    finite = data[np.isfinite(data)]
    lo, hi = np.percentile(finite, 25), np.percentile(finite, 99.8)
    soft = max((hi - lo) * 0.02, 1e-9)
    x = np.clip((np.nan_to_num(data, nan=lo) - lo) / soft, 0, None)
    y = np.arcsinh(x) / np.arcsinh((hi - lo) / soft)
    img = (np.clip(y, 0, 1) * 255).astype(np.uint8)[::-1]
    Image.fromarray(img, mode="L").save(path, optimize=True)
    return {"lo": float(lo), "hi": float(hi)}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for t in TARGETS:
        data = fetch(t)
        name = f"{t['slug']}-{t['survey']}.png"
        to_png(data, OUT / name)
        print(f"{t['slug']}: {data.shape} -> {name}", file=sys.stderr)
        time.sleep(2)  # be gentle with CDS


if __name__ == "__main__":
    main()
