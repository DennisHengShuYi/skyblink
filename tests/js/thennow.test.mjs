import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thenTargetFor, moverFor, thenNowGeometry, deepEpoch, badgeText, MIN_SHIFT_PX } from '../../frontend/js/thennow.js';

const manifest = (hash, det) => JSON.parse(readFileSync(new URL(`../../featured/${hash}/${det}/manifest.json`, import.meta.url)));

function geometry(hash, det) {
  const view = manifest(hash, det);
  const target = thenTargetFor(view);
  const star = moverFor(view, target);
  return { view, target, g: thenNowGeometry(view, star, target.mjd, deepEpoch(view)) };
}

test("Barnard's Star jumps ~26 px since WISE 2010, inside the frame", () => {
  const { g } = geometry('768d33c99b4c', 'D2');
  assert.ok(g.shiftPx > 24 && g.shiftPx < 28, String(g.shiftPx));
  assert.ok(g.inside);
  assert.ok(g.then.y > g.now.y + 20); // it was south (row increases southward) and moved north
  assert.match(badgeText(g), /^\+1[56] years: 2\.\d′ = 2\d SPHEREx pixels$/);
});

test('WISE 0855 was ~20 px east (left) in 2010; now sits on the crosshair', () => {
  const { view, g } = geometry('e01445dc3f16', 'D6');
  const c = (view.grid.npix - 1) / 2;
  assert.ok(Math.hypot(g.now.x - c, g.now.y - c) < 0.6, 'now ring on the crosshair');
  assert.ok(g.then.x < g.now.x - 18, 'east = left');
});

test('Epsilon Indi B: 2MASS 1999 position ~20 px away, inside the frame', () => {
  const { g } = geometry('85387de0fcfc', 'D6');
  assert.ok(g.shiftPx > 18 && g.shiftPx < 23, String(g.shiftPx));
  assert.ok(g.inside);
  assert.ok(g.shiftPx >= MIN_SHIFT_PX);
});

test('variable stars get no Then & Now', () => {
  assert.equal(thenTargetFor(manifest('e5f4784477c4', 'D3')), null);
  assert.equal(thenTargetFor(manifest('17e794349944', 'D3')), null);
  assert.equal(thenTargetFor(null), null);
});
