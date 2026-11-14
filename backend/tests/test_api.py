"""API tests against a tiny synthetic view written to a temp cache (no network)."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from skyblink import storage
from skyblink.imaging import gray_png, asinh_stretch_params

KEY = "abcdef012345-D6"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CACHE_DIR", tmp_path / "cache")
    monkeypatch.setattr(storage, "FEATURED_DIR", tmp_path / "featured")
    d = storage.view_dir(KEY, tmp_path / "cache")
    n = 5
    img = np.zeros((2, n, n), dtype=np.float32)
    img[1, 2, 3] = 5.0
    np.savez_compressed(
        d / "arrays.npz", img=img, var=np.ones_like(img), um=np.full_like(img, 4.7),
        mjd=np.array([60800.0, 61000.0]), window=np.array([0, 1]),
        stack_img=img, deep_img=img.mean(axis=0),
    )
    p = asinh_stretch_params([img])
    (d / "stack_0.png").write_bytes(gray_png(img[0], p))
    manifest = {"key": KEY, "ra": 1.0, "dec": 2.0, "fov": 0.05, "det": "D6", "grid": {"npix": n}}
    (d / "manifest.json").write_text(json.dumps(manifest))
    from skyblink import main
    from skyblink.jobs import JobRegistry
    from skyblink.ratelimit import RateLimiter
    monkeypatch.setattr(main, "jobs", JobRegistry())
    monkeypatch.setattr(main, "build_limiter", RateLimiter(100, 3600))
    monkeypatch.setattr(main, "request_limiter", RateLimiter(10_000, 60))
    return TestClient(main.app)


def test_resolve_parses_coordinates_without_network(client):
    r = client.get("/api/resolve", params={"q": "08h55m10.831s -7d14m42.53s"})
    assert r.status_code == 200
    assert r.json()["ra"] == pytest.approx(133.795129, abs=1e-5)


def test_resolve_uses_alias_for_fast_movers(client):
    r = client.get("/api/resolve", params={"q": "Barnard's Star"})
    assert r.status_code == 200
    assert r.json()["dec"] == pytest.approx(4.76792)


def test_view_and_png_served(client):
    assert client.get(f"/api/view/{KEY}").json()["det"] == "D6"
    r = client.get(f"/api/png/{KEY}/stack_0.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


@pytest.mark.parametrize("name", ["../manifest.json", "arrays.npz", "stack_0.png/../../x"])
def test_png_rejects_other_files(client, name):
    assert client.get(f"/api/png/{KEY}/{name}").status_code == 404


def test_bad_key_rejected(client):
    assert client.get("/api/view/..%2F..%2Fetc").status_code == 404
    assert client.get("/api/build/notakey").status_code == 404


def test_build_validates_input(client):
    assert client.post("/api/build", json={"ra": 400, "dec": 0}).status_code == 422
    assert client.post("/api/build", json={"ra": 10, "dec": 0, "fov": 7}).status_code == 422
    assert client.post("/api/build", json={"ra": 10, "dec": 0, "det": "D9"}).status_code == 422


def test_existing_view_reports_done_without_rebuilding(client, monkeypatch):
    from skyblink import main
    monkeypatch.setattr(main.jobs, "submit", lambda *a: pytest.fail("should not submit"))
    assert client.get(f"/api/build/{KEY}").json()["status"] == "done"


def test_diff_returns_png_and_rejects_bad_refs(client):
    assert client.get(f"/api/diff/{KEY}", params={"a": "s0", "b": "s1"}).headers["content-type"] == "image/png"
    assert client.get(f"/api/diff/{KEY}", params={"a": "s9", "b": "s1"}).status_code == 400
    assert client.get(f"/api/diff/{KEY}", params={"a": "x0", "b": "s1"}).status_code == 400


def test_spectrum_flips_rows_to_png_orientation(client):
    # FITS row 2 in a 5-row frame is PNG row 2; FITS (row 2, col 3) has the 5.0 in visit 1.
    r = client.get(f"/api/spectrum/{KEY}", params={"x": 3, "y": 2}).json()
    assert [p["flux"] for p in r["points"]] == [0.0, 5.0]
    assert client.get(f"/api/spectrum/{KEY}", params={"x": 9, "y": 0}).status_code == 400


def test_png_rejects_trailing_newline(client):
    assert client.get(f"/api/png/{KEY}/stack_0.png%0A").status_code == 404


def test_build_snaps_position_and_queues_once(client, monkeypatch):
    from skyblink import main
    calls = []
    monkeypatch.setattr(main.jobs, "_run", lambda *a: calls.append(a))
    r1 = client.post("/api/build", json={"ra": 10.00012, "dec": 20.00049, "fov": 0.1, "det": "D2"}).json()
    r2 = client.post("/api/build", json={"ra": 10.00031, "dec": 19.99971, "fov": 0.1, "det": "D2"}).json()
    assert r1["key"] == r2["key"]
    assert r1["status"] == "queued"


def test_build_queue_full_returns_429(client, monkeypatch):
    from skyblink import jobs as jobs_mod, main
    monkeypatch.setattr(main.jobs, "_run", lambda *a: None)
    monkeypatch.setattr(jobs_mod, "MAX_PENDING_BUILDS", 2)
    codes = [client.post("/api/build", json={"ra": 10 + i, "dec": 0, "fov": 0.1, "det": "D2"}).status_code
             for i in range(3)]
    assert codes == [200, 200, 429]


def test_per_ip_build_limit(client, monkeypatch):
    from skyblink import main
    from skyblink.ratelimit import RateLimiter
    monkeypatch.setattr(main.jobs, "_run", lambda *a: None)
    monkeypatch.setattr(main, "build_limiter", RateLimiter(1, 3600))
    assert client.post("/api/build", json={"ra": 50, "dec": 0}).status_code == 200
    assert client.post("/api/build", json={"ra": 51, "dec": 0}).status_code == 429
    # a forged first X-Forwarded-For hop does not reset the limit
    h = {"x-forwarded-for": "1.2.3.4, testclient"}
    assert client.post("/api/build", json={"ra": 52, "dec": 0}, headers=h).status_code == 429


def test_view_lists_sibling_detectors(client, tmp_path):
    import shutil
    from skyblink import storage
    src = storage.find_view(KEY)
    other = storage.view_dir("abcdef012345-D2", tmp_path / "cache")
    for f in src.iterdir():
        shutil.copy2(f, other / f.name)
    assert client.get(f"/api/view/{KEY}").json()["siblings"] == {"D2": "abcdef012345-D2"}
