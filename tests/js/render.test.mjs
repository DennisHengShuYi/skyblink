import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stretchFn, STRETCH_KINDS, applyLevels, colormapLut, COLORMAPS, catmullRomUpscale,
  composeRGBA, colorbarTicks,
} from '../../frontend/js/render.js';

const S = { kind: 'asinh', lo: -0.02, hi: 72.7, soft: 0.0004, sigma: 0.0117 };

test('asinh stretch matches the backend to_uint8 formula', () => {
  const f = stretchFn(S, 'asinh');
  const v = 0.5;
  const x = (v - S.lo) / (S.hi - S.lo);
  const want = Math.asinh(x / S.soft) / Math.asinh(1 / S.soft);
  assert.ok(Math.abs(f(v) - want) < 1e-9);
});

test('every stretch kind maps lo to 0, hi to 1 and NaN to the sky level', () => {
  STRETCH_KINDS.forEach((kind) => {
    const f = stretchFn(S, kind);
    assert.equal(f(S.lo), 0, kind);
    assert.ok(Math.abs(f(S.hi) - 1) < 1e-9 || kind === 'faint', kind);
    assert.equal(f(NaN), f(0), kind);
    assert.ok(f(S.hi * 2) <= 1 && f(S.lo - 5) >= 0, kind);
  });
});

test('stretch kinds are monotonic', () => {
  STRETCH_KINDS.forEach((kind) => {
    const f = stretchFn(S, kind);
    let prev = -1;
    for (let v = S.lo; v <= S.hi; v += S.hi / 50) {
      assert.ok(f(v) >= prev, kind);
      prev = f(v);
    }
  });
});

test('faint stretch saturates at ~15 sigma above the black point', () => {
  const f = stretchFn(S, 'faint');
  assert.equal(f(S.lo + 15 * S.sigma), 1);
  assert.ok(f(S.lo + 5 * S.sigma) > 0.3);
});

test('missing soft/sigma (old manifests) fall back to safe defaults', () => {
  const f = stretchFn({ lo: 0, hi: 1 }, 'asinh');
  assert.ok(f(0.5) > 0.5 && f(0.5) < 1);
  assert.ok(Number.isFinite(stretchFn({ lo: 0, hi: 1 }, 'faint')(0.01)));
});

test('levels: identity at defaults, gain anchored at black, clamped to 1', () => {
  assert.equal(applyLevels(0.3, 1, 1), 0.3);
  assert.equal(applyLevels(0, 3, 1), 0);
  assert.equal(applyLevels(0.6, 2, 1), 1);
  assert.ok(applyLevels(0.25, 1, 2) < 0.25);
});

test('colormaps: 256 RGB entries, grey is the identity, all run dark to bright', () => {
  Object.keys(COLORMAPS).forEach((name) => {
    const lut = colormapLut(name);
    assert.equal(lut.length, 256 * 3);
    const lum = (i) => lut[i * 3] + lut[i * 3 + 1] + lut[i * 3 + 2];
    assert.ok(lum(255) > lum(0), name);
  });
  const g = colormapLut('grey');
  assert.deepEqual([g[128 * 3], g[128 * 3 + 1], g[128 * 3 + 2]], [128, 128, 128]);
  assert.equal(colormapLut('nope'), colormapLut('grey'));
});

test('catmull-rom upscale keeps a flat field flat and hits samples at pixel centres', () => {
  const flat = catmullRomUpscale(new Float32Array(9).fill(0.4), 3, 12);
  assert.equal(flat.length, 144);
  flat.forEach((v) => assert.ok(Math.abs(v - 0.4) < 1e-6));
  const src = Float32Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  const up = catmullRomUpscale(src, 3, 9); // scale 3: centre of source px (1,1) is out (4,4)
  assert.ok(Math.abs(up[4 * 9 + 4] - 1) < 1e-6);
  up.forEach((v) => assert.ok(v >= 0 && v <= 1)); // clamped, no ringing outside 0..1
});

test('composeRGBA writes opaque colour-mapped pixels', () => {
  const rgba = composeRGBA(Float32Array.from([0, 1]), colormapLut('grey'));
  assert.deepEqual([...rgba], [0, 0, 0, 255, 255, 255, 255, 255]);
});

test('colour bar ticks sit inside the bar in increasing order', () => {
  const ticks = colorbarTicks(S, 'asinh');
  assert.ok(ticks.length >= 3);
  ticks.forEach((t, i) => {
    assert.ok(t.pos >= 0 && t.pos <= 1);
    if (i) assert.ok(t.pos > ticks[i - 1].pos && t.value > ticks[i - 1].value);
  });
});

test('colour bar ticks are spread out (no overlapping labels) and include the sky level', () => {
  ['asinh', 'linear', 'log', 'sqrt', 'faint'].forEach((kind) => {
    const ticks = colorbarTicks(S, kind);
    assert.ok(ticks.length >= 2, kind);
    ticks.forEach((t, i) => { if (i) assert.ok(t.pos - ticks[i - 1].pos >= 0.15, `${kind} spacing`); });
  });
  assert.ok(colorbarTicks(S, 'asinh').some((t) => t.value === 0));
});
