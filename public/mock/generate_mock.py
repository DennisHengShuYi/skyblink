"""Generate a tiny synthetic SkyBlink view for frontend testing (?mock=1).

Writes mock/view.json, mock/featured.json and mock/png/*.png. The images are
fake but geometrically consistent with the API contract: north up, east left,
row 0 = north, TAN projection at scale_arcsec per pixel centred on ra/dec, so the
Gaia overlay in the frontend should land exactly on the synthetic stars, and the
high proper-motion star should track its predicted marker frame by frame.

Run from the frontend directory:  python mock/generate_mock.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent
PNG = OUT / "png"
NPIX = 59
SCALE = 6.15  # arcsec / px
RA0, DEC0 = 133.79513, -7.24515
J2016_MJD = 57388.5
LO, HI = 0.01, 2.3
RNG = np.random.default_rng(42)

WINDOWS = [("2025-05", 60800.7), ("2025-11", 60985.2), ("2026-05", 61166.4), ("2026-10", 61330.9)]
VISITS_PER_WINDOW = 4


def tan_project(ra: float, dec: float) -> tuple[float, float]:
    """Return (col, row) pixel of ra/dec on the grid (centre pixel = (NPIX-1)/2)."""
    a, d, a0, d0 = map(math.radians, (ra, dec, RA0, DEC0))
    cosc = math.sin(d0) * math.sin(d) + math.cos(d0) * math.cos(d) * math.cos(a - a0)
    xi = math.cos(d) * math.sin(a - a0) / cosc
    eta = (math.cos(d0) * math.sin(d) - math.sin(d0) * math.cos(d) * math.cos(a - a0)) / cosc
    c = (NPIX - 1) / 2
    return c - math.degrees(xi) * 3600 / SCALE, c - math.degrees(eta) * 3600 / SCALE


def tan_deproject(col: float, row: float) -> tuple[float, float]:
    c = (NPIX - 1) / 2
    xi = math.radians((c - col) * SCALE / 3600)
    eta = math.radians((c - row) * SCALE / 3600)
    a0, d0 = math.radians(RA0), math.radians(DEC0)
    rho = math.hypot(xi, eta)
    cc = math.atan(rho)
    if rho == 0:
        return RA0, DEC0
    dec = math.asin(math.cos(cc) * math.sin(d0) + eta * math.sin(cc) * math.cos(d0) / rho)
    ra = a0 + math.atan2(xi * math.sin(cc), rho * math.cos(d0) * math.cos(cc) - eta * math.sin(d0) * math.sin(cc))
    return math.degrees(ra) % 360, math.degrees(dec)


def propagate(star: dict, mjd: float) -> tuple[float, float]:
    dt = (mjd - J2016_MJD) / 365.25
    dec = star["dec"] + star["pmdec"] * dt / 3.6e6
    ra = star["ra"] + star["pmra"] * dt / 3.6e6 / math.cos(math.radians(star["dec"]))
    return ra, dec


def gaussian(img: np.ndarray, col: float, row: float, amp: float, sigma: float = 1.1) -> None:
    yy, xx = np.mgrid[0:NPIX, 0:NPIX]
    img += amp * np.exp(-((xx - col) ** 2 + (yy - row) ** 2) / (2 * sigma**2))


def stretch(img: np.ndarray) -> Image.Image:
    v = (np.arcsinh(np.clip(img, LO, None) / LO) - np.arcsinh(1)) / (np.arcsinh(HI / LO) - np.arcsinh(1))
    return Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8), "L")


def make_stars() -> list[dict]:
    stars = []
    for k in range(9):
        col, row = RNG.uniform(5, NPIX - 5, 2)
        ra, dec = tan_deproject(col, row)
        stars.append({"source_id": f"57655{k:014d}", "ra": round(ra, 7), "dec": round(dec, 7),
                      "pmra": round(float(RNG.normal(0, 15)), 2), "pmdec": round(float(RNG.normal(0, 15)), 2),
                      "gmag": round(float(RNG.uniform(11, 18)), 2)})
    # High proper-motion star: lands near the crosshair in mid-2025, far from it at J2016.
    mid = 60900.0
    pmra, pmdec = -8100.0, 700.0
    dt = (mid - J2016_MJD) / 365.25
    ra16 = RA0 - pmra * dt / 3.6e6 / math.cos(math.radians(DEC0))
    dec16 = DEC0 - pmdec * dt / 3.6e6
    stars.append({"source_id": "MOCK-HPM", "ra": round(ra16, 7), "dec": round(dec16, 7),
                  "pmra": pmra, "pmdec": pmdec, "gmag": 15.0})
    return stars


def render(stars: list[dict], mjd: float, phase: float) -> np.ndarray:
    img = RNG.normal(0.03, 0.012, (NPIX, NPIX))
    for s in stars:
        col, row = tan_project(*propagate(s, mjd))
        amp = 2.0 if s["source_id"] == "MOCK-HPM" else 0.3 + (18 - s["gmag"]) * 0.12
        gaussian(img, col, row, amp)
    # A variable source (no Gaia entry), brightness swings with phase.
    gaussian(img, 12, 44, 0.15 + 0.9 * (0.5 + 0.5 * math.sin(phase)))
    return img


def flags_png(i: int) -> Image.Image:
    rgba = np.zeros((NPIX, NPIX, 4), np.uint8)
    mask = RNG.random((NPIX, NPIX)) < 0.03
    rgba[mask] = (255, 140, 0, 200)
    rgba[27:32, 27:32] = (255, 40, 200, 170)  # pretend SOURCE flag near centre
    Image.fromarray(rgba, "RGBA").save(PNG / f"flags_{i}.png")
    return Image.fromarray(rgba)


def main() -> None:
    PNG.mkdir(parents=True, exist_ok=True)
    stars = make_stars()
    visits, stacks, windows, stack_imgs = [], [], [], []
    img_planes, var_planes, um_planes = [], [], []
    cols = np.arange(NPIX)[None, :].repeat(NPIX, 0)
    i = 0
    for w, (label, mjd0) in enumerate(WINDOWS):
        imgs = []
        for k in range(VISITS_PER_WINDOW):
            mjd = mjd0 + k * 0.11
            img = render(stars, mjd, w * 1.7)
            imgs.append(img)
            stretch(img).save(PNG / f"visit_{i}.png")
            flags_png(i)
            um_visit = 4.6 + 0.05 * k
            masked = RNG.random((NPIX, NPIX)) < 0.01  # NaN = masked pixel
            img_planes.append(np.where(masked, np.nan, img))
            var_planes.append(np.where(masked, np.nan, 0.012**2 + 0.002 * np.clip(img, 0, None)))
            um_planes.append(um_visit + 0.0015 * (cols - (NPIX - 1) / 2))
            iso = f"{label}-{5 + k:02d}T{(16 + k) % 24:02d}:49:00"
            visits.append({"i": i, "obs_id": f"2025W{19 + w * 26}_1B_{116 + k:04d}_1", "window": w,
                           "mjd": round(mjd, 4), "date": iso, "um": round(4.6 + 0.05 * k, 3), "um_bw": 0.037,
                           "png": f"mock/png/visit_{i}.png", "flags_png": f"mock/png/flags_{i}.png",
                           "file": f"https://irsa.ipac.caltech.edu/mock/level2_{i}.fits",
                           "collection": "spherex_qr2" if w < 2 else "spherex_qr3",
                           "flag_frac": 0.03, "flag_counts": {"SOURCE": 25, "NONLINEAR": int(k == 0), "TRANSIENT": 3}})
            i += 1
        stack = np.mean(imgs, axis=0)
        stack_imgs.append(stack)
        stretch(stack).save(PNG / f"stack_{w}.png")
        windows.append({"id": w, "label": label, "mjd_start": mjd0, "mjd_end": round(mjd0 + 0.4, 2), "n": len(imgs)})
        stacks.append({"window": w, "png": f"mock/png/stack_{w}.png", "mjd": round(mjd0 + 0.17, 3),
                       "date": f"{label}-06", "n": len(imgs), "um_mean": 4.68})
    deep = np.mean(stack_imgs, axis=0)
    stretch(deep).save(PNG / "deep.png")
    # Float16 data cube: img[N], var[N], um[N], stack[W], deep[1]; little-endian, row 0 = north.
    planes = img_planes + var_planes + um_planes + stack_imgs + [deep]
    np.stack(planes).astype("<f2").tofile(OUT / "cube.bin")
    cube = {"url": "mock/cube.bin", "b64": None, "dtype": "float16", "npix": NPIX,
            "n_visits": len(visits), "n_stacks": len(stacks),
            "layout": ["img", "var", "um", "stack", "deep"], "row0": "north"}

    view = {"key": "mock0000", "ra": RA0, "dec": DEC0, "fov": 0.1, "det": "D6",
            "grid": {"npix": NPIX, "scale_arcsec": SCALE, "ctype": "TAN", "north_up": True, "east_left": True},
            "band": {"det": "D6", "um_min": 4.42, "um_max": 5.0},
            "stretch": {"kind": "asinh", "lo": LO, "hi": HI, "unit": "MJy/sr"},
            "windows": windows, "stacks": stacks, "deep": {"png": "mock/png/deep.png", "n": len(visits)},
            "visits": visits, "stars": stars, "cube": cube,
            "notes": ["Mock data: the bright star near the crosshair has a huge proper motion; the faint source at lower left varies in brightness."]}
    (OUT / "view.json").write_text(json.dumps(view, indent=1), encoding="utf-8")

    featured = [
        {"slug": "barnard", "name": "Barnard's Star", "ra": 269.452076, "dec": 4.693364, "fov": 0.1, "det": "D3",
         "caption": "Fastest-moving star in our sky. It saturates: watch the bright core shift between windows.", "kind": "motion"},
        {"slug": "epsindib", "name": "Epsilon Indi B", "ra": 330.840226, "dec": -56.79713, "fov": 0.1, "det": "D6",
         "caption": "A brown-dwarf pair moving with its bright star, Epsilon Indi A.", "kind": "motion"},
        {"slug": "wise0855", "name": "WISE 0855−0714", "ra": RA0, "dec": DEC0, "fov": 0.1, "det": "D6",
         "caption": "The coldest known brown dwarf. Moves about 1.3 px a year: watch the D6 stack.", "kind": "motion"},
        {"slug": "rwaur", "name": "RW Aurigae", "ra": 76.956319, "dec": 30.401194, "fov": 0.1, "det": "D2",
         "caption": "A young star that dims and brightens. Look for brightness change, not motion.", "kind": "variable"},
        {"slug": "rdra", "name": "R Draconis", "ra": 246.522817, "dec": 66.75266, "fov": 0.1, "det": "D3",
         "caption": "A pulsating red giant with a ~245-day cycle. Watch it brighten and fade.", "kind": "variable"},
    ]
    (OUT / "featured.json").write_text(json.dumps(featured, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
