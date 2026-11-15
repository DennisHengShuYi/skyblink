import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchByDate, stretchByte, colourPixels, COLOUR_DETS, windowNotes, colourNote, loadColour } from '../../frontend/js/colour.js';

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

// Added after the browser check (flagged in the report): balanced per-channel scales.
import { channelStretch } from '../../frontend/js/colour.js';

test('channelStretch balances bands: the same relative signal gives the same byte', () => {
  const field = (scale) => {
    const p = new Float32Array(400);
    for (let i = 0; i < p.length; i += 1) p[i] = ((i * 7919) % 101 - 50) / 5000 * scale; // ±0.01·scale noise
    for (let i = 0; i < 6; i += 1) p[50 * i + 25] = 2 * scale; // a few stars
    p[210] = 0.3 * scale; // a faint source
    return p;
  };
  const a = field(1);
  const b = field(5);
  const sa = channelStretch(a);
  const sb = channelStretch(b);
  assert.equal(stretchByte(a[210], sa), stretchByte(b[210], sb));
  assert.ok(stretchByte(0, sa) < 60, 'sky stays dark');
  assert.ok(stretchByte(a[25], sa) > 230, 'bright stars near white');
});

const ALL = { r: [0, 1, 2], g: [0, 1, 2], b: [0, 1, 2] };

test('windowNotes: a window with no match in one channel is unmatched', () => {
  const n = windowNotes({ matched: { ...ALL, g: [0, null, 2] }, sigmas: [1, 1, 1] });
  assert.deepEqual(n.unmatched, [1]);
  assert.deepEqual(n.noisy, []);
});

test('windowNotes: a window much noisier than the median is noisy', () => {
  assert.deepEqual(windowNotes({ matched: ALL, sigmas: [0.03, 0.01, 0.011] }).noisy, [0]);
});

test('windowNotes: equal noise, or only two windows, flags nothing', () => {
  assert.deepEqual(windowNotes({ matched: ALL, sigmas: [0.01, 0.01, 0.01] }).noisy, []);
  const two = { r: [0, 1], g: [0, 1], b: [0, 1] };
  assert.deepEqual(windowNotes({ matched: two, sigmas: [0.05, 0.01] }).noisy, []);
});

test('colourNote words each case, and is null when there is nothing to say', () => {
  assert.match(colourNote({ unmatched: [1], noisy: [] }), /Window 2 had no matching picture in every band, so it shows the deep stack\./);
  assert.match(colourNote({ unmatched: [], noisy: [0] }), /Window 1 is noisier than the others\./);
  const both = colourNote({ unmatched: [1], noisy: [0] });
  assert.match(both, /Window 2/);
  assert.match(both, /Window 1 is noisier/);
  assert.equal(colourNote({ unmatched: [], noisy: [] }), null);
});

test('loadColour names a detector whose view fails instead of throwing', async () => {
  const ok = Promise.resolve({ key: 'x', stacks: [] });
  const bad = Promise.reject(new Error('nope'));
  bad.catch(() => {});
  const r = await loadColour({ stacks: [] }, [
    { det: 'D1', view: ok }, { det: 'D3', view: ok }, { det: 'D6', view: bad },
  ]);
  assert.ok(r.missing.includes('D6'));
});
