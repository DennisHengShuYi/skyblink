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

test('a mover on a still Gaia star says the Gaia star does not move, and stays a candidate', () => {
  const d = describeFind({ ...mover(8, null), stillGaia: true }, view);
  assert.equal(d.title, "Moved, but the Gaia star here doesn't");
  assert.match(d.body, /candidate/);
  assert.doesNotMatch(`${d.title} ${d.body}`, /discover/i);
});

test('a variable between windows of different wavelength gives no percentage', () => {
  const d = describeFind({ kind: 'variable', fluxChange: 0.45, from: 0, to: 1, colourMismatch: true }, view);
  assert.equal(d.title, 'Looks different between 2025-11-16 and 2026-04-27');
  assert.match(d.body, /infrared colour/);
  assert.doesNotMatch(`${d.title} ${d.body}`, /%/);
});

// Added in the final-review fix pass.
import { revealTabFor, emptyFindsText } from '../../frontend/js/finds-text.js';

test('clicking reveals the Finds tab only from Frame info / Finds, never from Spectrum, Light curve or Atlas', () => {
  assert.equal(revealTabFor('tab-info'), 'tab-finds');
  assert.equal(revealTabFor('tab-finds'), 'tab-finds');
  assert.equal(revealTabFor(undefined), 'tab-finds');
  ['tab-spec', 'tab-lc', 'tab-atlas'].forEach((t) => assert.equal(revealTabFor(t), null));
});

test('empty finds text: one window says nothing can have changed yet; two windows say nothing moved', () => {
  assert.match(emptyFindsText({ stacks: [{ window: 0 }] }), /^Only one look at this spot so far/);
  assert.match(emptyFindsText({ stacks: [] }), /^Only one look at this spot so far/);
  assert.match(emptyFindsText({}), /^Only one look at this spot so far/);
  assert.equal(emptyFindsText(view), 'Nothing obviously moved or changed brightness here.');
});
