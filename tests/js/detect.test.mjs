import { test } from 'node:test';
import assert from 'node:assert/strict';
import { robustStats, findSources, measure, detectFinds, wavelengthsMatch } from '../../frontend/js/detect.js';

const P = 31;
const NOISE = 0.01;

/** Deterministic pseudo-random normal noise (mulberry32 + Box-Muller). */
function rng(seed) {
  let a = seed >>> 0;
  const uni = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uni() + 1e-12)) * Math.cos(2 * Math.PI * uni());
}

function noisePlane(seed, sigma = NOISE) {
  const r = rng(seed);
  const p = new Float32Array(P * P);
  for (let i = 0; i < p.length; i += 1) p[i] = r() * sigma;
  return p;
}

/** Add a Gaussian source (sigma 1 px) with total flux `flux` at (x, y). */
function addSource(plane, x, y, flux, clip = Infinity) {
  const norm = flux / (2 * Math.PI);
  for (let row = 0; row < P; row += 1) {
    for (let col = 0; col < P; col += 1) {
      const d2 = (col - x) ** 2 + (row - y) ** 2;
      const v = norm * Math.exp(-d2 / 2);
      plane[row * P + col] = Math.min(plane[row * P + col] + v, clip);
    }
  }
  return plane;
}

const view = (stars = [], mjds = [60800, 60983, 61166]) => ({
  ra: 100, dec: 0, grid: { npix: P, scale_arcsec: 6.15 }, stars,
  stacks: mjds.map((mjd, i) => ({ window: i, mjd, date: `D${i}` })),
});

function stacksWith(positions, fluxes, seed = 1) {
  return positions.map(([x, y], i) => addSource(noisePlane(seed + i), x, y, fluxes[i]));
}

function deepOf(stacks) {
  const d = new Float32Array(P * P);
  stacks.forEach((s) => s.forEach((v, i) => { d[i] += v / stacks.length; }));
  return d;
}

test('robustStats measures the noise and ignores NaN', () => {
  const p = noisePlane(7);
  p[0] = NaN;
  const { median, sigma } = robustStats(p);
  assert.ok(Math.abs(median) < 0.003);
  assert.ok(Math.abs(sigma - NOISE) / NOISE < 0.1);
});

test('robustStats on an all-masked plane gives no noise level without crashing', () => {
  const { sigma } = robustStats(new Float32Array(9).fill(NaN));
  assert.ok(!Number.isFinite(sigma) || sigma === 0);
});

test('findSources finds a 20-sigma source and ignores noise', () => {
  const p = addSource(noisePlane(2), 15, 15, 20 * NOISE * 2 * Math.PI);
  const s = findSources(p, P);
  assert.equal(s.length, 1);
  assert.ok(Math.hypot(s[0].x - 15, s[0].y - 15) <= 0.5);
});

test('findSources finds nothing in pure noise', () => {
  assert.equal(findSources(noisePlane(3), P).length, 0);
});

test('findSources ignores a source within 2 px of the edge', () => {
  assert.equal(findSources(addSource(noisePlane(4), 1, 15, 2), P).length, 0);
});

test('findSources lists two sources, brighter first', () => {
  const p = addSource(addSource(noisePlane(5), 8, 8, 1), 22, 22, 3);
  const s = findSources(p, P);
  assert.equal(s.length, 2);
  assert.equal(s[0].x, 22);
});

test('findSources caps the list at 40', () => {
  // A sparse 121x121 field with 49 sources 16 px apart (realistic sky between them).
  const Q = 121;
  const r = rng(6);
  const p = new Float32Array(Q * Q).map(() => r() * NOISE);
  for (let k = 0; k < 49; k += 1) {
    const sx = 12 + (k % 7) * 16;
    const sy = 12 + Math.floor(k / 7) * 16;
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) p[(sy + dy) * Q + sx + dx] += Math.exp(-(dx * dx + dy * dy) / 2) / (2 * Math.PI);
    }
  }
  assert.equal(findSources(p, Q).length, 40);
});

