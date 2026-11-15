import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { distanceLy, distanceSummary, distanceText, rulerPosition } from '../../frontend/js/distances.js';

const manifest = (hash, det) => JSON.parse(readFileSync(new URL(`../../public/data/${hash}-${det}/manifest.json`, import.meta.url)));

test('distances only from well-measured parallaxes', () => {
  assert.ok(Math.abs(distanceLy({ parallax: 546.98, parallax_over_error: 2000 }) - 5.96) < 0.01);
  assert.equal(distanceLy({ parallax: 0.3, parallax_over_error: 1.2 }), null);
  assert.equal(distanceLy({ parallax: -0.2, parallax_over_error: 9 }), null);
  assert.equal(distanceLy({ parallax: null }), null);
  assert.equal(rulerPosition(1), 0);
  assert.equal(rulerPosition(1e5), 1);
});

test("Barnard's field: the nearest star is Barnard's (6 ly) and it is the mover", () => {
  const s = distanceSummary(manifest('768d33c99b4c', 'D2'));
  assert.ok(Math.abs(s.nearest.ly - 5.96) < 0.05);
  assert.ok(s.nearest.moves);
  assert.match(distanceText(s), /nearest is 6\.0 light-years/);
});

test('Epsilon Indi B (12 ly) is the nearest in its field', () => {
  const s = distanceSummary(manifest('85387de0fcfc', 'D6'));
  assert.ok(s.nearest.ly > 11 && s.nearest.ly < 13);
});
