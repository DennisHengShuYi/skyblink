"""The build script's popular-sights list must match frontend/js/sights.js (no network)."""
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _js_sights():
    text = (ROOT / "frontend" / "js" / "sights.js").read_text(encoding="utf-8")
    rows = re.findall(r"slug: '([^']+)'.*?ra: ([-\d.]+), dec: ([-\d.]+), fov: ([\d.]+), det: '(D\d)'", text)
    return {slug: (float(ra), float(dec), float(fov), det) for slug, ra, dec, fov, det in rows}


def _py_sights():
    spec = importlib.util.spec_from_file_location("build_featured", ROOT / "scripts" / "build_featured.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {s["slug"]: (s["ra"], s["dec"], s["fov"], s["det"]) for s in mod.SIGHTS}


def test_build_script_sights_match_frontend():
    js = _js_sights()
    assert len(js) == 10
    assert _py_sights() == js
