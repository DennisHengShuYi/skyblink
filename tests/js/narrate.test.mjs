import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPeaks, clockPosition, describeObjects, describeView } from '../../frontend/js/narrate.js';

function f16(h) {
  const s = h & 0x8000 ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}
function deepOf(hash, det) {
  const dir = new URL(`../../public/data/${hash}-${det}/`, import.meta.url);
  const view = JSON.parse(readFileSync(new URL('manifest.json', dir)));
  const buf = readFileSync(new URL('cube.bin', dir));
  const P = view.grid.npix; const N = view.cube.n_visits; const W = view.cube.n_stacks;
  const k = 3 * N + W;
  return { view, plane: Float32Array.from({ length: P * P }, (_, i) => f16(buf.readUInt16LE((k * P * P + i) * 2))) };
}

test('clock positions: north is 12, west (right) is 3', () => {
  assert.equal(clockPosition(29, 29, 59), 'in the middle');
  assert.match(clockPosition(29, 2, 59), /^12 o'clock, near the edge/);
  assert.match(clockPosition(56, 29, 59), /^3 o'clock/);
  assert.match(clockPosition(2, 29, 59), /^9 o'clock/);
});

test("Barnard's field: the brightest object is in the middle, matched to Barnard's Star, and moves", () => {
  const { view, plane } = deepOf('768d33c99b4c', 'D2');
  const objs = describeObjects(view, plane);
  assert.ok(objs.length > 3 && objs.length <= 20);
  assert.ok(Math.hypot(objs[0].x - 29, objs[0].y - 29) < 3);
  assert.match(objs[0].motion, /should move about 1\.\d pixels/);
  assert.match(describeView(view, objs), /North is up and east is left/);
});

test('peaks on flat noise: none', () => {
  const P = 20; const plane = new Float32Array(P * P).map((_, i) => (i % 7) * 0.01);
  assert.equal(findPeaks(plane, P).length, 0);
});

test('picture health: flags and noise give plain verdicts', async () => {
  const { visitHealth, healthLabel, planeStats } = await import('../../frontend/js/health.js');
  const visits = [{ flag_frac: 0.02 }, { flag_frac: 0.15 }, { flag_frac: 0.5 }, { flag_frac: 0.01 }];
  const quiet = planeStats(Float32Array.from({ length: 400 }, (_, i) => ((i * 7919) % 13) / 13));
  const loud = planeStats(Float32Array.from({ length: 400 }, (_, i) => (((i * 7919) % 13) / 13) * 6));
  const h = visitHealth(visits, [quiet, quiet, quiet, loud]);
  assert.deepEqual(h.map((x) => x.level), ['ok', 'care', 'poor', 'poor']);
  assert.match(h[3].reasons[0], /noisier/);
  assert.equal(healthLabel(h[0]), '');
  assert.match(healthLabel(h[1]), /care/);
  assert.equal(visitHealth([{ flag_frac: 0.5 }])[0].level, 'poor'); // works before the cube loads
});
