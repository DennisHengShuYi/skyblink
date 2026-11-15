// Picture health check (brainstorm idea I07, MVP): a plain verdict for each single picture
// in "Every image" mode, from its flagged-pixel share (manifest) and, once the pixel cube
// is loaded, its noise and sky level against the rest of the view. Pictures are never
// hidden by default: they are "marked unreliable, kept on purpose".

export const LEVELS = ['ok', 'care', 'poor'];
const FLAG_CARE = 0.1;
const FLAG_POOR = 0.3;
const NOISE_CARE = 2;
const NOISE_POOR = 4;
const SKY_CARE = 3; // sky offset in units of the typical noise

function median(a) {
  const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  return v.length ? v[v.length >> 1] : NaN;
}

/** {median, sigma, nanFrac} of one image plane. */
export function planeStats(plane) {
  const med = median(plane);
  const sigma = 1.4826 * median(Array.from(plane, (v) => Math.abs(v - med)));
  let nan = 0;
  for (let k = 0; k < plane.length; k += 1) if (!Number.isFinite(plane[k])) nan += 1;
  return { median: med, sigma, nanFrac: nan / plane.length };
}

/**
 * Health of each visit: [{level, reasons[]}] in visit order.
 * stats (optional): planeStats for each visit plane, same order.
 */
export function visitHealth(visits, stats = null) {
  const sig = stats ? median(stats.map((s) => s.sigma)) : NaN;
  const sky = stats ? median(stats.map((s) => s.median)) : NaN;
  return visits.map((v, k) => {
    const reasons = [];
    let level = 0;
    const raise = (l, why) => { level = Math.max(level, l); reasons.push(why); };
    const f = Number(v.flag_frac) || 0;
    if (f >= FLAG_POOR) raise(2, `${Math.round(f * 100)}% of its pixels are flagged by the pipeline`);
    else if (f >= FLAG_CARE) raise(1, `${Math.round(f * 100)}% of its pixels are flagged by the pipeline`);
    const s = stats?.[k];
    if (s && Number.isFinite(sig) && sig > 0) {
      const ratio = s.sigma / sig;
      if (ratio >= NOISE_POOR) raise(2, `about ${ratio.toFixed(0)}× noisier than the other pictures`);
      else if (ratio >= NOISE_CARE) raise(1, `about ${ratio.toFixed(1)}× noisier than the other pictures`);
      if (Math.abs(s.median - sky) >= SKY_CARE * sig) raise(1, 'its background is much brighter or darker than usual');
      if (s.nanFrac >= 0.2) raise(1, `${Math.round(s.nanFrac * 100)}% of it has no data`);
    }
    return { level: LEVELS[level], reasons };
  });
}

/** Short label for the frame title. */
export function healthLabel(h) {
  if (!h || h.level === 'ok') return '';
  return h.level === 'poor' ? ' · ⚠ poor picture' : ' · use with care';
}

/** Map visit i → health for a view; `planeOf(k)` gives the k-th visit plane once the cube loads. */
export function healthMap(visits, planeOf = null) {
  const levels = visitHealth(visits, planeOf ? visits.map((_, k) => planeStats(planeOf(k))) : null);
  return new Map(visits.map((x, k) => [x.i, levels[k]]));
}
