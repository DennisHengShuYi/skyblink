// "What moves here?": an honest, numeric answer from the field's own Gaia stars.
// Most patches of sky show nothing moving in SPHEREx's year; this says why, with numbers
// (the fastest star here needs N years to move one pixel), instead of leaving a dead end.
import { project, propagate, hasMotion, totalPm } from './gaia.js';

const DAYS_PER_YEAR = 365.25;
export const VISIBLE_PX = 0.5;   // a shift a careful eye can catch by blinking
export const STAR_LIST_CAP = 400; // stars.py MAX_STARS

/** First and last image dates of the view (MJD) and the span in years. */
export function watchSpan(view) {
  const mjds = (view.visits || []).map((v) => v.mjd).filter(Number.isFinite);
  if (mjds.length < 2) return null;
  const start = Math.min(...mjds);
  const end = Math.max(...mjds);
  return { start, end, years: (end - start) / DAYS_PER_YEAR };
}

/** Stars whose position at `mjd` falls inside the picture, and whose motion Gaia measured. */
export function starsInside(view, stars, mjd) {
  const P = view.grid.npix;
  return stars.filter((s) => {
    if (!hasMotion(s)) return false;
    const p = propagate(s, mjd);
    const g = project(p.ra, p.dec, view);
    return g && g.x >= -0.5 && g.y >= -0.5 && g.x <= P - 0.5 && g.y <= P - 0.5;
  });
}

/**
 * Summary for the "What moves here?" card.
 * extra: stars not in Gaia but with a published motion (e.g. WISE 0855).
 * Returns {kind: 'mover'|'still'|'unknown', star, pxPerYear, pxOverSpan, yearsPerPixel,
 *          spanYears, counted, capped, published}.
 */
export function motionSummary(view, extra = []) {
  const span = watchSpan(view);
  if (!view?.grid || !span) return { kind: 'unknown' };
  const scale = view.grid.scale_arcsec;
  const listed = Array.isArray(view.stars) ? view.stars : [];
  const mid = (span.start + span.end) / 2;
  const candidates = starsInside(view, [...extra, ...listed], mid);
  const counted = candidates.length - starsInside(view, extra, mid).length;
  if (!candidates.length) return { kind: 'unknown', spanYears: span.years, counted: 0, capped: listed.length >= STAR_LIST_CAP };
  const fastest = candidates.reduce((a, b) => (totalPm(b) > totalPm(a) ? b : a));
  const pxPerYear = totalPm(fastest) / scale;
  const pxOverSpan = pxPerYear * span.years;
  return {
    kind: pxOverSpan >= VISIBLE_PX ? 'mover' : 'still',
    star: fastest,
    pxPerYear,
    pxOverSpan,
    yearsPerPixel: pxPerYear > 0 ? 1 / pxPerYear : Infinity,
    spanYears: span.years,
    counted,
    capped: listed.length >= STAR_LIST_CAP,
    published: Boolean(fastest.published),
  };
}

/** Rounded "about 190 years" style text for a duration in years. */
export function yearsText(y) {
  if (!Number.isFinite(y)) return 'forever, as far as Gaia can tell';
  if (y < 1.5) return `about ${Math.max(1, Math.round(y * 12))} months`;
  if (y < 20) return `about ${Math.round(y)} years`;
  const mag = 10 ** Math.floor(Math.log10(y) - 1);
  return `about ${(Math.round(y / mag) * mag).toLocaleString('en')} years`;
}

/** Plain-language lines for the card. */
export function motionText(sum) {
  if (sum.kind === 'unknown') {
    return {
      title: 'What moves here?',
      body: 'Gaia measured no star motions inside this picture, so SkyBlink cannot say what should move here.',
    };
  }
  const watched = sum.spanYears >= 0.9 ? `${sum.spanYears.toFixed(1)} years` : `${Math.round(sum.spanYears * 12)} months`;
  const counted = sum.counted ? ` (of the ${sum.counted}${sum.capped ? ' brightest' : ''} Gaia stars in the picture)` : '';
  const pm = totalPm(sum.star);
  if (sum.kind === 'mover') {
    return {
      title: 'Something here moves',
      body: `The fastest star here${counted} crosses ${pm.toFixed(2)}″ of sky a year: ${sum.pxPerYear.toFixed(1)} SPHEREx pixels a year, so about ${sum.pxOverSpan.toFixed(1)} pixels over the ${watched} SPHEREx has watched. Blink the first and last frames and look for it in the green ring.`,
    };
  }
  return {
    title: 'Why nothing seems to move here',
    body: `Stars are so far away that almost none visibly move. The fastest star here${counted} drifts ${pm < 0.01 ? pm.toFixed(3) : pm.toFixed(2)}″ a year, so it needs ${yearsText(sum.yearsPerPixel)} to move one SPHEREx pixel, and SPHEREx has watched for ${watched}. Only the Sun's nearest neighbours move a pixel a year: try one of these.`,
  };
}
