// Pure pixel measurements from a view's float cube: apertures, per-visit series
// (spectrum and light curve), stack/deep variances, S/N differences and the
// difference colour scale. `cube` only needs P, N and img(i)/variance(i)/um(i).

/** A pixel whose variance is this many times the frame's median is a filled saturated core. */
export const SATURATED_FACTOR = 1000;

export function medianOf(values) {
  const v = Float32Array.from(values).filter(Number.isFinite).sort();
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function robustSigma(values) {
  const med = medianOf(values);
  return 1.4826 * medianOf(Array.from(values, (v) => Math.abs(v - med)));
}

/** Row-major pixel indices of a (2r+1)² box around (x, y), clipped to the grid. */
export function apertureIndices(P, x, y, r) {
  const out = [];
  for (let yy = y - r; yy <= y + r; yy += 1) {
    for (let xx = x - r; xx <= x + r; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < P && yy < P) out.push(yy * P + xx);
    }
  }
  return out;
}

/** Mean of the finite pixels; error from their variances (σ of the mean). */
export function apertureMean(plane, varPlane, idx) {
  let sum = 0;
  let varSum = 0;
  let n = 0;
  let varOk = Boolean(varPlane);
  idx.forEach((k) => {
    if (!Number.isFinite(plane[k])) return;
    sum += plane[k];
    n += 1;
    if (varOk && Number.isFinite(varPlane[k]) && varPlane[k] >= 0) varSum += varPlane[k];
    else varOk = false;
  });
  if (!n) return { flux: NaN, err: null, n: 0 };
  return { flux: sum / n, err: varOk ? Math.sqrt(varSum) / n : null, n };
}

const medVarCache = new WeakMap();

function medianVariance(cube, i) {
  let byIndex = medVarCache.get(cube);
  if (!byIndex) {
    byIndex = new Map();
    medVarCache.set(cube, byIndex);
  }
  if (!byIndex.has(i)) byIndex.set(i, medianOf(cube.variance(i)));
  return byIndex.get(i);
}

/**
 * One point per visit at grid pixel (x, y) with a (2r+1)² aperture:
 * {i, flux, err, um, mjd, window, det, saturated}. Skips visits with no finite data there.
 */
export function pixelSeries(cube, view, x, y, r = 0) {
  if (x < 0 || y < 0 || x >= cube.P || y >= cube.P) return [];
  const idx = apertureIndices(cube.P, x, y, r);
  const centre = y * cube.P + x;
  const det = view.det || view.band?.det;
  const visits = view.visits || [];
  const points = [];
  for (let i = 0; i < cube.N; i += 1) {
    const vars = cube.variance(i);
    const { flux, err } = apertureMean(cube.img(i), vars, idx);
    const um = cube.um(i)[centre];
    if (!Number.isFinite(flux) || !Number.isFinite(um)) continue;
    const med = medianVariance(cube, i);
    const saturated = idx.some((k) => Number.isFinite(vars[k]) && med > 0 && vars[k] > SATURATED_FACTOR * med);
    points.push({ i, flux, err, um, mjd: visits[i]?.mjd, window: visits[i]?.window, det, saturated });
  }
  return points;
}

function inverseVarianceSum(cube, include) {
  const P2 = cube.P * cube.P;
  const w = new Float64Array(P2);
  for (let i = 0; i < cube.N; i += 1) {
    if (!include(i)) continue;
    const v = cube.variance(i);
    const img = cube.img(i);
    for (let k = 0; k < P2; k += 1) if (v[k] > 0 && Number.isFinite(img[k])) w[k] += 1 / v[k];
  }
  return Float32Array.from(w, (s) => (s > 0 ? 1 / s : NaN));
}

/** Variance of a survey-window stack (inverse-variance combination of its visits). */
export function stackVariance(cube, view, windowId) {
  const visits = view.visits || [];
  return inverseVarianceSum(cube, (i) => visits[i]?.window === windowId);
}

export function deepVariance(cube) {
  return inverseVarianceSum(cube, () => true);
}

/** (B − A) / √(varA + varB): the change in units of its own noise. */
export function snDifference(a, b, va, vb) {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k += 1) {
    const s = Math.sqrt(va[k] + vb[k]);
    out[k] = Number.isFinite(a[k]) && Number.isFinite(b[k]) && s > 0 ? (b[k] - a[k]) / s : NaN;
  }
  return out;
}

/**
 * Difference → RGBA. `full` is the change shown at full colour; changes under
 * 2.5/12 of it are dimmed so noise doesn't dominate. Masked pixels are mid-grey.
 */
export function diffToRGBA(d, full) {
  const out = new Uint8ClampedArray(d.length * 4);
  const s = full > 0 ? full : 1;
  const norm = Math.asinh(5);
  for (let k = 0; k < d.length; k += 1) {
    const o = k * 4;
    out[o + 3] = 255;
    if (!Number.isFinite(d[k])) {
      out[o] = 60; out[o + 1] = 60; out[o + 2] = 60;
      continue;
    }
    const v = Math.max(-1, Math.min(1, d[k] / s));
    let mag = Math.asinh(Math.abs(v) / 0.2) / norm;
    if (Math.abs(v) * 12 < 2.5) mag *= 0.35;
    out[o] = 20 + (v > 0 ? mag * 235 : 0);
    out[o + 1] = 20 + mag * 40;
    out[o + 2] = 20 + (v < 0 ? mag * 235 : 0);
  }
  return out;
}
