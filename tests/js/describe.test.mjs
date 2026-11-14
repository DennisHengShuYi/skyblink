import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starType, distanceText, speedText, spectrumWords, NOT_IN_GAIA } from '../../frontend/js/describe.js';

const noNaN = (o) => assert.ok(!JSON.stringify(o).includes('NaN'), `NaN in ${JSON.stringify(o)}`);

test('star type: Barnard\'s Star is a red dwarf', () => {
  assert.match(starType({ gmag: 8.19, bp_rp: 2.83, parallax: 546.98 }).label, /Red dwarf/);
});

test('star type: very blue → hot blue star', () => {
  assert.equal(starType({ gmag: 15, bp_rp: 0.1, parallax: 1 }).label, 'Hot blue star');
});

test('star type: faint, blue-ish and nearby → white dwarf', () => {
  assert.equal(starType({ gmag: 15, bp_rp: 0.5, parallax: 100 }).label, 'White dwarf');
});

test('star type: bright, red and distant → red giant', () => {
  assert.equal(starType({ gmag: 6, bp_rp: 1.6, parallax: 2 }).label, 'Red giant');
});

test('star type: medium colour → sun-like; orange → K-type', () => {
  assert.equal(starType({ gmag: 10, bp_rp: 0.8, parallax: 5 }).label, 'Sun-like star');
  assert.equal(starType({ gmag: 10, bp_rp: 1.3, parallax: 5 }).label, 'Orange (K-type) star');
});

test('star type: no colour → null', () => {
  assert.equal(starType({ gmag: 10, bp_rp: null, parallax: 5 }), null);
});

test('star type: missing, zero or negative parallax → colour-only type, never NaN', () => {
  [null, 0, -2].forEach((parallax) => {
    const t = starType({ gmag: 15, bp_rp: 1.2, parallax });
    assert.equal(t.label, 'Orange (K-type) star');
    noNaN(t);
  });
});

test('distance: Barnard\'s parallax → about 6.0 light-years, left around 2020', () => {
  const d = distanceText(546.98);
  assert.match(d, /About 6\.0 light-years away/);
  assert.match(d, /left it around 2020/);
});

test('distance: parallax 1 mas → ~3,300 light-years, no year', () => {
  const d = distanceText(1);
  assert.match(d, /3,300 light-years/);
  assert.doesNotMatch(d, /left it around/);
});

test('distance: missing, negative or tiny parallax → null', () => {
  [null, undefined, -1, 0.1].forEach((p) => assert.equal(distanceText(p), null));
});

test('speed: Barnard → 10.39″ a year, Moon crossing and km/s', () => {
  const s = speedText({ pmra: -801.55, pmdec: 10362.39, parallax: 546.98 });
  assert.match(s, /10\.39″ a year/);
  assert.match(s, /full Moon's width in about 179 years/);
  assert.match(s, /km\/s/);
});

test('speed: no parallax → no km/s; almost no motion → null', () => {
  assert.doesNotMatch(speedText({ pmra: -801.55, pmdec: 10362.39, parallax: null }), /km\/s/);
  assert.equal(speedText({ pmra: 5, pmdec: 5, parallax: 10 }), null);
});

const pts = (shortFlux, longFlux) => [
  ...[0.8, 1.0, 1.2, 1.4].map((um) => ({ um, flux: shortFlux })),
  ...[3.8, 4.2, 4.6, 4.9].map((um) => ({ um, flux: longFlux })),
];

test('spectrum words: cool, hot, similar', () => {
  assert.match(spectrumWords(pts(1, 3)), /cool/);
  assert.match(spectrumWords(pts(3, 1)), /hot/);
  assert.match(spectrumWords(pts(1, 1.2)), /Similar brightness/);
});

test('spectrum words: too few points on one side → null; NaN ignored', () => {
  assert.equal(spectrumWords([{ um: 1, flux: 1 }, { um: 4, flux: 2 }]), null);
  const withNaN = [...pts(1, 3), { um: 4.0, flux: NaN }, { um: 1.1, flux: NaN }];
  assert.match(spectrumWords(withNaN), /cool/);
});

test('not-in-Gaia text mentions brown dwarfs', () => {
  assert.match(NOT_IN_GAIA, /Brown dwarfs/);
});
