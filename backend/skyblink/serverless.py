"""Stateless API for serverless hosting (Vercel).

Featured views are static files (see scripts/export_static.py and vercel.json rewrites).
A new position is built synchronously in one request and returned inline (PNG data URIs +
base64 float cube), because serverless functions have no background jobs or shared disk.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .api_common import BuildRequest, router, snap
from .builder import build_view
from .config import BUILDS_PER_IP_PER_HOUR, REQUESTS_PER_IP_PER_MINUTE
from .imaging import view_key
from .ratelimit import RateLimiter, client_ip

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skyblink.serverless")

LIVE_FOVS = (0.05, 0.1)  # keeps one inline response well under the 4.5 MB body limit
LIVE_MAX_VISITS = int(os.environ.get("SKYBLINK_LIVE_MAX_VISITS", "40"))
LIVE_BUDGET_S = float(os.environ.get("SKYBLINK_LIVE_BUDGET_S", "240"))
STATIC_KEYS_PATH = Path(__file__).with_name("static_keys.json")


def _static_keys() -> frozenset[str]:
    try:
        return frozenset(json.loads(STATIC_KEYS_PATH.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        log.warning("no static_keys.json; every request will build live")
        return frozenset()


STATIC_KEYS = _static_keys()
app = FastAPI(title="SkyBlink (serverless)", docs_url=None, redoc_url=None)
app.include_router(router)
build_limiter = RateLimiter(BUILDS_PER_IP_PER_HOUR, 3600.0)
request_limiter = RateLimiter(REQUESTS_PER_IP_PER_MINUTE, 60.0)


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if not request_limiter.allow(client_ip(request)):
        return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429)
    return await call_next(request)


@app.get("/api/config")
def config() -> dict:
    return {"live_fovs": list(LIVE_FOVS), "mode": "vercel"}


@app.post("/api/build")
def build(req: BuildRequest, request: Request) -> dict:
    exact = view_key(req.ra, req.dec, req.fov, req.det)
    if exact in STATIC_KEYS:
        return {"key": exact, "status": "done"}
    if not any(abs(req.fov - f) < 1e-9 for f in LIVE_FOVS):
        raise HTTPException(400, "New positions can use a 0.05° or 0.1° field. Larger fields are for featured targets.")
    if not build_limiter.allow(client_ip(request)):
        raise HTTPException(429, "You've started a lot of new builds. Please wait a few minutes, or try a featured target.")
    ra, dec = snap(req.ra, req.dec)
    try:
        view = build_view(ra, dec, req.fov, req.det, lambda p, m: None,
                          budget_s=LIVE_BUDGET_S, inline=True, max_visits=LIVE_MAX_VISITS)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except Exception:
        log.exception("live build failed at %.5f %.5f %s", ra, dec, req.det)
        raise HTTPException(503, "Build failed: NASA's archive may be busy. Try again in a minute.")
    return {"key": view["key"], "status": "done", "view": view}
