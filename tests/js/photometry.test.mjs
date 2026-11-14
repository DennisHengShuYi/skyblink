import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apertureIndices, apertureMean, pixelSeries, stackVariance, deepVariance, snDifference,
  robustSigma, diffToRGBA, SATURATED_FACTOR,
} from '../../frontend/js/photometry.js';

/** Tiny in-memory cube with the same accessors as cube.js's Cube. */
function fakeCube(P, imgs, vars, ums) {
  const N = imgs.length;
  return {
    P, N, W: 1,
    img: (i) => Float32Array.from(imgs[i]),
    variance: (i) => Float32Array.from(vars[i]),
    um: (i) => Float32Array.from(ums[i]),
  };
}

test('aperture indices clip at the edges and are row-major', () => {
  assert.deepEqual(apertureIndices(3, 1, 1, 0), [4]);
  assert.equal(apertureIndices(3, 1, 1, 1).length, 9);
  assert.deepEqual(apertureIndices(3, 0, 0, 1), [0, 1, 3, 4]);
});

test('aperture mean ignores NaN and propagates variance', () => {
  const plane = Float32Array.from([1, 3, NaN, 5]);
  const vars = Float32Array.from([1, 1, 1, 1]);
  const { flux, err, n } = apertureMean(plane, vars, [0, 1, 2, 3]);
  assert.equal(n, 3);
  assert.equal(flux, 3);
  assert.ok(Math.abs(err - Math.sqrt(3) / 3) < 1e-9);
  assert.ok(Number.isNaN(apertureMean(Float32Array.from([NaN]), null, [0]).flux));
});

test('pixel series has one point per finite visit, with metadata and a saturation flag', () => {
  const P = 2;
  const cube = fakeCube(P,
    [[1, 1, 1, 1], [2, 2, 2, NaN], [3, 3, 3, 3]],
    [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, SATURATED_FACTOR * 10]],
    [[1.1, 1.1, 1.1, 1.1], [1.2, 1.2, 1.2, 1.2], [1.3, 1.3, 1.3, 1.3]]);
  const view = { det: 'D2', visits: [{ mjd: 10, window: 0 }, { mjd: 20, window: 0 }, { mjd: 30, window: 1 }] };
  const pts = pixelSeries(cube, view, 1, 1, 0);
  assert.equal(pts.length, 2); // visit 1 is NaN at (1,1)
  assert.deepEqual(pts.map((p) => p.mjd), [10, 30]);
  assert.equal(pts[0].det, 'D2');
  assert.equal(pts[0].um, Math.fround(1.1));
  assert.equal(pts[0].saturated, false);
  assert.equal(pts[1].saturated, true);
  assert.equal(pixelSeries(cube, view, 5, 5, 0).length, 0);
});

test('stack variance is the inverse-variance combination of the window visits', () => {
  const cube = fakeCube(1, [[0], [0], [0]], [[2], [2], [1]], [[1], [1], [1]]);
  const view = { visits: [{ window: 0 }, { window: 0 }, { window: 1 }] };
  assert.equal(stackVariance(cube, view, 0)[0], 1);
  assert.equal(stackVariance(cube, view, 1)[0], 1);
  assert.ok(Math.abs(deepVariance(cube)[0] - 0.5) < 1e-9);
});

test('S/N difference divides by the combined noise and keeps NaN', () => {
  const d = snDifference(Float32Array.from([1, NaN]), Float32Array.from([4, 1]),
    Float32Array.from([0.5, 1]), Float32Array.from([0.5, 1]));
  assert.equal(d[0], 3);
  assert.ok(Number.isNaN(d[1]));
});

test('robust sigma ignores outliers', () => {
  const v = Float32Array.from([1, -1, 1, -1, 0, 1000, -1000]); // median 0, MAD 1
  assert.ok(Math.abs(robustSigma(v) - 1.4826) < 1e-3);
});

test('difference colours: red when B brighter, blue when A brighter, grey for masked', () => {
  const rgba = diffToRGBA(Float32Array.from([12, -12, 0, NaN]), 12);
  assert.ok(rgba[0] > 200 && rgba[2] < 40);   // red
  assert.ok(rgba[6] > 200 && rgba[4] < 40);   // blue
  assert.ok(rgba[8] < 40 && rgba[10] < 40);   // dark for no change
  assert.deepEqual([...rgba.slice(12, 15)], [60, 60, 60]);
});
