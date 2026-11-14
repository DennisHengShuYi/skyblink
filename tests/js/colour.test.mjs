import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchByDate, stretchByte, colourPixels, COLOUR_DETS } from '../../frontend/js/colour.js';

test('D1 blue, D3 green, D6 red', () => {
  assert.deepEqual(COLOUR_DETS, { r: 'D6', g: 'D3', b: 'D1' });
});

test('matchByDate pairs nearby dates and leaves far ones unmatched', () => {
  assert.deepEqual(matchByDate([100, 280, 460], [105, 300, 900]), [0, 1, null]);
});

test('matchByDate with an empty list or a single window', () => {
  assert.deepEqual(matchByDate([100, 200], []), [null, null]);
  assert.deepEqual(matchByDate([100], []), [null]);
  assert.deepEqual(matchByDate([100], [130]), [0]);
});

/** The backend formula (imaging.to_uint8), written out independently. */
function py(v, { lo, hi, soft }) {
  const f = Number.isFinite(v) ? v : 0;
  const x = Math.min(1, Math.max(0, (f - lo) / (hi - lo)));
  return Math.round((Math.asinh(x / soft) / Math.asinh(1 / soft)) * 255);
}

test('stretchByte matches the server curve at both ends, the middle and for NaN', () => {
  const s = { lo: -0.02, hi: 1.0, soft: 0.01 };
  assert.equal(stretchByte(s.lo, s), 0);
  assert.equal(stretchByte(s.hi, s), 255);
  [0, 0.05, 0.3].forEach((v) => assert.equal(stretchByte(v, s), py(v, s)));
  assert.equal(stretchByte(NaN, s), stretchByte(0, s));
});

test('colourPixels: D6-only signal is red only, D1-only is blue only, alpha always 255', () => {
  const zero = new Float32Array(4);
  const sig = new Float32Array([0, 1, 0, 0]);
  const s = { lo: 0, hi: 1, soft: 0.1 };
  const st = { r: s, g: s, b: s };
  const red = colourPixels({ r: sig, g: zero, b: zero }, st, 2);
  assert.deepEqual([...red.slice(4, 8)], [255, 0, 0, 255]);
  const blue = colourPixels({ r: zero, g: zero, b: sig }, st, 2);
  assert.deepEqual([...blue.slice(4, 8)], [0, 0, 255, 255]);
  for (let i = 3; i < red.length; i += 4) assert.equal(red[i], 255);
});

test('colourPixels: a masked pixel in one channel does not blank the others', () => {
  const s = { lo: 0, hi: 1, soft: 0.1 };
  const px = colourPixels({ r: new Float32Array([NaN]), g: new Float32Array([1]), b: new Float32Array([1]) }, { r: s, g: s, b: s }, 1);
  assert.equal(px[1], 255);
  assert.equal(px[2], 255);
});
