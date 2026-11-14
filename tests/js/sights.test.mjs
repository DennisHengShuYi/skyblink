import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGHTS } from '../../frontend/js/sights.js';

test('ten popular sights with valid positions, bands, fields and teasers', () => {
  assert.equal(SIGHTS.length, 10);
  assert.equal(new Set(SIGHTS.map((s) => s.slug)).size, 10);
  assert.equal(new Set(SIGHTS.map((s) => s.name)).size, 10);
  SIGHTS.forEach((s) => {
    assert.ok(s.ra >= 0 && s.ra < 360, s.name);
    assert.ok(s.dec >= -90 && s.dec <= 90, s.name);
    assert.match(s.det, /^D[1-6]$/);
    assert.equal(s.fov, 0.1);
    assert.ok(s.teaser.length >= 10 && s.teaser.length <= 90, `${s.name}: ${s.teaser.length}`);
  });
});
