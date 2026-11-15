// "How far away is everything?": the picture's own Gaia stars on one distance ruler.
// Only well-measured parallaxes (≥ 5× their error) become distances; the rest are counted
// as "too far to measure well". Answers "why does only that one move?": nearness.
import { project, propagate, hasMotion } from './gaia.js';
import { watchSpan } from './movers.js';

export const LY_PER_MAS = 3261.56; // light-years = 3261.56 / parallax in milliarcseconds
export const MIN_PARALLAX_SN = 5;
export const RULER_MIN_LY = 1;
export const RULER_MAX_LY = 100000;

/** Distance in light-years from a well-measured parallax, else null. */
export function distanceLy(star) {
  const plx = Number(star.parallax);
  const sn = Number(star.parallax_over_error);
  if (star.parallax == null || !Number.isFinite(plx) || plx <= 0) return null;
  if (star.distance_ly) return star.distance_ly;
  if (!Number.isFinite(sn) || sn < MIN_PARALLAX_SN) return null;
  return LY_PER_MAS / plx;
}

/** 0..1 position of a distance on the log ruler. */
export function rulerPosition(ly) {
  const t = (Math.log10(ly) - Math.log10(RULER_MIN_LY)) / (Math.log10(RULER_MAX_LY) - Math.log10(RULER_MIN_LY));
  return Math.min(1, Math.max(0, t));
}

/**
 * Stars inside the picture with their distances.
 * extra: stars not in Gaia with a published distance (distance_ly), e.g. WISE 0855.
 * Returns {measured: [{star, ly, x, y, moves}], unmeasured, nearest, farthest}.
 */
export function distanceSummary(view, extra = []) {
  const span = watchSpan(view);
  const mjd = span ? (span.start + span.end) / 2 : 57388.5;
  const P = view.grid.npix;
  const measured = [];
  let unmeasured = 0;
  [...extra, ...(view.stars || [])].forEach((star) => {
    const p = hasMotion(star) ? propagate(star, mjd) : star;
    const g = project(p.ra, p.dec, view);
    if (!g || g.x < -0.5 || g.y < -0.5 || g.x > P - 0.5 || g.y > P - 0.5) return;
    const ly = distanceLy(star);
    if (ly === null) {
      unmeasured += 1;
      return;
    }
    const pxPerYear = hasMotion(star) ? Math.hypot(star.pmra, star.pmdec) / 1000 / view.grid.scale_arcsec : 0;
    measured.push({ star, ly, x: g.x, y: g.y, moves: span ? pxPerYear * span.years >= 0.5 : false });
  });
  measured.sort((a, b) => a.ly - b.ly);
  return {
    measured,
    unmeasured,
    nearest: measured[0] || null,
    farthest: measured[measured.length - 1] || null,
  };
}

const lyText = (ly) => (ly < 100 ? `${ly.toFixed(1)}` : Math.round(ly).toLocaleString('en'));

/** Plain summary line. */
export function distanceText(sum) {
  if (!sum.measured.length) return 'Gaia could not measure the distance of any star in this picture well enough.';
  const movers = sum.measured.filter((m) => m.moves);
  const tail = movers.length
    ? ` The ${movers.length === 1 ? 'one that visibly moves is' : `${movers.length} that visibly move are`} among the nearest: nearer stars cross the sky faster, the way a nearby car passes quicker than a far-off plane.`
    : ' None is near enough to visibly move in SPHEREx\'s year.';
  return `${sum.measured.length} stars here have a measured distance: the nearest is ${lyText(sum.nearest.ly)} light-years away, the farthest ${lyText(sum.farthest.ly)}.${sum.unmeasured ? ` ${sum.unmeasured} more are too far for Gaia to measure well.` : ''}${tail}`;
}
