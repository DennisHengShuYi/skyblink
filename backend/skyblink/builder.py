"""Build one view: find visits, fetch cutouts, align, stack, render, write manifest."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import math
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

import httpx
import numpy as np
from astropy.time import Time

from . import storage
from .archive import Visit, find_visits, group_windows
from .config import (
    BAND_UM,
    BUILD_BUDGET_S,
    CACHE_DIR,
    RAW_CACHE_MAX_BYTES,
    FETCH_CONCURRENCY,
    HTTP_TIMEOUT_S,
    MAX_VISITS_PER_BUILD,
    PIXEL_SCALE_ARCSEC,
    WINDOW_GAP_DAYS,
)
from .imaging import (
    asinh_stretch_params,
    encode_cube,
    flag_summary,
    flags_png,
    gray_png,
    grid_wcs,
    process_cutout,
    view_key,
    weighted_stack,
)
from .stars import gaia_stars

log = logging.getLogger(__name__)

Progress = Callable[[float, str], None]
CUTOUT_MARGIN = 1.5  # cutouts follow the detector axes, so pad to cover a rotated north-up grid
MIN_COVERAGE = 0.5
FETCH_RETRIES = 5
BACKOFF_BASE_S = 2.0
RETRY_STATUS = {429, 500, 502, 503, 504}
FITS_MAGIC = b"SIMPLE  ="
MAX_FAILED_FRACTION = 0.15
RAW_CACHE_DIR = CACHE_DIR / "raw"
# One cap on simultaneous IRSA cutout requests across every build in this process.
_IRSA_SLOTS = threading.BoundedSemaphore(FETCH_CONCURRENCY)
logging.getLogger("httpx").setLevel(logging.WARNING)


def _cap_visits(visits: list[Visit], cap: int) -> list[Visit]:
    """Evenly thin visits to at most `cap`, keeping every survey window represented."""
    if len(visits) <= cap:
        return visits
    step = len(visits) / cap
    return [visits[int(i * step)] for i in range(cap)]


def _raw_cache_path(url: str) -> Path:
    return RAW_CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".fits")


def _evict_raw_cache() -> None:
    """Keep the raw cutout cache under RAW_CACHE_MAX_BYTES, oldest files first."""
    try:
        files = sorted(RAW_CACHE_DIR.glob("*.fits"), key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in files)
        for p in files:
            if total <= RAW_CACHE_MAX_BYTES:
                break
            total -= p.stat().st_size
            p.unlink(missing_ok=True)
    except OSError as exc:
        log.warning("raw cache eviction failed: %s", exc)


def _fetch(client: httpx.Client, v: Visit, ra: float, dec: float, size: float, deadline: float | None) -> bytes:
    """Fetch one cutout, politely: shared concurrency cap, backoff on 429/5xx, on-disk cache."""
    url = f"{v.url}?center={ra:.6f},{dec:.6f}&size={size:.4f}"
    cached = _raw_cache_path(url)
    if cached.exists():
        return cached.read_bytes()
    last: Exception | None = None
    for attempt in range(FETCH_RETRIES + 1):
        if deadline is not None and time.monotonic() > deadline:
            raise TimeoutError("build time budget spent")
        try:
            with _IRSA_SLOTS:
                r = client.get(url)
            if r.status_code in RETRY_STATUS:
                raise httpx.HTTPStatusError(f"IRSA busy ({r.status_code})", request=r.request, response=r)
            r.raise_for_status()
            if not r.content.startswith(FITS_MAGIC):  # never cache an HTML/VOTable error page
                raise httpx.HTTPStatusError("not a FITS file", request=r.request, response=r)
            RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            storage.atomic_write(cached, r.content)
            return r.content
        except httpx.HTTPError as exc:
            last = exc
            if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code not in RETRY_STATUS:
                if exc.response.is_success:  # 200 with a non-FITS body: retry once more like a 5xx
                    continue
                break
            time.sleep(BACKOFF_BASE_S * (2 ** attempt) + random.uniform(0, 1))
    raise RuntimeError(f"cutout failed for {v.obs_id} {v.det}: {last}")


def _process_all(visits, ra, dec, fov, progress: Progress, deadline: float | None):
    target, npix = grid_wcs(ra, dec, fov)
    size = fov * CUTOUT_MARGIN
    results: dict[int, dict] = {}
    failures = 0
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=True) as client, ThreadPoolExecutor(FETCH_CONCURRENCY) as pool:
        futures = {pool.submit(_fetch, client, v, ra, dec, size, deadline): i for i, v in enumerate(visits)}
        for done, fut in enumerate(as_completed(futures), start=1):
            i = futures[fut]
            try:
                r = process_cutout(fut.result(), target, npix)
                if r["coverage"] >= MIN_COVERAGE:
                    results[i] = r
            except Exception as exc:  # one bad file must not sink the whole build
                failures += 1
                log.warning("skipping %s: %s", visits[i].obs_id, exc)
            progress(0.1 + 0.8 * done / len(visits), f"Aligned {done}/{len(visits)} SPHEREx images")
    return results, npix, failures


class _DiskSink:
    """Writes view files next to each other and returns their API URLs."""

    def __init__(self, out: Path, key: str) -> None:
        self.out, self.base = out, f"/api/png/{key}"

    def put(self, name: str, data: bytes) -> str:
        storage.atomic_write(self.out / name, data)
        return f"{self.base}/{name}"

    def put_cube(self, data: bytes) -> dict:
        return {"url": self.put("cube.bin", data), "b64": None}


class _InlineSink:
    """Returns files inline (data URIs / base64) for stateless serverless responses."""

    def put(self, name: str, data: bytes) -> str:
        return "data:image/png;base64," + base64.b64encode(data).decode("ascii")

    def put_cube(self, data: bytes) -> dict:
        return {"url": None, "b64": base64.b64encode(data).decode("ascii")}


def _iso(mjd: float) -> str:
    return Time(mjd, format="mjd").isot[:19]


def build_view(
    ra: float,
    dec: float,
    fov: float,
    det: str,
    progress: Progress,
    out_root: Path | None = None,
    budget_s: float | None = BUILD_BUDGET_S,
    inline: bool = False,
    max_visits: int = MAX_VISITS_PER_BUILD,
) -> dict:
    """Build one view.

    budget_s=None means no time limit (offline featured builds). inline=True writes nothing to
    disk and returns PNGs as data URIs and the float cube as base64 (serverless deployments).
    """
    deadline = time.monotonic() + budget_s if budget_s else None
    key = view_key(ra, dec, fov, det)
    _evict_raw_cache()
    progress(0.02, "Searching the SPHEREx archive at IRSA (can take ~15 s)")
    all_visits = find_visits(ra, dec, det)
    if not all_visits:
        raise LookupError("SPHEREx has no images of this position in this detector yet.")
    visits = _cap_visits(all_visits, max_visits)
    progress(0.1, f"Found {len(all_visits)} images; fetching {len(visits)}")

    results, npix, failures = _process_all(visits, ra, dec, fov, progress, deadline)
    if not results:
        raise RuntimeError("Could not fetch any usable SPHEREx cutouts here.")
    if failures > MAX_FAILED_FRACTION * len(visits):
        raise RuntimeError(f"IRSA failed to deliver {failures}/{len(visits)} cutouts; try again shortly.")

    kept = [(visits[i], results[i]) for i in sorted(results)]
    windows, tagged = group_windows([v for v, _ in kept], WINDOW_GAP_DAYS)
    by_obs = {(v.obs_id, v.det): v for v in tagged}
    frames = sorted(((by_obs[(v.obs_id, v.det)], r) for v, r in kept), key=lambda p: p[0].mjd)

    progress(0.92, "Stacking each survey window and rendering frames")
    stacks = []
    for w in windows:
        members = [r for v, r in frames if v.window == w["id"]]
        img, var = weighted_stack([m["img"] for m in members], [m["var"] for m in members])
        mjd = float(np.mean([m["mjd"] for m in members]))
        stacks.append({"window": w["id"], "img": img, "var": var, "mjd": mjd, "n": len(members),
                       "um_mean": float(np.mean([m["um_center"] for m in members]))})
    deep_img, deep_var = weighted_stack([s["img"] for s in stacks], [s["var"] for s in stacks])

    stretch = asinh_stretch_params([s["img"] for s in stacks] + [r["img"] for _, r in frames])
    sink = _InlineSink() if inline else _DiskSink(storage.view_dir(key, out_root), key)

    visit_rows = []
    for i, (v, r) in enumerate(frames):
        frac, counts = flag_summary(r["flags"])
        visit_rows.append({
            "i": i, "obs_id": v.obs_id, "window": v.window, "mjd": r["mjd"], "date": _iso(r["mjd"]),
            "um": round(r["um_center"], 4), "um_bw": round(r["bw_center"], 4),
            "png": sink.put(f"visit_{i}.png", gray_png(r["img"], stretch)),
            "flags_png": sink.put(f"flags_{i}.png", flags_png(r["flags"])),
            "file": v.url, "collection": v.collection,
            "flag_frac": round(frac, 4), "flag_counts": counts,
        })
    stack_rows = [{
        "window": s["window"], "png": sink.put(f"stack_{s['window']}.png", gray_png(s["img"], stretch)),
        "mjd": s["mjd"], "date": _iso(s["mjd"])[:10], "n": s["n"], "um_mean": round(s["um_mean"], 4),
    } for s in stacks]
    deep_url = sink.put("deep.png", gray_png(deep_img, stretch))
    cube = encode_cube([r["img"] for _, r in frames], [r["var"] for _, r in frames],
                       [r["um"] for _, r in frames], [s["img"] for s in stacks], deep_img)
    cube_meta = {
        **sink.put_cube(cube), "dtype": "float16", "npix": npix, "n_visits": len(frames),
        "n_stacks": len(stacks), "layout": ["img", "var", "um", "stack", "deep"], "row0": "north",
    }
    if not inline:
        buf = io.BytesIO()
        np.savez_compressed(
            buf,
            img=np.stack([r["img"] for _, r in frames]).astype(np.float32),
            var=np.stack([r["var"] for _, r in frames]).astype(np.float32),
            um=np.stack([r["um"] for _, r in frames]).astype(np.float32),
            mjd=np.array([r["mjd"] for _, r in frames]),
            window=np.array([v.window for v, _ in frames]),
            stack_img=np.stack([s["img"] for s in stacks]).astype(np.float32),
            deep_img=deep_img.astype(np.float32),
        )
        sink.put("arrays.npz", buf.getvalue())

    progress(0.97, "Looking up Gaia stars in the field")
    stars = gaia_stars(ra, dec, fov * math.sqrt(2) / 2)

    manifest = {
        "key": key, "ra": ra, "dec": dec, "fov": fov, "det": det,
        "grid": {"npix": npix, "scale_arcsec": PIXEL_SCALE_ARCSEC, "ctype": "TAN", "north_up": True, "east_left": True},
        "band": {"det": det, "um_min": BAND_UM[det][0], "um_max": BAND_UM[det][1]},
        "stretch": stretch,
        "windows": [{k: w[k] for k in ("id", "label", "mjd_start", "mjd_end", "n")} for w in windows],
        "stacks": stack_rows,
        "deep": {"png": deep_url, "n": len(frames)},
        "cube": cube_meta,
        "visits": visit_rows,
        "stars": stars,
        "total_found": len(all_visits),
        "failed": failures,
        "notes": [],
    }
    if not inline:
        sink.put("manifest.json", json.dumps(manifest).encode("utf-8"))  # last: marks the view complete
    progress(1.0, "Done")
    return manifest
