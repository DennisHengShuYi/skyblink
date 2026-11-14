import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, filterStars, nearestStar } from '../../frontend/js/gaia.js';
import { levenshtein, suggestNames, addRecent } from '../../frontend/js/search.js';
import { toCsv } from '../../frontend/js/csv.js';

const view = { ra: 133.75991, dec: -7.24225, grid: { npix: 59, scale_arcsec: 6.15 } };

test('unproject inverts project (north up, east left)', () => {
  const p = project(133.7, -7.2, view);
  const s = unproject(p.x, p.y, view);
  assert.ok(Math.abs(s.ra - 133.7) < 1e-9 && Math.abs(s.dec + 7.2) < 1e-9);
  const c = unproject(29, 29, view);
  assert.ok(Math.abs(c.ra - view.ra) < 1e-9 && Math.abs(c.dec - view.dec) < 1e-9);
  assert.ok(unproject(29, 0, view).dec > view.dec);   // row 0 = north
  assert.ok(unproject(0, 29, view).ra > view.ra);     // column 0 = east
});

test('unproject wraps RA into 0..360', () => {
  const v0 = { ra: 0.001, dec: 0, grid: { npix: 59, scale_arcsec: 6.15 } };
  const s = unproject(58, 29, v0); // west of RA 0
  assert.ok(s.ra > 359 && s.ra < 360);
});

test('star filter keeps bright and fast stars', () => {
  const stars = [
    { gmag: 12, pmra: 0, pmdec: 5 },
    { gmag: 18.5, pmra: 0, pmdec: 5 },
    { gmag: 15, pmra: 300, pmdec: 400 },
    { pmra: 0, pmdec: 0 }, // no magnitude: kept unless filtered by motion
  ];
  assert.equal(filterStars(stars, { gmax: 16, minPm: 0 }).length, 3);
  assert.deepEqual(filterStars(stars, { gmax: 21, minPm: 100 }), [stars[2]]);
});

test('nearest star within the hover radius', () => {
  const geo = [{ star: { id: 'a' }, now: { x: 10, y: 10 } }, { star: { id: 'b' }, now: { x: 12, y: 10 } }];
  assert.equal(nearestStar(geo, 11.8, 10.1, 1.5).star.id, 'b');
  assert.equal(nearestStar(geo, 30, 30, 1.5), null);
});

test('levenshtein distance', () => {
  assert.equal(levenshtein('barnard', 'barnad'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('name suggestions ignore case and punctuation and rank by closeness', () => {
  const names = ["Barnard's Star", 'R Draconis', 'WISE 0855−0714'];
  assert.deepEqual(suggestNames('barnads star', names), ["Barnard's Star"]);
  assert.deepEqual(suggestNames('xyzzy plugh', names), []);
  assert.deepEqual(suggestNames('wise', names), ['WISE 0855−0714']); // prefix match
});

test('recent searches: newest first, no duplicates, capped', () => {
  let list = [];
  ['a', 'b', 'a', 'c'].forEach((q) => { list = addRecent(list, q, 2); });
  assert.deepEqual(list, ['c', 'a']);
  assert.deepEqual(addRecent(['x'], '  '), ['x']);
});

test('csv escapes quotes, commas and newlines', () => {
  const csv = toCsv(['a', 'b'], [[1, 'x,y'], ['say "hi"', null]]);
  assert.equal(csv, 'a,b\n1,"x,y"\n"say ""hi""",\n');
});
