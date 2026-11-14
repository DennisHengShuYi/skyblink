"""Find SPHEREx images covering a sky position (IRSA SIA2)."""
from __future__ import annotations

import csv
import io
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

import httpx
from astropy.time import Time

from .config import COLLECTIONS, HTTP_TIMEOUT_S, SIA_URL

log = logging.getLogger(__name__)
SIA_RETRIES = 3


@dataclass(frozen=True)
class Visit:
    obs_id: str
    det: str  # "D1".."D6"
    mjd: float
    url: str
    collection: str
    window: int = -1


def _parse_sia_csv(text: str) -> list[Visit]:
    out: list[Visit] = []
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("dataproduct_subtype", "science") != "science" or row.get("dataproduct_type") != "image":
            continue
        band = row.get("energy_bandpassname", "")
        if not band.startswith("SPHEREx-D"):
            continue
        try:
            mjd = 0.5 * (float(row["t_min"]) + float(row["t_max"]))
        except (KeyError, ValueError):
            continue
        out.append(
            Visit(
                obs_id=row["obs_id"],
                det=band.replace("SPHEREx-", ""),
                mjd=mjd,
                url=row["access_url"],
                collection=row["obs_collection"],
            )
        )
    return out


def _query_collection(collection: str, ra: float, dec: float) -> list[Visit]:
    params = {
        "COLLECTION": collection,
        "POS": f"circle {ra:.6f} {dec:.6f} 0.001",
        "RESPONSEFORMAT": "CSV",
    }
    last: Exception | None = None
    for attempt in range(SIA_RETRIES + 1):
        try:
            r = httpx.get(SIA_URL, params=params, timeout=HTTP_TIMEOUT_S * 2)
            r.raise_for_status()
            return _parse_sia_csv(r.text)
        except httpx.HTTPError as exc:  # IRSA intermittently returns 502/503 under load
            last = exc
            time.sleep(2.0 * (2 ** attempt))
    raise last  # type: ignore[misc]


def dedupe_visits(visits: list[Visit], priority: list[str]) -> list[Visit]:
    """One visit per (obs_id, detector); earlier collections in `priority` win."""
    rank = {c: i for i, c in enumerate(priority)}
    best: dict[tuple[str, str], Visit] = {}
    for v in visits:
        key = (v.obs_id, v.det)
        cur = best.get(key)
        if cur is None or rank.get(v.collection, 99) < rank.get(cur.collection, 99):
            best[key] = v
    return list(best.values())


def group_windows(visits: list[Visit], gap_days: float) -> tuple[list[dict], list[Visit]]:
    """Sort by time and split into survey windows wherever the gap exceeds gap_days."""
    ordered = sorted(visits, key=lambda v: v.mjd)
    windows: list[dict] = []
    tagged: list[Visit] = []
    for v in ordered:
        if not windows or v.mjd - windows[-1]["mjd_end"] > gap_days:
            windows.append({"id": len(windows), "mjd_start": v.mjd, "mjd_end": v.mjd, "n": 0})
        w = windows[-1]
        windows[-1] = {**w, "mjd_end": v.mjd, "n": w["n"] + 1}
        tagged.append(replace(v, window=w["id"]))
    labelled = [{**w, "label": Time(w["mjd_start"], format="mjd").to_datetime().strftime("%Y-%m")} for w in windows]
    return labelled, tagged


def find_visits(ra: float, dec: float, det: str | None = None) -> list[Visit]:
    """All science images covering (ra, dec) across configured collections, deduped."""
    with ThreadPoolExecutor(max_workers=len(COLLECTIONS)) as pool:
        futures = {c: pool.submit(_query_collection, c, ra, dec) for c in COLLECTIONS}
    found: list[Visit] = []
    errors: list[str] = []
    for c, f in futures.items():
        try:
            found.extend(f.result())
        except httpx.HTTPError as exc:
            log.warning("SIA query failed for %s at %.5f %.5f: %s", c, ra, dec, exc)
            errors.append(c)
    if errors and not found:
        raise RuntimeError(f"IRSA archive did not respond for {', '.join(errors)}")
    visits = dedupe_visits(found, COLLECTIONS)
    if det:
        visits = [v for v in visits if v.det == det]
    return sorted(visits, key=lambda v: v.mjd)
