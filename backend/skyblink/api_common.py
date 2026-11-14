"""Pieces shared by the long-running server (main.py) and the serverless app (serverless.py)."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from .config import DETECTORS, FOV_CHOICES, POSITION_SNAP_DEG
from .coords import parse_coords, resolve_name

router = APIRouter()


class BuildRequest(BaseModel):
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    fov: float = 0.1
    det: str = "D6"

    @field_validator("fov")
    @classmethod
    def _fov(cls, v: float) -> float:
        if not any(abs(v - c) < 1e-9 for c in FOV_CHOICES):
            raise ValueError(f"fov must be one of {FOV_CHOICES}")
        return v

    @field_validator("det")
    @classmethod
    def _det(cls, v: str) -> str:
        if v not in DETECTORS:
            raise ValueError("det must be D1..D6")
        return v


def snap(ra: float, dec: float) -> tuple[float, float]:
    """Snap to a sub-pixel grid so near-identical requests share one build."""
    return (round(ra / POSITION_SNAP_DEG) * POSITION_SNAP_DEG % 360.0,
            round(dec / POSITION_SNAP_DEG) * POSITION_SNAP_DEG)


@router.get("/api/resolve")
def resolve(q: str = Query(min_length=1, max_length=120)) -> dict:
    parsed = parse_coords(q)
    if parsed:
        return {"ra": parsed[0], "dec": parsed[1], "name": q.strip(), "source": "parsed"}
    try:
        found = resolve_name(q)
    except httpx.HTTPError:
        raise HTTPException(503, "The name lookup services are not responding. Try RA and Dec instead.")
    if not found:
        raise HTTPException(404, f"Could not find '{q.strip()}'. Try another name or enter RA and Dec.")
    return {"ra": found[0], "dec": found[1], "name": q.strip(), "source": "name-service"}