test('measure recovers a sub-pixel centroid and flux', () => {
  const p = addSource(noisePlane(8), 10.3, 12.0, 1);
  const m = measure(p, P, 10, 12);
  assert.ok(m.ok);
  assert.ok(Math.abs(m.cx - 10.3) < 0.15);
  assert.ok(Math.abs(m.flux - 1) / 1 < 0.1);
});

test('measure reports a mostly-masked spot as not measurable', () => {
  const p = addSource(noisePlane(9), 15, 15, 1);
  for (let r = 13; r <= 17; r += 1) for (let c = 13; c <= 16; c += 1) p[r * P + c] = NaN;
  assert.equal(measure(p, P, 15, 15).ok, false);
});

test('detectFinds flags a 2 px mover with the first and last stacks as best pair', () => {
  const st = stacksWith([[14, 15], [15, 15], [16, 15]], [2, 2, 2]);
  const f = detectFinds(view(), st, deepOf(st), P);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'moving');
  assert.ok(Math.abs(f[0].shiftPx - 2) <= 0.3);
  assert.equal(f[0].from, 0);
  assert.equal(f[0].to, 2);
  assert.equal(f[0].gaia, null);
});

test('detectFinds ignores a 0.3 px shift', () => {
  const st = stacksWith([[15, 15], [15.15, 15], [15.3, 15]], [2, 2, 2]);
  assert.equal(detectFinds(view(), st, deepOf(st), P).length, 0);
});

test('detectFinds ignores a mover too faint to measure (< 8 sigma)', () => {
  const faint = 7 * NOISE * 2 * Math.PI * 0.5;
  const st = stacksWith([[13, 15], [15, 15], [17, 15]], [faint, faint, faint]);
  assert.equal(detectFinds(view(), st, deepOf(st), P).filter((x) => x.kind === 'moving').length, 0);
});

test('detectFinds flags a doubling source as variable (+100%)', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [1, 1.5, 2]);
  const f = detectFinds(view(), st, deepOf(st), P);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'variable');
  assert.ok(Math.abs(f[0].fluxChange - 1) <= 0.15);
});

test('detectFinds flags a halving source as -50%', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [2, 1.5, 1]);
  const f = detectFinds(view(), st, deepOf(st), P);
  assert.equal(f[0].kind, 'variable');
  assert.ok(Math.abs(f[0].fluxChange + 0.5) <= 0.1);
});

test('detectFinds ignores a 10% brightness change', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [1, 1.05, 1.1]);
  assert.equal(detectFinds(view(), st, deepOf(st), P).length, 0);
});

test('detectFinds ignores a big percentage change buried in noise', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [0.05, 0.07, 0.1]);
  assert.equal(detectFinds(view(), st, deepOf(st), P).length, 0);
});

test('a saturated star whose wings change by 40% is NOT called variable (glow estimate switched off)', () => {
  // RULING (reverses the earlier approved glow test): across the 40 pre-built views the glow
  // estimate flagged 35% of saturated sources, far above what real variables explain.
  const st = [1, 1.2, 1.4].map((k, i) => addSource(noisePlane(20 + i), 15, 15, 400 * k, 5));
  const f = detectFinds(view(), st, deepOf(st), P).filter((x) => x.kind === 'variable');
  assert.equal(f.length, 0);
});

test('a saturated star with a steady glow is not variable', () => {
  const st = [1, 1, 1].map((k, i) => addSource(noisePlane(23 + i), 15, 15, 400 * k, 5));
  assert.equal(detectFinds(view(), st, deepOf(st), P).length, 0);
});

test('a saturated shifting star is moving only with a fast Gaia match', () => {
  const st = [14, 15, 16].map((x, i) => addSource(noisePlane(30 + i), x, 15, 400, 5));
  assert.equal(detectFinds(view(), st, deepOf(st), P).length, 0);
  // A fast Gaia star whose position, propagated to the stacks' mean epoch, lands on the source.
  const years = (60983 - 57388.5) / 365.25;
  const fast = { source_id: 'B', ra: 100, dec: -(5000 * years) / 3.6e6, pmra: 0, pmdec: 5000 };
  const f = detectFinds(view([fast]), st, deepOf(st), P);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'moving');
  assert.equal(f[0].saturated, true);
});

