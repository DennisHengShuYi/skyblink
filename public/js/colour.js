// False-colour view: D1 → blue, D3 → green, D6 → red, from each detector's float cube.
// Each channel keeps that detector's own fixed stretch for every frame (the colour form of
// "one shared stretch per view"), so colour frames stay comparable through the animation.
export const COLOUR_DETS = Object.freeze({ r: 'D6', g: 'D3', b: 'D1' });
const MATCH_MAX_DAYS = 60;

/** For each reference MJD, the index of the nearest other MJD within maxDays (else null). */
export function matchByDate(refMjds, otherMjds, maxDays = MATCH_MAX_DAYS) {
  return refMjds.map((t) => {
    let best = null;
    let bestD = maxDays;
    otherMjds.forEach((u, i) => {
      const d = Math.abs(u - t);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  });
}

/** Same curve as the backend's imaging.to_uint8 (asinh with lo/hi/soft); NaN → sky (0). */
export function stretchByte(value, { lo, hi, soft }) {
  const v = Number.isFinite(value) ? value : 0;
  const x = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return Math.round((Math.asinh(x / soft) / Math.asinh(1 / soft)) * 255);
}

const SKY_LO_SIGMA = 2;
const SOFT_SIGMA = 2.5;
const WHITE_PCT = 0.995;

function sortedFinite(plane) {
  const v = [];
  for (let i = 0; i < plane.length; i += 1) if (Number.isFinite(plane[i])) v.push(plane[i]);
  return v.sort((a, b) => a - b);
}

/**
 * A balanced stretch for one colour channel from its deep plane: sky just above black,
 * the field's bright stars (99.5th percentile) near white, curve bend at 2.5σ — so ordinary
 * stars come out roughly neutral and truly red or blue objects stand out.
 */
export function channelStretch(deep) {
  const v = sortedFinite(deep);
  if (!v.length) return { lo: 0, hi: 1, soft: 0.1 };
  const med = v[v.length >> 1];
  const dev = v.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
  const sigma = 1.4826 * dev[dev.length >> 1] || 1e-6;
  const lo = med - SKY_LO_SIGMA * sigma;
  const hi = Math.max(v[Math.min(v.length - 1, Math.floor(WHITE_PCT * v.length))], lo + 50 * sigma);
  return { lo, hi, soft: Math.min(0.5, Math.max(1e-5, (SOFT_SIGMA * sigma) / (hi - lo))) };
}

/** RGBA bytes for a P×P colour image from three float planes and their stretches. */
export function colourPixels(planes, stretches, P) {
  const out = new Uint8ClampedArray(P * P * 4);
  for (let i = 0; i < P * P; i += 1) {
    const o = i * 4;
    out[o] = stretchByte(planes.r[i], stretches.r);
    out[o + 1] = stretchByte(planes.g[i], stretches.g);
    out[o + 2] = stretchByte(planes.b[i], stretches.b);
    out[o + 3] = 255;
  }
  return out;
}

/** The colour image on a P×P canvas (browser only). */
export function colourCanvas(planes, stretches, P) {
  const canvas = document.createElement('canvas');
  canvas.width = P;
  canvas.height = P;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(P, P);
  img.data.set(colourPixels(planes, stretches, P));
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Colour frames aligned with `view.stacks` plus a colour deep stack, or {missing: [dets]}
 * when D1/D3/D6 aren't all available. `detectorList` is [{det, view: Promise<view>}] for this
 * position (current view, this session's builds and siblings — see spectrum-data.js).
 */
export async function loadColour(view, detectorList) {
  const wanted = Object.values(COLOUR_DETS);
  const sources = new Map(detectorList.map((s) => [s.det, s.view]));
  const missing = wanted.filter((d) => !sources.has(d));
  if (missing.length) return { missing };
  const { loadCube } = await import('./cube.js'); // browser-only (cube.js → api.js reads location)
  const channels = {};
  await Promise.all(Object.entries(COLOUR_DETS).map(async ([ch, det]) => {
    const v = await sources.get(det);
    channels[ch] = { view: v, cube: await loadCube(v) };
  }));
  const P = channels.r.cube.P;
  if (channels.g.cube.P !== P || channels.b.cube.P !== P) throw new Error('These detectors were built on different grids.');
  // Balanced per-channel scales (fixed for every frame of the colour animation).
  const stretches = { r: channelStretch(channels.r.cube.deep()), g: channelStretch(channels.g.cube.deep()), b: channelStretch(channels.b.cube.deep()) };
  const refMjds = (view.stacks || []).map((s) => Number(s.mjd));
  const matched = {};
  Object.entries(channels).forEach(([ch, { view: v }]) => {
    matched[ch] = matchByDate(refMjds, (v.stacks || []).map((s) => Number(s.mjd)));
  });
  const planeFor = (ch, k) => {
    const idx = matched[ch][k];
    return idx === null ? channels[ch].cube.deep() : channels[ch].cube.stack(idx);
  };
  const frames = refMjds.map((_, k) => colourCanvas(
    { r: planeFor('r', k), g: planeFor('g', k), b: planeFor('b', k) }, stretches, P));
  const deep = colourCanvas(
    { r: channels.r.cube.deep(), g: channels.g.cube.deep(), b: channels.b.cube.deep() }, stretches, P);
  return { frames, deep };
}
