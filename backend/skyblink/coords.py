"""Coordinate parsing and name resolution."""
from __future__ import annotations

import logging
import re
from urllib.parse import quote

import httpx
from astropy import units as u
from astropy.coordinates import SkyCoord

from .config import NED_URL, SESAME_URL

log = logging.getLogger(__name__)
RESOLVE_TIMEOUT_S = 20.0

# Fast nearby stars and brown dwarfs, at their ~2025.9 positions (mid SPHEREx DR1),
# so a search by name lands on where the object is now, not where it was in J2000.
# Keys are lowercase alphanumerics only.
ALIASES: dict[str, tuple[float, float]] = {
    "barnardsstar": (269.44629, 4.76792),
    "barnardstar": (269.44629, 4.76792),
    "gj699": (269.44629, 4.76792),
    "epsilonindib": (331.09592, -56.80094),
    "epsindib": (331.09592, -56.80094),
    "epsilonindi": (330.89237, -56.80423),
    "epsind": (330.89237, -56.80423),
    "wise0855": (133.75991, -7.24225),
    "wise08550714": (133.75991, -7.24225),
    "wisej085510830714425": (133.75991, -7.24225),
}

_DECIMAL = re.compile(r"^\s*([+-]?\d+(?:\.\d*)?)\s*[,\s]\s*([+-]?\d+(?:\.\d*)?)\s*$")
_SEXA_HINT = re.compile(r"[hms:d°'\"]|\d+\s+\d+\s+\d+")


def _in_range(ra: float, dec: float) -> bool:
    return 0.0 <= ra < 360.0 and -90.0 <= dec <= 90.0


def parse_coords(text: str) -> tuple[float, float] | None:
    """Parse decimal degrees or sexagesimal (RA in hours). None if not coordinates."""
    text = (text or "").strip()
    if not text:
        return None
    m = _DECIMAL.match(text)
    if m:
        ra, dec = float(m.group(1)), float(m.group(2))
        return (ra, dec) if _in_range(ra, dec) else None
    if not _SEXA_HINT.search(text) or re.search(r"[a-ce-gi-lnoq-rt-z]", text.lower()):
        return None
    try:
        parts = text.replace(",", " ").split()
        if len(parts) == 6:  # "08 55 10.8 -07 14 42"
            text = f"{':'.join(parts[:3])} {':'.join(parts[3:])}"
        c = SkyCoord(text.replace(",", " "), unit=(u.hourangle, u.deg))
    except (ValueError, TypeError):
        return None
    ra, dec = float(c.ra.deg), float(c.dec.deg)
    return (ra, dec) if _in_range(ra, dec) else None


def _ned(name: str) -> tuple[float, float] | None:
    r = httpx.get(NED_URL, params={"name": name}, timeout=RESOLVE_TIMEOUT_S)
    r.raise_for_status()
    body = r.json()
    pos = (body.get("Preferred") or {}).get("Position")
    if body.get("ResultCode") == 3 and pos:
        return float(pos["RA"]), float(pos["Dec"])
    return None


def _sesame(name: str) -> tuple[float, float] | None:
    r = httpx.get(f"{SESAME_URL}?{quote(name)}", timeout=RESOLVE_TIMEOUT_S, follow_redirects=True)
    r.raise_for_status()
    for line in r.text.splitlines():
        if line.startswith("%J "):
            ra_s, dec_s = line[3:].split()[:2]
            return float(ra_s), float(dec_s)
    return None


def resolve_name(name: str) -> tuple[float, float] | None:
    """Resolve a name: built-in aliases, then NED (IPAC), then CDS Sesame. None if unknown.

    Raises httpx.HTTPError only if every online resolver failed to respond.
    """
    name = name.strip()
    alias = ALIASES.get(re.sub(r"[^a-z0-9]", "", name.lower()))
    if alias:
        return alias
    errors = 0
    for resolver in (_ned, _sesame):
        try:
            found = resolver(name)
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("%s lookup failed for %r: %s", resolver.__name__, name, exc)
            errors += 1
            continue
        if found:
            return found
    if errors == 2:
        raise httpx.HTTPError("all name resolvers failed")
    return None
