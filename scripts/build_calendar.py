"""Write frontend/calendar.json: every featured picture's date, for Birthday Sky.

Small and static (no archive calls): for each featured view, the visits' MJD, visit
index and wavelength. Run by export_static.py so it always matches the featured data.

    python scripts/build_calendar.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FEATURED = ROOT / "featured"
OUT = ROOT / "frontend" / "calendar.json"


def build() -> dict:
    names = {f["key"].split("-")[0]: f for f in json.loads((FEATURED / "featured.json").read_text(encoding="utf-8"))}
    views = []
    for manifest in sorted(FEATURED.glob("*/D[1-6]/manifest.json")):
        pos, det = manifest.parent.parent.name, manifest.parent.name
        f = names.get(pos)
        if not f:
            continue
        m = json.loads(manifest.read_text(encoding="utf-8"))
        visits = [[round(v["mjd"], 4), v["i"], round(v["um"], 3)] for v in m["visits"] if v.get("mjd")]
        views.append({"slug": f["slug"], "name": f["name"], "ra": m["ra"], "dec": m["dec"], "fov": m["fov"],
                      "det": det, "key": f"{pos}-{det}", "visits": visits})
    return {"views": views}


def main() -> None:
    data = build()
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    n = sum(len(v["visits"]) for v in data["views"])
    print(f"calendar: {len(data['views'])} views, {n} pictures -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
