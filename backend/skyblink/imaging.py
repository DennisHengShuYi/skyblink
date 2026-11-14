"""Pure image math: grid, cleaning, reprojection, stacking, stretch, PNG encoding."""
from __future__ import annotations

import hashlib
import io

import numpy as np
import warnings

from astropy import log as astropy_log
from astropy.io import fits
from astropy.wcs import WCS, FITSFixedWarning
from PIL import Image

from .config import BAD_MASK, FLAG_BITS, PIXEL_SCALE_ARCSEC

warnings.simplefilter("ignore", FITSFixedWarning)
astropy_log.setLevel("WARNING")  # SPHEREx headers carry SIP without "-SIP"; astropy applies it correctly

STRETCH_HI_PCT = 99.95  # brightest pixels: keep bright-star variability unclipped
SKY_LO_SIGMA = 2.0  # black point this many sigma below the sky
MIN_RANGE_SIGMA = 50.0
SOFT_SIGMA = 2.5  # asinh bend at this many sigma: faint sources bright, sky near black
DIFF_FULL_SCALE_SIGMA = 12.0  # a 12-sigma change is full red/blue
DIFF_NOISE_FLOOR_SIGMA = 2.5  # changes under this are dimmed so noise does not dominate


def view_key(ra: float, dec: float, fov: float, det: str) -> str:
    """Stable key for one (position, fov, detector) view. Coordinates rounded to ~0.4 arcsec."""
    pos = hashlib.sha1(f"{ra:.4f}|{dec:.4f}|{fov:.3f}".encode()).hexdigest()[:12]
    return f"{pos}-{det}" if det else pos


def grid_wcs(ra: float, dec: float, fov: float) -> tuple[WCS, int]:
    """North-up, east-left TAN grid centred on the target at SPHEREx pixel scale."""
    npix = int(round(fov * 3600.0 / PIXEL_SCALE_ARCSEC))
    npix += 1 - npix % 2  # odd so the target sits on a pixel centre
    scale = PIXEL_SCALE_ARCSEC / 3600.0
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(npix + 1) / 2.0, (npix + 1) / 2.0]
    # FITS row 0 is south; we flip rows when rendering so PNG row 0 is north.
    w.wcs.cdelt = [-scale, scale]
    return w, npix


def source_pixels(src: WCS, target: WCS, npix: int) -> tuple[np.ndarray, np.ndarray]:
    """Source-image (x, y) pixel coordinates of every target grid pixel, flattened row-major."""
    yy, xx = np.mgrid[0:npix, 0:npix]
    sky = target.pixel_to_world_values(xx.ravel(), yy.ravel())
    sx, sy = src.world_to_pixel_values(*sky)
    return np.asarray(sx, dtype=np.float64), np.asarray(sy, dtype=np.float64)


def _corners(shape: tuple[int, int], sx: np.ndarray, sy: np.ndarray):
    ny, nx = shape
    inside = (sx >= -0.5) & (sx <= nx - 0.5) & (sy >= -0.5) & (sy <= ny - 0.5)
    x = np.clip(sx, 0, nx - 1)
    y = np.clip(sy, 0, ny - 1)
    x0 = np.clip(np.floor(x).astype(np.int64), 0, max(nx - 2, 0))
    y0 = np.clip(np.floor(y).astype(np.int64), 0, max(ny - 2, 0))
    x1 = np.minimum(x0 + 1, nx - 1)
    y1 = np.minimum(y0 + 1, ny - 1)
    fx, fy = x - x0, y - y0
    return inside, x0, x1, y0, y1, fx, fy