test('a mover on a Gaia star position is labelled with it; 3 px away is not', () => {
  const st = stacksWith([[14, 15], [15, 15], [16, 15]], [2, 2, 2]);
  const yrs = (60983 - 57388.5) / 365.25; // a genuinely moving Gaia star, on the source at the mean epoch
  const on = { source_id: 'X', ra: 100, dec: -(1000 * yrs) / 3.6e6, pmra: 0, pmdec: 1000 };
  assert.equal(detectFinds(view([on]), st, deepOf(st), P)[0].gaia.source_id, 'X');
  const off = { source_id: 'Y', ra: 100, dec: 3 * 6.15 / 3600, pmra: 0, pmdec: 0 };
  assert.equal(detectFinds(view([off]), st, deepOf(st), P)[0].gaia, null);
});

test('speed: a 2 px shift over one year on a 6.15" grid is 12.3"/yr', () => {
  const st = stacksWith([[14, 15], [16, 15]], [2, 2]);
  const f = detectFinds(view([], [60800, 61165.25]), st, deepOf(st), P);
  assert.ok(Math.abs(f[0].arcsecPerYr - 12.3) < 1.0);
});

test('fewer than two stacks gives no finds; exactly two works', () => {
  const st = stacksWith([[14, 15], [16, 15]], [2, 2]);
  assert.deepEqual(detectFinds(view([], [60800]), [st[0]], st[0], P), []);
  assert.equal(detectFinds(view([], [60800, 61000]), st, deepOf(st), P).length, 1);
});

test('a static, steady source gives no finds', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [2, 2, 2]);
  assert.deepEqual(detectFinds(view(), st, deepOf(st), P), []);
});

// ---- Added after the real-data check (flagged in the completion report) ----

import { saturationMask } from '../../frontend/js/detect.js';

test('per-window noise: a dip in a 5x noisier window is not called variable', () => {
  const st = [
    addSource(noisePlane(40, 0.05), 15, 15, 0.6),
    addSource(noisePlane(41), 15, 15, 1),
    addSource(noisePlane(42), 15, 15, 1),
  ];
  assert.equal(detectFinds(view(), st, deepOf(st), P).filter((x) => x.kind === 'variable').length, 0);
});

test('saturationMask marks pixels whose variance is huge in at least half the images', () => {
  const vars = [0, 1, 2, 3].map((k) => {
    const v = new Float32Array(P * P).fill(1e-4);
    if (k < 2) v[15 * P + 15] = 1;
    return v;
  });
  const mask = saturationMask(vars, P);
  assert.equal(mask[15 * P + 15], 1);
  assert.equal(mask[0], 0);
});

test('finds inside a saturated star halo are dropped, the star itself is kept', () => {
  const st = stacksWith([[8, 15], [10, 15], [12, 15]], [2, 2, 2]); // a "mover" 3-7 px from the star
  st.forEach((p) => addSource(p, 15, 15, 50));
  const mask = new Uint8Array(P * P);
  mask[15 * P + 15] = 1;
  const f = detectFinds(view(), st, deepOf(st), P, { saturated: mask });
  assert.equal(f.filter((x) => !x.saturated).length, 0);
});

test('a mover matched to a Gaia star that does not move is labelled not-in-Gaia', () => {
  const st = stacksWith([[14, 15], [15, 15], [16, 15]], [2, 2, 2]);
  const still = { source_id: 'S', ra: 100, dec: 0, pmra: 0, pmdec: 0 };
  const f = detectFinds(view([still]), st, deepOf(st), P);
  assert.equal(f[0].kind, 'moving');
  assert.equal(f[0].gaia, null);
});

test('two peaks of one object within 2 px give a single find', () => {
  const st = [1, 1.5, 2].map((k, i) => addSource(addSource(noisePlane(50 + i), 14, 15, k), 17, 15, k));
  const f = detectFinds(view(), st, deepOf(st), P);
  const close = f.filter((a) => f.some((b) => a !== b && Math.hypot(a.x - b.x, a.y - b.y) < 2));
  assert.equal(close.length, 0);
});

