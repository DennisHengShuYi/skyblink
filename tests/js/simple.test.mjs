import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveLevel, plainTitle } from '../../frontend/js/simple.js';

test('level: URL, then remembered, then simple', () => {
  assert.equal(resolveLevel('full', 'simple'), 'full');
  assert.equal(resolveLevel(null, 'full'), 'full');
  assert.equal(resolveLevel('junk', 'junk'), 'simple');
});

test('plain frame titles', () => {
  const v = JSON.parse(readFileSync(new URL('../../public/data/e01445dc3f16-D6/manifest.json', import.meta.url)));
  assert.equal(plainTitle(v.stacks[1], 'stack', v, 1, 3), 'Look 2 of 3 · Nov–Dec 2025 · 21 photos combined');
  assert.match(plainTitle(v.visits[0], 'visits', v, 0, v.visits.length), /^Photo 1 of \d+ · \d+ May 2025$/);
});
