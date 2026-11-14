// Pure pixel rendering: shared-stretch functions, levels, colour maps, Catmull-Rom
// upscaling and colour-bar ticks. Every frame of a view uses the same stretch
// (manifest `stretch.lo/hi`), so blinking compares sky, not display settings.

export const STRETCH_KINDS = ['asinh', 'linear', 'sqrt', 'log', 'faint'];
export const STRETCH_LABELS = {
  asinh: 'Asinh (default)', linear: 'Linear', sqrt: 'Square root', log: 'Log', faint: 'Faint (linear to 15σ)',
};
const DEFAULT_SOFT = 0.08;
const LOG_A = 1000;
const FAINT_SIGMA = 15;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Value → 0..1 for one stretch kind. NaN (masked) pixels draw at the sky level (0). */
export function stretchFn(stretch, kind = 'asinh') {
  const lo = Number(stretch.lo);
  const hi = Number(stretch.hi) > lo ? Number(stretch.hi) : lo + 1e-6;
  const range = hi - lo;
  const soft = Number(stretch.soft) > 0 ? Number(stretch.soft) : DEFAULT_SOFT;
  const sigma = Number(stretch.sigma) > 0 ? Number(stretch.sigma) : range / 100;
  const norm = (v) => clamp01(((Number.isFinite(v) ? v : 0) - lo) / range);
  switch (kind) {
    case 'linear': return norm;
    case 'sqrt': return (v) => Math.sqrt(norm(v));
    case 'log': return (v) => Math.log10(1 + LOG_A * norm(v)) / Math.log10(1 + LOG_A);
    case 'faint': {
      const top = FAINT_SIGMA * sigma;
      return (v) => clamp01(((Number.isFinite(v) ? v : 0) - lo) / top);
    }
    default: {
      const den = Math.asinh(1 / soft);
      return (v) => Math.asinh(norm(v) / soft) / den;
    }
  }
}

/** Brightness = gain anchored at black; contrast = power curve on the mid-tones. */
export function applyLevels(x, brightness = 1, contrast = 1) {
  const g = Math.min(1, x * brightness);
  return contrast === 1 ? g : g ** contrast;
}

/** 256-entry 8-bit levels lookup (used for PNG frames before the cube arrives). */
export function levelsLut(brightness, contrast) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = Math.round(applyLevels(v / 255, brightness, contrast) * 255);
  return lut;
}

// Perceptual colour maps as control points (approximations of matplotlib/Green 2011).
export const COLORMAPS = {
  grey: [[0, 0, 0], [255, 255, 255]],
  inferno: [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]],
  viridis: [[68, 1, 84], [70, 50, 127], [54, 92, 141], [39, 127, 142], [31, 161, 135], [74, 194, 109], [159, 218, 58], [253, 231, 37]],
  cubehelix: [[0, 0, 0], [22, 26, 59], [24, 74, 70], [61, 105, 46], [141, 108, 61], [194, 120, 142], [204, 167, 223], [255, 255, 255]],
};
export const COLORMAP_LABELS = { grey: 'Grey', inferno: 'Inferno', viridis: 'Viridis', cubehelix: 'Cubehelix' };

const lutCache = new Map();

/** 256 × RGB lookup for a colour map (unknown names fall back to grey). */
export function colormapLut(name) {
  const key = COLORMAPS[name] ? name : 'grey';
  if (lutCache.has(key)) return lutCache.get(key);
  const stops = COLORMAPS[key];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const f = t - k;
    for (let c = 0; c < 3; c += 1) lut[i * 3 + c] = Math.round(stops[k][c] * (1 - f) + stops[k + 1][c] * f);
  }
  lutCache.set(key, lut);
  return lut;
}

function catmullRom(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/**
 * Upscale a P×P field of 0..1 values to out×out with separable Catmull-Rom (sharper than
 * bilinear, no blur halo). Source pixel centres land on output pixel centres; clamped to 0..1.
 */
export function catmullRomUpscale(src, P, out) {
  const scale = P / out;
  const at = (x, y) => src[Math.min(P - 1, Math.max(0, y)) * P + Math.min(P - 1, Math.max(0, x))];
  const rows = new Float32Array(P * out); // horizontal pass: P rows × out columns
  for (let y = 0; y < P; y += 1) {
    for (let ox = 0; ox < out; ox += 1) {
      const sx = (ox + 0.5) * scale - 0.5;
      const x1 = Math.floor(sx);
      rows[y * out + ox] = catmullRom(at(x1 - 1, y), at(x1, y), at(x1 + 1, y), at(x1 + 2, y), sx - x1);
    }
  }
  const dst = new Float32Array(out * out);
  const rowAt = (y, ox) => rows[Math.min(P - 1, Math.max(0, y)) * out + ox];
  for (let oy = 0; oy < out; oy += 1) {
    const sy = (oy + 0.5) * scale - 0.5;
    const y1 = Math.floor(sy);
    const t = sy - y1;
    for (let ox = 0; ox < out; ox += 1) {
      dst[oy * out + ox] = clamp01(catmullRom(rowAt(y1 - 1, ox), rowAt(y1, ox), rowAt(y1 + 1, ox), rowAt(y1 + 2, ox), t));
    }
  }
  return dst;
}

/** 0..1 values → opaque RGBA through a colour-map lookup. */
export function composeRGBA(values, lut) {
  const out = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const k = Math.round(clamp01(values[i]) * 255) * 3;
    const o = i * 4;
    out[o] = lut[k];
    out[o + 1] = lut[k + 1];
    out[o + 2] = lut[k + 2];
    out[o + 3] = 255;
  }
  return out;
}

/** Display values (0..1) for a float plane under one stretch + levels. */
export function planeToValues(plane, stretch, kind, brightness = 1, contrast = 1) {
  const f = stretchFn(stretch, kind);
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i += 1) out[i] = applyLevels(f(plane[i]), brightness, contrast);
  return out;
}

const MIN_TICK_GAP = 0.15; // fraction of the bar between labels

/**
 * Tick marks for a colour bar: values (MJy/sr) and their 0..1 positions under the stretch.
 * Candidates are 0 (the sky level) and 1-2-5 × 10^k; kept left to right with a minimum gap
 * so labels never overlap, whatever the stretch.
 */
export function colorbarTicks(stretch, kind = 'asinh') {
  const f = stretchFn(stretch, kind);
  const lo = Number(stretch.lo);
  const sigma = Number(stretch.sigma) > 0 ? Number(stretch.sigma) : (stretch.hi - lo) / 100;
  const hi = kind === 'faint' ? lo + FAINT_SIGMA * sigma : Number(stretch.hi);
  const top = Math.max(Math.abs(lo), Math.abs(hi));
  const candidates = [0];
  for (let k = Math.floor(Math.log10(top)) - 4; k <= Math.ceil(Math.log10(top)); k += 1) {
    [1, 2, 5].forEach((m) => candidates.push(m * 10 ** k)); // below the sky is only noise: no negative labels
  }
  const inRange = candidates
    .map((v) => +v.toPrecision(6))
    .filter((v) => v >= lo && v <= hi)
    .sort((a, b) => a - b);
  const ticks = [];
  inRange.forEach((value) => {
    const pos = f(value);
    if (!ticks.length || pos - ticks[ticks.length - 1].pos >= MIN_TICK_GAP) ticks.push({ value, pos });
  });
  return ticks;
}
