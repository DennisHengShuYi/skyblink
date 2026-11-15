import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNotes, describeSound, lightcurve, spectrumSeries, play, soundAction } from '../../frontend/js/sonify.js';

test('rising values make rising notes from 220 to 880 Hz', () => {
  const n = toNotes([1, 2, 3]);
  assert.equal(n.length, 3);
  assert.ok(n[0].freq < n[1].freq && n[1].freq < n[2].freq);
  assert.ok(Math.abs(n[0].freq - 220) < 0.01);
  assert.ok(Math.abs(n[2].freq - 880) < 0.01);
});

test('equal values all play the middle note (~440 Hz)', () => {
  toNotes([5, 5]).forEach((x) => assert.ok(Math.abs(x.freq - 440) < 0.01));
});

test('masked values are skipped; all masked → no notes', () => {
  assert.equal(toNotes([1, NaN, 3]).length, 2);
  assert.deepEqual(toNotes([NaN, NaN]), []);
});

test('notes are evenly spaced in time', () => {
  const n = toNotes([1, 2, 3, 4]);
  const gaps = n.slice(1).map((x, i) => x.start - n[i].start);
  gaps.forEach((g) => assert.ok(Math.abs(g - gaps[0]) < 1e-9));
});

test('descriptions: rises, falls, stays steady, wobbles', () => {
  assert.equal(describeSound([1, 2, 3, 4]), 'rises');
  assert.equal(describeSound([4, 3, 2, 1]), 'falls');
  assert.equal(describeSound([1, 1.02, 0.99]), 'stays steady');
  assert.equal(describeSound([1, 3, 1, 3, 1]), 'wobbles up and down');
});

test('lightcurve: one value per stack, 3x3 mean, NaN ignored', () => {
  const P = 3;
  const plane = (v) => new Float32Array(9).fill(v);
  const s1 = plane(2);
  s1[0] = NaN;
  const cube = { P, W: 2, stack: (w) => [plane(1), s1][w] };
  assert.deepEqual(lightcurve(cube, {}, 1, 1), [1, 2]);
});

test('spectrumSeries sorts by wavelength and keeps at most 24 values', () => {
  const pts = Array.from({ length: 100 }, (_, i) => ({ um: 5 - i * 0.04, flux: i }));
  const s = spectrumSeries(pts);
  assert.ok(s.length <= 24);
  assert.ok(s[0] > s[s.length - 1]); // shortest wavelength (largest i) first
});

test('play returns null when audio is unavailable', () => {
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  assert.equal(play(toNotes([1, 2])), null);
  if (saved) globalThis.AudioContext = saved;
});

test('soundAction: start when silent, toggle off from the same button, switch from another', () => {
  const a = {};
  const b = {};
  assert.equal(soundAction(null, a), 'start');
  assert.equal(soundAction({ textEl: a }, a), 'toggle-off');
  assert.equal(soundAction({ textEl: a }, b), 'switch');
});