test('a 1.3 px shift measured against a noisier first window is still a mover', () => {
  const st = [
    addSource(noisePlane(60, 0.045), 14.35, 15, 1.2),
    addSource(noisePlane(61), 15.1, 15, 1.2),
    addSource(noisePlane(62), 15.65, 15, 1.2),
  ];
  const f = detectFinds(view(), st, deepOf(st), P);
  assert.equal(f.length, 1);
  assert.equal(f[0].kind, 'moving');
});

test('noise alone in a faint, noisy window does not fake a mover', () => {
  const st = [0, 1, 2].map((i) => addSource(noisePlane(70 + i, i ? 0.01 : 0.03), 15, 15, 0.8));
  assert.equal(detectFinds(view(), st, deepOf(st), P).filter((x) => x.kind === 'moving').length, 0);
});

const withUm = (ums) => {
  const v = view();
  return { ...v, stacks: v.stacks.map((st, i) => ({ ...st, um_mean: ums[i] })) };
};

test('wavelengthsMatch: 5.5% apart is not a match; 0.4% and 1.8% are', () => {
  assert.equal(wavelengthsMatch(withUm([4.944, 4.688, 4.718]), 0, 1), false);
  assert.equal(wavelengthsMatch(withUm([1.989, 1.997, 1.992]), 0, 1), true);
  assert.equal(wavelengthsMatch(withUm([1.903, 1.937, 1.927]), 0, 1), true);
});

test('wavelengthsMatch: the 3% edge matches, just over does not', () => {
  assert.equal(wavelengthsMatch(withUm([2, 2.06, 2]), 0, 1), true);
  assert.equal(wavelengthsMatch(withUm([2, 2.0601, 2]), 0, 1), false);
});

test('wavelengthsMatch: a missing or non-numeric wavelength counts as a match', () => {
  assert.equal(wavelengthsMatch(view(), 0, 1), true);
  assert.equal(wavelengthsMatch(withUm([undefined, 2, 2]), 0, 1), true);
  assert.equal(wavelengthsMatch(withUm(['x', 2, 2]), 0, 1), true);
});

test('a doubling source is marked colour-mismatched only when its windows differ in wavelength', () => {
  const st = stacksWith([[15, 15], [15, 15], [15, 15]], [1, 1.5, 2]);
  const bad = detectFinds(withUm([4.944, 4.688, 4.718]), st, deepOf(st), P)[0];
  assert.equal(bad.kind, 'variable');
  assert.equal(bad.colourMismatch, true);
  assert.equal(detectFinds(withUm([1.989, 1.997, 1.992]), st, deepOf(st), P)[0].colourMismatch, false);
  assert.equal(detectFinds(view(), st, deepOf(st), P)[0].colourMismatch, false);
});

test('a mover on a still Gaia star keeps no Gaia match but is flagged stillGaia', () => {
  const st = stacksWith([[14, 15], [15, 15], [16, 15]], [2, 2, 2]);
  const still = { source_id: 'S', ra: 100, dec: 0, pmra: 0, pmdec: 0 };
  const f = detectFinds(view([still]), st, deepOf(st), P)[0];
  assert.equal(f.gaia, null);
  assert.equal(f.stillGaia, true);
});

test('stillGaia is false for a mover on a fast Gaia star and for a mover with no Gaia star', () => {
  const st = stacksWith([[14, 15], [15, 15], [16, 15]], [2, 2, 2]);
  const yrs = (60983 - 57388.5) / 365.25;
  const on = { source_id: 'X', ra: 100, dec: -(1000 * yrs) / 3.6e6, pmra: 0, pmdec: 1000 };
  assert.equal(detectFinds(view([on]), st, deepOf(st), P)[0].stillGaia, false);
  assert.equal(detectFinds(view([]), st, deepOf(st), P)[0].stillGaia, false);
});
