"""Serverless (Vercel) API: inline builds, static-key short-circuit, live FOV limits."""
import pytest
from fastapi.testclient import TestClient

from skyblink import serverless
from skyblink.imaging import view_key
from skyblink.ratelimit import RateLimiter


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(serverless, "build_limiter", RateLimiter(100, 3600))
    monkeypatch.setattr(serverless, "request_limiter", RateLimiter(10_000, 60))
    return TestClient(serverless.app)


def test_config_reports_live_fovs(client):
    assert client.get("/api/config").json() == {"live_fovs": [0.05, 0.1], "mode": "vercel"}


def test_static_key_returns_done_without_building(client, monkeypatch):
    key = view_key(133.75991, -7.24225, 0.1, "D6")
    monkeypatch.setattr(serverless, "STATIC_KEYS", frozenset({key}))
    monkeypatch.setattr(serverless, "build_view", lambda *a, **k: pytest.fail("should not build"))
    r = client.post("/api/build", json={"ra": 133.75991, "dec": -7.24225, "fov": 0.1, "det": "D6"})
    assert r.json() == {"key": key, "status": "done"}


def test_live_build_is_inline_and_snapped(client, monkeypatch):
    seen = {}

    def fake_build(ra, dec, fov, det, progress, **kw):
        seen.update(ra=ra, dec=dec, **kw)
        return {"key": view_key(ra, dec, fov, det), "visits": []}

    monkeypatch.setattr(serverless, "build_view", fake_build)
    r = client.post("/api/build", json={"ra": 10.00042, "dec": 5.0, "fov": 0.1, "det": "D2"}).json()
    assert r["status"] == "done" and "view" in r
    assert seen["inline"] is True and seen["ra"] == pytest.approx(10.0)


def test_large_fov_rejected_for_live_builds(client):
    assert client.post("/api/build", json={"ra": 10, "dec": 5, "fov": 0.3, "det": "D2"}).status_code == 400


def test_missing_data_is_404(client, monkeypatch):
    def nothing(*a, **k):
        raise LookupError("SPHEREx has no images of this position in this detector yet.")
    monkeypatch.setattr(serverless, "build_view", nothing)
    assert client.post("/api/build", json={"ra": 10, "dec": 5, "fov": 0.1, "det": "D2"}).status_code == 404