def sample_bilinear(arr: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Bilinear sample of arr at (sx, sy); NaN outside the image (half-pixel border allowed)."""
    inside, x0, x1, y0, y1, fx, fy = _corners(arr.shape, sx, sy)
    v = (arr[y0, x0] * (1 - fx) * (1 - fy) + arr[y0, x1] * fx * (1 - fy)
         + arr[y1, x0] * (1 - fx) * fy + arr[y1, x1] * fx * fy)
    return np.where(inside, v, np.nan)


def sample_nearest(arr: np.ndarray, sx: np.ndarray, sy: np.ndarray, fill=0) -> np.ndarray:
    ny, nx = arr.shape
    xi, yi = np.rint(sx).astype(np.int64), np.rint(sy).astype(np.int64)
    inside = (xi >= 0) & (xi < nx) & (yi >= 0) & (yi < ny)
    return np.where(inside, arr[np.clip(yi, 0, ny - 1), np.clip(xi, 0, nx - 1)], fill)


def masked_bilinear(arr: np.ndarray, sx: np.ndarray, sy: np.ndarray) -> np.ndarray:
    """Bilinear sample that does not let one NaN pixel blank its neighbours (normalized weights)."""
    good = np.isfinite(arr)
    num = sample_bilinear(np.where(good, arr, 0.0), sx, sy)
    den = sample_bilinear(good.astype(np.float64), sx, sy)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0.5, num / den, np.nan)


SOURCE_BIT = 21
SATURATED_VAR_FACTOR = 1e4  # filled saturated cores barely count in stacks
FILL_PASSES = 8  # grows up to 8 px (49") into a saturated core


def fill_saturated(img: np.ndarray, core: np.ndarray) -> np.ndarray:
    """Fill NaN saturated-star cores with the brightest finite neighbour (grows inward)."""
    out = img.copy()
    todo = core & ~np.isfinite(out)
    for _ in range(FILL_PASSES):
        if not todo.any():
            break
        padded = np.pad(np.where(np.isfinite(out), out, -np.inf), 1, constant_values=-np.inf)
        h, w = out.shape
        neigh = np.max([padded[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)], axis=0)
        fill = todo & np.isfinite(neigh)
        out[fill] = neigh[fill]
        todo &= ~fill
    return out


def clean_frame(img, zodi, var, flags):
    """Subtract zodiacal light, blank unusable pixels, keep stars, fill saturated cores.

    Returns (clean image, variance, filled-core mask). Pixels SPHEREx marks as part of a
    source (SOURCE bit) are never blanked: bright stars carry TRANSIENT/SUR_ERROR flags on
    their valid wings, and blanking them erased saturated stars like Barnard's Star.
    """
    source = ((flags >> SOURCE_BIT) & 1).astype(bool)
    bad = ((flags & BAD_MASK) != 0) & ~source
    clean = np.where(bad, np.nan, img - zodi)
    core = source & ~np.isfinite(clean)
    clean = fill_saturated(clean, core)
    filled = core & np.isfinite(clean)
    var = np.where(bad | ~(var > 0), np.nan, var)
    typical = np.nanmedian(var) if np.isfinite(var).any() else 1.0
    var = np.where(filled, typical * SATURATED_VAR_FACTOR, var)
    clean = clean - np.nanmedian(clean[~source]) if (~source).any() else clean  # sky level
    return clean, var, filled


def process_cutout(data: bytes, target: WCS, npix: int) -> dict:
    """Clean one SPHEREx cutout and reproject it onto the target grid (FITS orientation)."""
    with fits.open(io.BytesIO(data)) as hdul:
        img = hdul["IMAGE"].data.astype(np.float64)
        zodi = hdul["ZODI"].data.astype(np.float64) if "ZODI" in hdul else 0.0
        var = hdul["VARIANCE"].data.astype(np.float64)
        flags = hdul["FLAGS"].data.astype(np.int64)
        src_wcs = WCS(hdul["IMAGE"].header)
        header = hdul["IMAGE"].header
        mjd = float(header.get("MJD-AVG", header.get("MJD-OBS", np.nan)))
        sx, sy = source_pixels(src_wcs, target, npix)
        # Wavelength/bandwidth at each grid pixel from the WCS-WAVE lookup table (µm).
        wave_wcs = WCS(header, fobj=hdul, key="W")
        um, bw = (np.asarray(a).reshape(npix, npix) for a in wave_wcs.pixel_to_world_values(sx, sy))

    clean, var, _ = clean_frame(img, zodi, var, flags)

    shape = (npix, npix)
    img_r = masked_bilinear(clean, sx, sy).reshape(shape)
    var_r = masked_bilinear(var, sx, sy).reshape(shape)
    flags_r = sample_nearest(flags, sx, sy, fill=0).reshape(shape)
    c = npix // 2
    return {
        "img": img_r,
        "var": var_r,
        "flags": flags_r,
        "um": um,
        "bw": bw,
        "um_center": float(um[c, c]),
        "bw_center": float(bw[c, c]),
        "mjd": mjd,
        "coverage": float(np.isfinite(img_r).mean()),
    }


def encode_cube(imgs, variances, ums, stacks, deep) -> bytes:
    """Float data for client-side difference/spectra: little-endian float16 planes, row 0 = north.

    Layout: img[N], var[N], um[N], stack[W], deep[1], each npix x npix.
    """
    planes = [*imgs, *variances, *ums, *stacks, deep]
    arr = np.flip(np.stack(planes), axis=1)  # FITS row 0 is south
    with np.errstate(over="ignore"):
        return np.ascontiguousarray(arr.astype("<f2")).tobytes()


def flag_summary(flags: np.ndarray) -> tuple[float, dict[str, int]]:
    counts = {name: int(((flags >> bit) & 1).sum()) for bit, name in FLAG_BITS.items()}
    return float((flags & BAD_MASK != 0).mean()), {k: v for k, v in counts.items() if v}


def weighted_stack(imgs: list[np.ndarray], variances: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Inverse-variance weighted mean, ignoring NaNs. Returns (image, variance)."""
    im = np.stack(imgs)
    va = np.stack(variances)
    w = np.where(np.isfinite(im) & np.isfinite(va) & (va > 0), 1.0 / np.where(va > 0, va, 1.0), 0.0)
    wsum = w.sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(wsum > 0, (w * np.nan_to_num(im)).sum(axis=0) / wsum, np.nan)
        var = np.where(wsum > 0, 1.0 / wsum, np.nan)
    return mean, var


def robust_sigma(a: np.ndarray) -> float:
    v = a[np.isfinite(a)]
    if v.size == 0:
        return 0.0
    return float(1.4826 * np.median(np.abs(v - np.median(v))))


def asinh_stretch_params(arrays: list[np.ndarray], noise_arrays: list[np.ndarray] | None = None) -> dict:
    """One shared asinh stretch for a set of frames, adapted to the field's noise.

    Empty sky (median) sits SKY_LO_SIGMA below the black point's top, so it renders near black;
    the softness puts SOFT_SIGMA x noise at the bend of the curve, so faint sources show up
    mid-grey while the full range up to the brightest pixel is kept (bright variable stars
    are not clipped). `noise_arrays` (e.g. window stacks) sets the noise; defaults to `arrays`.
    """
    vals = np.concatenate([a[np.isfinite(a)].ravel() for a in arrays]) if arrays else np.array([])
    if vals.size == 0:
        vals = np.array([0.0, 1.0])
    sigmas = [robust_sigma(a) for a in (noise_arrays or arrays)]
    sigma = float(np.median([s for s in sigmas if s > 0])) if any(s > 0 for s in sigmas) else 0.0
    med = float(np.median(vals))
    top = float(np.percentile(vals, STRETCH_HI_PCT))
    if sigma <= 0:
        sigma = max((top - med) / 100.0, 1e-6)
    lo = med - SKY_LO_SIGMA * sigma
    hi = max(top, lo + MIN_RANGE_SIGMA * sigma)  # empty fields: keep sky dark, faint sources unclipped
    soft = float(np.clip(SOFT_SIGMA * sigma / (hi - lo), 1e-5, 0.5))
    return {"kind": "asinh", "lo": lo, "hi": hi, "soft": soft, "sigma": sigma, "unit": "MJy/sr"}


def to_uint8(data: np.ndarray, p: dict) -> np.ndarray:
    """Stretch to 0..255. Masked (NaN) pixels are drawn at the sky level, so they don't look like changes."""
    filled = np.where(np.isfinite(data), data, 0.0)  # backgrounds are median-subtracted to 0
    x = np.clip((filled - p["lo"]) / (p["hi"] - p["lo"]), 0.0, 1.0)
    y = np.arcsinh(x / p["soft"]) / np.arcsinh(1.0 / p["soft"])
    return np.round(y * 255.0).astype(np.uint8)


def _png(arr: np.ndarray, mode: str) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.flipud(arr), mode=mode).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def gray_png(data: np.ndarray, p: dict) -> bytes:
    return _png(to_uint8(data, p), "L")


