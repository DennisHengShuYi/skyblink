// Then & Now ("Decades Blink"): flip SPHEREx's deep stack against a dated, single-band
// picture of the same patch from an older survey (WISE ~2010, 2MASS ~1999), on the same
// north-up grid. A star that crawls 1–2 SPHEREx pixels in a year jumps 12–26 pixels over
// 15–26 years, and Gaia's predicted "then" and "now" positions land on it in both.
//
// Honesty rules (see the brainstorm report, idea I01):
// - only single-band, single-period surveys (never multi-year stacks or DSS colour);
// - every survey date is the catalogue epoch of that field, not a guess;
// - the old picture is a different telescope, colour and sharpness: compare positions only;
// - only offered on featured motion targets, never on variable stars.
import { project, propagate, hasMotion, totalPm } from './gaia.js';

const DAYS_PER_YEAR = 365.25;
export const MIN_SHIFT_PX = 3; // below this the old picture teaches nothing about motion

// Featured motion targets (keyed by the view-key hash shared by all six bands).
// `mjd` is the survey epoch of that field: AllWISE w2mjdmean / 2MASS jdate (IRSA Gator).
export const THEN_TARGETS = Object.freeze({
  '768d33c99b4c': {
    slug: 'barnard', survey: 'allwise-w2', hips: 'CDS/P/allWISE/W2', mjd: 55358.9,
    label: 'WISE, 4.6 µm', year: 2010,
    story: "In 1916 E. E. Barnard compared photographs taken years apart and found this star had moved further across the sky than any other. Here SPHEREx repeats his trick against NASA WISE's 2010 picture.",
  },
  e01445dc3f16: {
    slug: 'wise0855', survey: 'allwise-w2', hips: 'CDS/P/allWISE/W2', mjd: 55408.5,
    label: 'WISE, 4.6 µm', year: 2010,
    story: "In 2014 Kevin Luhman found WISE 0855 by spotting exactly this jump between WISE pictures. It is the coldest brown dwarf known, 7.4 light-years away. In 2010 it was the faint dot inside the dashed ring. Careful: an ordinary background star sits right next to today's crosshair; it is the one that doesn't move.",
    // Not in Gaia (too faint in visible light): published motion and its AllWISE position.
    star: {
      source_id: 'WISE J085510.83−071442.5', ra: 133.795125, dec: -7.245139,
      pmra: -8118, pmdec: 680, epoch_mjd: 55408.5, published: 'Luhman & Esplin 2016',
      parallax: 439, distance_ly: 7.4,
    },
  },
  '85387de0fcfc': {
    slug: 'epsindib', survey: '2mass-k', hips: 'CDS/P/2MASS/K', mjd: 51497.6,
    label: '2MASS, 2.2 µm', year: 1999,
    story: '2MASS photographed this pair of brown dwarfs in November 1999, years before anyone knew they were there. Astronomers found them in 2003 because of how fast they move.',
  },
});

export const SURVEY_CREDITS = {
  'allwise-w2': 'Older picture: NASA WISE (AllWISE), via IRSA / CDS.',
  '2mass-k': 'Older picture: 2MASS (UMass, IPAC/Caltech, NASA, NSF), via IRSA / CDS.',
};

/** Then & Now settings for a view, or null when the view isn't a supported motion target. */
export function thenTargetFor(view) {
  if (!view || typeof view.key !== 'string') return null;
  return THEN_TARGETS[view.key.split('-')[0]] || null;
}

/** Mean MJD of the view's images (the deep stack's effective date). */
export function deepEpoch(view) {
  const mjds = (view.visits || []).map((v) => v.mjd).filter(Number.isFinite);
  if (mjds.length) return mjds.reduce((a, b) => a + b, 0) / mjds.length;
  const st = (view.stacks || []).map((s) => s.mjd).filter(Number.isFinite);
  return st.length ? st.reduce((a, b) => a + b, 0) / st.length : null;
}

/** The star to ring: the target's published entry, else the fastest Gaia star in the picture. */
export function moverFor(view, target) {
  if (target?.star) return target.star;
  const P = view.grid.npix;
  const inside = (s) => {
    const p = project(s.ra, s.dec, view);
    return p && p.x >= -0.5 && p.y >= -0.5 && p.x <= P - 0.5 && p.y <= P - 0.5;
  };
  const movers = (view.stars || []).filter((s) => hasMotion(s) && inside(propagate(s, deepEpoch(view) ?? s.epoch_mjd)));
  movers.sort((a, b) => totalPm(b) - totalPm(a));
  return movers[0] || null;
}

/** Grid positions of `star` then and now, and how far it went. Null if it can't be placed. */
export function thenNowGeometry(view, star, thenMjd, nowMjd) {
  if (!star || !hasMotion(star) || !Number.isFinite(thenMjd) || !Number.isFinite(nowMjd)) return null;
  const at = (mjd) => {
    const p = propagate(star, mjd);
    return project(p.ra, p.dec, view);
  };
  const then = at(thenMjd);
  const now = at(nowMjd);
  if (!then || !now) return null;
  const shiftPx = Math.hypot(now.x - then.x, now.y - then.y);
  return {
    then, now, shiftPx,
    shiftArcsec: shiftPx * view.grid.scale_arcsec,
    years: (nowMjd - thenMjd) / DAYS_PER_YEAR,
    inside: [then, now].every((p) => p.x >= -0.5 && p.y >= -0.5 && p.x <= view.grid.npix - 0.5 && p.y <= view.grid.npix - 0.5),
  };
}

/** "+15 years: 2.7′ = 26 SPHEREx pixels" */
export function badgeText(g) {
  const years = Math.round(g.years);
  const angle = g.shiftArcsec >= 60 ? `${(g.shiftArcsec / 60).toFixed(1)}′` : `${g.shiftArcsec.toFixed(0)}″`;
  return `+${years} years: ${angle} = ${Math.round(g.shiftPx)} SPHEREx pixels`;
}

/** Year label for an MJD ("2025–26" style for the SPHEREx span). */
export function yearOf(mjd) {
  return new Date((mjd - 40587) * 86400000).getUTCFullYear();
}
