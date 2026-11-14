"""Central configuration. New SPHEREx data releases are added here only."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Search order is also dedupe priority: a pointing found in an earlier
# collection wins over the same pointing in a later one. Add new releases
# (e.g. "spherex_dr2") to the front of this list when IRSA publishes them.
COLLECTIONS: list[str] = [
    c.strip()
    for c in os.environ.get("SKYBLINK_COLLECTIONS", "spherex_dr1,spherex_qr3").split(",")
    if c.strip()
]

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
NED_URL = "https://ned.ipac.caltech.edu/srs/ObjectLookup"
SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oI/A"
GAIA_TAP_URL = "https://gea.esac.esa.int/tap-server/tap/sync"  # ESA archive; CDS TAP was unreachable in tests

ON_VERCEL = bool(os.environ.get("VERCEL"))
# Serverless filesystems are read-only except /tmp (~500 MB).
CACHE_DIR = Path(os.environ.get("SKYBLINK_CACHE", "/tmp/skyblink-cache" if ON_VERCEL else ROOT / "cache"))
FEATURED_DIR = ROOT / "featured"
FRONTEND_DIR = ROOT / "frontend"

PIXEL_SCALE_ARCSEC = 6.15
FOV_CHOICES = (0.05, 0.1, 0.2, 0.3, 0.5)
DETECTORS = ("D1", "D2", "D3", "D4", "D5", "D6")
BAND_UM = {
    "D1": (0.75, 1.09),
    "D2": (1.10, 1.62),
    "D3": (1.63, 2.41),
    "D4": (2.42, 3.82),
    "D5": (3.83, 4.41),
    "D6": (4.42, 5.00),
}

WINDOW_GAP_DAYS = 30.0
MAX_VISITS_PER_BUILD = int(os.environ.get("SKYBLINK_MAX_VISITS", "80"))
FETCH_CONCURRENCY = int(os.environ.get("SKYBLINK_CONCURRENCY", "10"))
HTTP_TIMEOUT_S = 120.0
MAX_CONCURRENT_BUILDS = 2
MAX_PENDING_BUILDS = 6
BUILD_BUDGET_S = 8 * 60  # a live build gives up after this, so a slow archive cannot stall the queue
BUILDS_PER_IP_PER_HOUR = 12
REQUESTS_PER_IP_PER_MINUTE = 240
RAW_CACHE_MAX_BYTES = int(os.environ.get("SKYBLINK_RAW_CACHE_MB", "250" if ON_VERCEL else "4000")) * 1024 * 1024
POSITION_SNAP_DEG = 0.001  # 3.6", under one SPHEREx pixel: near-identical requests share one build

# SPHEREx FLAGS bits (Explanatory Supplement, Table 10). Bits we do not name
# are still drawn in the overlay as "OTHER".
FLAG_BITS: dict[int, str] = {
    0: "TRANSIENT",
    1: "OVERFLOW",
    2: "SUR_ERROR",
    6: "NONFUNC",
    7: "DICHROIC",
    9: "MISSING_DATA",
    10: "HOT",
    11: "COLD",
    12: "FULLSAMPLE",
    14: "PHANMISS",
    15: "NONLINEAR",
    17: "PERSIST",
    19: "OUTLIER",
    21: "SOURCE",
}
# Pixels with these bits are unusable and blanked. SOURCE / FULLSAMPLE mark the
# stars themselves, and NONLINEAR marks saturated cores (Barnard's Star), so
# those stay visible; they are only down-weighted in stacks via VARIANCE.
BAD_BITS: tuple[int, ...] = (0, 1, 2, 6, 7, 9, 10, 11, 17, 19)
BAD_MASK: int = sum(1 << b for b in BAD_BITS)
