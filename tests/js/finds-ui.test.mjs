import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFind } from '../../frontend/js/finds-text.js';

const view = { stacks: [{ window: 0, date: '2025-11-16' }, { window: 1, date: '2026-04-27' }] };
const mover = (arcsecPerYr, gaia) => ({ kind: 'moving', arcsecPerYr, gaia, from: 0, to: 1 });

test('a fast Gaia mover reads "Known star, moving 10.4″ a year" and says fastest', () => {
  const d = describeFind(mover(10.4, { source_id: 'B' }), view);
  assert.match(d.title, /^Known star, moving 10\.4″ a year/);
  assert.match(d.body, /fastest/);
});

test('a slow Gaia mover does not say fastest', () => {
  assert.doesNotMatch(describeFind(mover(0.2, { source_id: 'S' }), view).body, /fastest/);
});

test('a mover not in Gaia is a candidate, never a discovery', () => {
  const d = describeFind(mover(8, null), view);
  assert.match(d.title, /Moved — not in Gaia's catalogue/);
  assert.match(d.body, /candidate/);
  assert.doesNotMatch(`${d.title} ${d.body}`, /discover/i);
});

test('variables read brighter/fainter with both survey dates', () => {
  const up = describeFind({ kind: 'variable', fluxChange: 0.45, from: 0, to: 1 }, view);
  assert.equal(up.title, 'Got 45% brighter');
  assert.match(up.body, /2025-11-16/);
  assert.match(up.body, /2026-04-27/);
  const down = describeFind({ kind: 'variable', fluxChange: -0.3, from: 0, to: 1 }, view);
  assert.equal(down.title, 'Got 30% fainter');
});

test('a saturated variable says the change is estimated from its glow', () => {
  const d = describeFind({ kind: 'variable', fluxChange: -0.69, from: 0, to: 1, saturated: true }, view);
  assert.match(d.body, /glow/);
});

// Added in the final-review fix pass.
import { revealTabFor } from '../../frontend/js/finds-text.js';

test('clicking reveals the Finds tab only from Frame info / Finds, never from Spectrum, Light curve or Atlas', () => {
  assert.equal(revealTabFor('tab-info'), 'tab-finds');
  assert.equal(revealTabFor('tab-finds'), 'tab-finds');
  assert.equal(revealTabFor(undefined), 'tab-finds');
  ['tab-spec', 'tab-lc', 'tab-atlas'].forEach((t) => assert.equal(revealTabFor(t), null));
});
