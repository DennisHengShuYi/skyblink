// A Sky You Can Read (brainstorm idea I23, MVP): describe the picture in words and list
// its brightest objects by clock position, brightness rank, Gaia match and expected
// motion, for screen-reader and keyboard users (and as alt text anyone can copy).
import { project, propagate, hasMotion, totalPm } from './gaia.js';
import { motionSummary, motionText, watchSpan } from './movers.js';

export const MAX_OBJECTS = 20;
export const DETECT_SIGMA = 5;
export const MATCH_PX = 1.5;

function median(a) {
  const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return v.length ? v[v.length >> 1] : NaN;
}

/** Local maxima at least DETECT_SIGMA robust-sigma above the median, brightest first. */
export function findPeaks(plane, P, max = MAX_OBJECTS) {
  const med = median(plane);
  const mad = median(Array.from(plane, (v) => Math.abs(v - med)));
  const sigma = 1.4826 * mad || 1e-9;
  const peaks = [];
  for (let y = 1; y < P - 1; y += 1) {
    for (let x = 1; x < P - 1; x += 1) {
      const v = plane[y * P + x];
      if (!Number.isFinite(v) || v < med + DETECT_SIGMA * sigma) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dy) && plane[(y + dy) * P + x + dx] > v) { top = false; break; }
        }
      }
      if (top) peaks.push({ x, y, value: v, sn: (v - med) / sigma });
    }
  }
  return peaks.sort((a, b) => b.value - a.value).slice(0, max);
}

/** "2 o'clock, halfway out" (12 = north/up, 3 = west/right because east is left). */
export function clockPosition(x, y, P) {
  const c = (P - 1) / 2;
  const dx = x - c;
  const dy = c - y;
  const r = Math.hypot(dx, dy) / c;
  if (r < 0.12) return 'in the middle';
  let hour = Math.round((Math.atan2(dx, dy) / (2 * Math.PI)) * 12);
  if (hour <= 0) hour += 12;
  const ring = r < 0.45 ? 'near the middle' : r < 0.8 ? 'halfway out' : 'near the edge';
  return `${hour} o'clock, ${ring}`;
}

/** Objects with clock positions, Gaia matches and motion over SPHEREx's span. */
export function describeObjects(view, plane, extra = []) {
  const P = view.grid.npix;
  const span = watchSpan(view);
  const mjd = span ? (span.start + span.end) / 2 : 57388.5;
  const stars = [...extra, ...(view.stars || [])].map((s) => {
    const p = hasMotion(s) ? propagate(s, mjd) : s;
    return { s, g: project(p.ra, p.dec, view) };
  }).filter((o) => o.g);
  return findPeaks(plane, P).map((pk, rank) => {
    let match = null;
    let best = MATCH_PX;
    stars.forEach(({ s, g }) => {
      const d = Math.hypot(g.x - pk.x, g.y - pk.y);
      if (d <= best) { best = d; match = s; }
    });
    const px = match && hasMotion(match) && span ? (totalPm(match) / view.grid.scale_arcsec) * span.years : 0;
    return {
      rank: rank + 1, x: pk.x, y: pk.y, where: clockPosition(pk.x, pk.y, P), sn: pk.sn, star: match,
      motion: !match ? 'not in SkyBlink\'s Gaia list' : !hasMotion(match) ? 'Gaia has no motion for it' : px >= 0.5 ? `should move about ${px.toFixed(1)} pixels in SPHEREx's year` : 'should stay still',
    };
  });
}

/** Longer description of the whole view, for the Describe panel and as copyable alt text. */
export function describeView(view, objects, extra = []) {
  const sum = motionSummary(view, extra);
  const span = watchSpan(view);
  const n = (view.stacks || []).length;
  const words = [
    `A square patch of sky ${(view.grid.npix * view.grid.scale_arcsec / 60).toFixed(0)} arcminutes across (about a fifth of the Moon's width), seen by NASA's SPHEREx in infrared band ${view.det}. North is up and east is left.`,
    `SPHEREx photographed it ${(view.visits || []).length} times in ${n} visits${span ? ` over ${Math.round(span.years * 12)} months` : ''}.`,
    objects.length ? `The ${Math.min(objects.length, 3)} brightest objects: ${objects.slice(0, 3).map((o) => `${o.where} (${o.motion})`).join('; ')}.` : 'No object stands out clearly from the background.',
    motionText(sum).body,
  ];
  return words.join(' ');
}
