import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapToStar, motionBetween, resultText, MEASURE_PAIRS } from '../../frontend/js/measure.js';
import { project, propagate } from '../../frontend/js/gaia.js';
import { THEN_TARGETS } from '../../frontend/js/thennow.js';

function f16(h) {
  const s = h & 0x8000 ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}
function load(key) {
  const [hash, det] = key.split('-');
  const dir = new URL(`../../featured/${hash}/${det}/`, import.meta.url);
  const view = JSON.parse(readFileSync(new URL('manifest.json', dir)));
  const buf = readFileSync(new URL('cube.bin', dir));
  const P = view.grid.npix; const N = view.cube.n_visits;
  const plane = (k) => Float32Array.from({ length: P * P }, (_, i) => f16(buf.readUInt16LE((k * P * P + i) * 2)));
  return { view, P, stack: (w) => plane(3 * N + view.stacks.findIndex((s) => s.window === w)) };
}

for (const [key, pair] of Object.entries(MEASURE_PAIRS)) {
  test(`measure it: ${pair.name} (${key}) agrees with ${pair.reference.by}`, () => {
    const { view, P, stack } = load(key);
    const sa = view.stacks.find((s) => s.window === pair.a);
    const sb = view.stacks.find((s) => s.window === pair.b);
    const star = THEN_TARGETS[key.split('-')[0]].star
      || view.stars.reduce((x, y) => (Math.hypot(y.pmra || 0, y.pmdec || 0) > Math.hypot(x.pmra || 0, x.pmdec || 0) ? y : x));
    // A visitor taps roughly (1 px off) where the star is in each window.
    const tapAt = (mjd) => { const p = propagate(star, mjd); const g = project(p.ra, p.dec, view); return { x: g.x + 0.8, y: g.y - 0.6 }; };
    const ta = tapAt(sa.mjd); const tb = tapAt(sb.mjd);
    const a = snapToStar(stack(pair.a), P, ta.x, ta.y);
    const b = snapToStar(stack(pair.b), P, tb.x, tb.y);
    assert.ok(a && b, 'snapped');
    const m = motionBetween(a, b, sa.mjd, sb.mjd, view.grid.scale_arcsec);
    const r = resultText(m, pair);
    assert.ok(m.arcsecPerYear > pair.reference.pm * 0.7 && m.arcsecPerYear < pair.reference.pm * 1.15,
      `${m.arcsecPerYear.toFixed(2)} vs ${pair.reference.pm}`);
    assert.ok(Math.abs(sb.mjd - sa.mjd) > 300, 'same-season pair, about a year apart');
    assert.match(r.sums, /6\.15″ per pixel/);
    console.log(key, m.arcsecPerYear.toFixed(2), '±', m.errArcsecPerYear.toFixed(2), r.agrees);
  });
}
