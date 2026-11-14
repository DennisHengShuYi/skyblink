"""Gaia DR3 stars in a field (via VizieR TAP), with proper motions for overlays."""
from __future__ import annotations

import csv
import io
import logging

import httpx

from .config import GAIA_TAP_URL, HTTP_TIMEOUT_S

log = logging.getLogger(__name__)

GAIA_EPOCH_MJD = 57388.5  # J2016.0
MAX_STARS = 400


def _num(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def gaia_stars(ra: float, dec: float, radius_deg: float, gmax: float = 19.0) -> list[dict]:
    """Gaia DR3 sources within radius. Empty list (logged) if VizieR is unavailable."""
    adql = (
        "SELECT TOP {n} source_id, ra, dec, pmra, pmdec, phot_g_mean_mag FROM gaiadr3.gaia_source "
        "WHERE 1=CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.6f}, {dec:.6f}, {r:.5f})) "
        "AND phot_g_mean_mag < {g} ORDER BY phot_g_mean_mag"
    ).format(n=MAX_STARS, ra=ra, dec=dec, r=radius_deg, g=gmax)
    try:
        r = httpx.post(
            GAIA_TAP_URL,
            data={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql},
            timeout=HTTP_TIMEOUT_S,
        )
        r.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Gaia query failed at %.5f %.5f: %s", ra, dec, exc)
        return []
    stars = []
    for row in csv.DictReader(io.StringIO(r.text)):
        s_ra, s_dec = _num(row.get("ra")), _num(row.get("dec"))
        if s_ra is None or s_dec is None:
            continue
        stars.append(
            {
                "source_id": row.get("source_id", ""),
                "ra": s_ra,
                "dec": s_dec,
                "pmra": _num(row.get("pmra")) or 0.0,
                "pmdec": _num(row.get("pmdec")) or 0.0,
                "gmag": _num(row.get("phot_g_mean_mag")),
                "epoch_mjd": GAIA_EPOCH_MJD,
            }
        )
    return stars
