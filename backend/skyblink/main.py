"""FastAPI app: JSON API + static frontend."""
from __future__ import annotations

import json
import logging
import mimetypes
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import storage
from .config import (
    BUILDS_PER_IP_PER_HOUR,
    FEATURED_DIR,
    FOV_CHOICES,
    FRONTEND_DIR,
    REQUESTS_PER_IP_PER_MINUTE,
)
from .api_common import BuildRequest, router, snap
from .imaging import diff_png, view_key
from .jobs import JobRegistry, QueueFull
from .ratelimit import RateLimiter, client_ip

mimetypes.add_type("text/javascript", ".js")  # Windows registry often maps .js to text/plain
mimetypes.add_type("text/css", ".css")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("skyblink")

app = FastAPI(title="SkyBlink", docs_url="/api/docs")
app.include_router(router)
jobs = JobRegistry()
build_limiter = RateLimiter(BUILDS_PER_IP_PER_HOUR, 3600.0)
request_limiter = RateLimiter(REQUESTS_PER_IP_PER_MINUTE, 60.0)
IMMUTABLE = {"Cache-Control": "public, max-age=86400"}


@app.get("/api/featured")
def featured() -> list[dict]:
    path = FEATURED_DIR / "featured.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


@app.post("/api/build")
def build(req: BuildRequest, request: Request) -> dict:
    exact = view_key(req.ra, req.dec, req.fov, req.det)
    if storage.find_view(exact):  # featured targets and finished views are served as-is
        return {"key": exact, "status": "done"}
    ra, dec = snap(req.ra, req.dec)
    snapped = view_key(ra, dec, req.fov, req.det)
    existing = jobs.get(snapped)
    if not (existing and existing.status in ("done", "queued", "running")):
        if not build_limiter.allow(client_ip(request)):
            raise HTTPException(429, "You've started a lot of new builds. Please wait a few minutes, or try a featured target.")
        try:
            existing = jobs.submit(ra, dec, req.fov, req.det)
        except QueueFull:
            raise HTTPException(429, "SkyBlink is busy building other views. Please try again in a few minutes.")
    return {"key": existing.key, "status": existing.status}


@app.middleware("http")
async def _rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and not request_limiter.allow(client_ip(request)):
        return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429)
    return await call_next(request)


@app.get("/api/build/{key}")
def build_status(key: str) -> dict:
    s = jobs.get(key) if storage.valid_key(key) else None
    if not s:
        raise HTTPException(404, "Unknown build")
    return {"key": s.key, "status": s.status, "progress": s.progress, "message": s.message, "error": s.error}


@app.get("/api/view/{key}")
def view(key: str) -> dict:
    m = storage.load_manifest(key)
    if not m:
        raise HTTPException(404, "View not built yet")
    return m


@app.get("/api/png/{key}/{name}")
def png(key: str, name: str) -> FileResponse:
    d = storage.find_view(key)
    if not d or not storage.valid_file(name) or not (d / name).exists():
        raise HTTPException(404, "No such image")
    media = "application/octet-stream" if name.endswith(".bin") else "image/png"
    return FileResponse(d / name, media_type=media, headers=IMMUTABLE)


def _frame(arrays: np.lib.npyio.NpzFile, ref: str) -> np.ndarray:
    try:
        if ref == "deep":
            return arrays["deep_img"]
        idx = int(ref[1:])
        if ref[0] == "s":
            return arrays["stack_img"][idx]
        if ref[0] == "v":
            return arrays["img"][idx]
    except (ValueError, IndexError):
        pass
    raise HTTPException(400, f"Bad frame reference '{ref}'")


@app.get("/api/diff/{key}")
def diff(key: str, a: str = Query(max_length=8), b: str = Query(max_length=8)) -> Response:
    d = storage.find_view(key)
    if not d:
        raise HTTPException(404, "View not built yet")
    with np.load(d / "arrays.npz") as arrays:
        img = diff_png(_frame(arrays, a), _frame(arrays, b))
    return Response(img, media_type="image/png", headers=IMMUTABLE)


@app.get("/api/spectrum/{key}")
def spectrum(key: str, x: int = Query(ge=0, le=500), y: int = Query(ge=0, le=500)) -> dict:
    m = storage.load_manifest(key)
    if not m:
        raise HTTPException(404, "View not built yet")
    n = m["grid"]["npix"]
    if x >= n or y >= n:
        raise HTTPException(400, "Pixel outside the frame")
    row = n - 1 - y  # PNG row 0 is north; arrays are FITS order (row 0 south)
    points = []
    for d in storage.sibling_views(key):
        det = d.name
        with np.load(d / "arrays.npz") as a:
            img, var, um, mjd, win = a["img"], a["var"], a["um"], a["mjd"], a["window"]
            for i in range(img.shape[0]):
                f, v, w = float(img[i, row, x]), float(var[i, row, x]), float(um[i, row, x])
                if np.isfinite(f) and np.isfinite(w):
                    points.append({"um": round(w, 4), "flux": f, "err": float(np.sqrt(v)) if v > 0 else None,
                                   "mjd": float(mjd[i]), "det": det, "window": int(win[i])})
    return {"x": x, "y": y, "ra": m["ra"], "dec": m["dec"], "points": sorted(points, key=lambda p: p["um"])}


@app.get("/api/config")
def config() -> dict:
    return {"live_fovs": list(FOV_CHOICES), "mode": "server"}


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


if Path(FRONTEND_DIR).exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR), name="frontend")
