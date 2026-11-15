// Gaia DR3 overlay maths: TAN (gnomonic) projection onto the view grid and
// proper-motion propagation from the Gaia DR3 epoch (J2016.0).

export const J2016_MJD = 57388.5;
const DEG = Math.PI / 180;
const MAS_PER_DEG = 3.6e6;
const DAYS_PER_YEAR = 365.25;

/**
 * Project ra/dec (deg) to fractional pixel coords on the grid. Pixel (0,0) is the
 * centre of the top-left pixel; the view centre is pixel ((npix-1)/2, (npix-1)/2).
 * North up (row 0 = north), east left. Returns null behind the tangent plane.
 */
export function project(ra, dec, view) {
  const a = ra * DEG;
  const d = dec * DEG;
  const a0 = view.ra * DEG;
  const d0 = view.dec * DEG;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  if (cosc <= 0) return null;
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  const centre = (view.grid.npix - 1) / 2;
  const perPix = view.grid.scale_arcsec / 3600;
  return {
    x: centre - xi / DEG / perPix,
    y: centre - eta / DEG / perPix,
  };
}

/** True when the star has a measured proper motion (Gaia 2-parameter solutions have none). */
export function hasMotion(star) {
  return star != null && Number.isFinite(Number(star.pmra)) && Number.isFinite(Number(star.pmdec))
    && star.pmra !== null && star.pmdec !== null;
}

/**
 * Star position (deg) at `mjd`, propagated linearly from the star's own `epoch_mjd`
 * (J2016.0 for Gaia DR3 when absent). pmra is μα·cosδ (Gaia). Unknown motion = no shift.
 */
export function propagate(star, mjd) {
  const epoch = Number.isFinite(Number(star.epoch_mjd)) && star.epoch_mjd !== null ? Number(star.epoch_mjd) : J2016_MJD;
  const years = (mjd - epoch) / DAYS_PER_YEAR;
  const pmra = Number(star.pmra) || 0;
  const pmdec = Number(star.pmdec) || 0;
  const cosDec = Math.max(Math.cos(star.dec * DEG), 1e-6);
  return {
    ra: star.ra + (pmra * years) / MAS_PER_DEG / cosDec,
    dec: star.dec + (pmdec * years) / MAS_PER_DEG,
  };
}

/**
 * Overlay geometry for every star: predicted position at `mjd`, plus an arrow from
 * the position at the first frame epoch to the last, lengthened by `exaggeration`.
 */
export function starGeometry(view, mjd, span, exaggeration) {
  const stars = Array.isArray(view.stars) ? view.stars : [];
  return stars.map((star) => {
    const at = (epoch) => {
      const p = propagate(star, epoch);
      return project(p.ra, p.dec, view);
    };
    const now = at(mjd);
    const start = at(span.start);
    const end = at(span.end);
    if (!now || !start || !end) return null;
    const arrow = {
      x0: start.x,
      y0: start.y,
      x1: start.x + (end.x - start.x) * exaggeration,
      y1: start.y + (end.y - start.y) * exaggeration,
    };
    return { star, now, arrow };
  }).filter(Boolean);
}

/** Mean MJD span of a frame list. */
export function frameSpan(frames) {
  const mjds = frames.map((f) => f.mjd).filter(Number.isFinite);
  if (!mjds.length) return { start: J2016_MJD, end: J2016_MJD };
  return { start: Math.min(...mjds), end: Math.max(...mjds) };
}

/** Human-readable total proper motion in arcsec/yr. */
export function totalPm(star) {
  return Math.hypot(Number(star.pmra) || 0, Number(star.pmdec) || 0) / 1000;
}

/** Inverse of `project`: fractional grid pixel (x, y) → {ra, dec} in degrees (RA in 0..360). */
export function unproject(x, y, view) {
  const centre = (view.grid.npix - 1) / 2;
  const perPix = view.grid.scale_arcsec / 3600;
  const xi = -(x - centre) * perPix * DEG;
  const eta = -(y - centre) * perPix * DEG;
  const a0 = view.ra * DEG;
  const d0 = view.dec * DEG;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, den);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.hypot(xi, den));
  return { ra: ((ra / DEG) % 360 + 360) % 360, dec: dec / DEG };
}

/** Stars at least as bright as `gmax` (stars without a magnitude are kept) and moving ≥ `minPm` mas/yr. */
export function filterStars(stars, { gmax = 21, minPm = 0 } = {}) {
  return stars.filter((s) => {
    const g = Number(s.gmag);
    if (Number.isFinite(g) && g > gmax) return false;
    return totalPm(s) * 1000 >= minPm;
  });
}

/** The overlay entry whose current position is closest to grid point (x, y), within `maxDist` px. */
export function nearestStar(geo, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  geo.forEach((g) => {
    const d = Math.hypot(g.now.x - x, g.now.y - y);
    if (d <= bestD) {
      best = g;
      bestD = d;
    }
  });
  return best;
}