def flags_png(flags: np.ndarray) -> bytes:
    """Transparent overlay: red = unusable, amber = saturated/nonlinear, nothing for SOURCE."""
    rgba = np.zeros(flags.shape + (4,), dtype=np.uint8)
    bad = (flags & BAD_MASK) != 0
    nonlin = ((flags >> 15) & 1).astype(bool) & ~bad
    rgba[bad] = (255, 60, 60, 150)
    rgba[nonlin] = (255, 190, 0, 150)
    return _png(rgba, "RGBA")


def diff_png(a: np.ndarray, b: np.ndarray) -> bytes:
    """b − a with a symmetric asinh stretch: red = brighter in b, blue = brighter in a."""
    d = b - a
    finite = d[np.isfinite(d)]
    sigma = 1.4826 * float(np.median(np.abs(finite - np.median(finite)))) if finite.size else 1.0
    s = DIFF_FULL_SCALE_SIGMA * sigma if sigma > 0 else 1.0
    v = np.clip(np.nan_to_num(d) / s, -1, 1)
    mag = np.arcsinh(np.abs(v) / 0.2) / np.arcsinh(5.0)
    mag = np.where(np.abs(v) * DIFF_FULL_SCALE_SIGMA < DIFF_NOISE_FLOOR_SIGMA, mag * 0.35, mag)
    rgb = np.full(d.shape + (3,), 20, dtype=np.float64)
    rgb[..., 0] += np.where(v > 0, mag * 235, 0)
    rgb[..., 1] += mag * 40
    rgb[..., 2] += np.where(v < 0, mag * 235, 0)
    rgb[~np.isfinite(d)] = (60, 60, 60)
    return _png(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
