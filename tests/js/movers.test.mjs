import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motionSummary, motionText, yearsText, watchSpan } from '../../frontend/js/movers.js';
import { THEN_TARGETS } from '../../frontend/js/thennow.js';

const manifest = (hash, det) => JSON.parse(readFileSync(new URL(`../../featured/${hash}/${det}/manifest.json`, import.meta.url)));

test('RW Aurigae: nothing moves; ~190 years per pixel', () => {
  const s = motionSummary(manifest('e5f4784477c4', 'D3'));
  assert.equal(s.kind, 'still');
  assert.ok(s.yearsPerPixel > 150 && s.yearsPerPixel < 250, String(s.yearsPerPixel));
  assert.ok(s.counted < 251, 'only stars inside the square are counted');
  assert.match(motionText(s).body, /years to move one SPHEREx pixel/);
});

test("Barnard's Star field: a mover of ~1.7 px a year", () => {
  const s = motionSummary(manifest('768d33c99b4c', 'D2'));
  assert.equal(s.kind, 'mover');
  assert.ok(s.pxPerYear > 1.6 && s.pxPerYear < 1.8);
  assert.match(motionText(s).body, /brightest/); // 400-star list is capped
});

test('WISE 0855 is not in Gaia: its published motion makes it the mover', () => {
  const view = manifest('e01445dc3f16', 'D6');
  assert.equal(motionSummary(view).kind, 'still');
  const s = motionSummary(view, [THEN_TARGETS.e01445dc3f16.star]);
  assert.equal(s.kind, 'mover');
  assert.ok(s.published);
});

test('stars with unknown motion are never the "fastest"', () => {
  const view = { grid: { npix: 59, scale_arcsec: 6.15 }, ra: 10, dec: 0, visits: [{ mjd: 60800 }, { mjd: 61165 }],
    stars: [{ ra: 10, dec: 0, pmra: null, pmdec: null }, { ra: 10.001, dec: 0, pmra: 1, pmdec: 1 }] };
  const s = motionSummary(view);
  assert.equal(s.star.pmra, 1);
  assert.equal(s.counted, 1);
});

test('years text rounds for people', () => {
  assert.equal(yearsText(192.3), 'about 190 years');
  assert.equal(yearsText(3.2), 'about 3 years');
  assert.equal(yearsText(0.5), 'about 6 months');
  assert.equal(yearsText(1234567), 'about 1,200,000 years');
  assert.equal(watchSpan({ visits: [{ mjd: 1 }] }), null);
});
