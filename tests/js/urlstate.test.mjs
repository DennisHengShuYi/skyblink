import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUrlState, toQuery, DEFAULTS } from '../../frontend/js/urlstate.js';

test('defaults when the query is empty', () => {
  const s = readUrlState('');
  assert.equal(s.tool, 'animate');
  assert.equal(s.cmap, 'grey');
  assert.equal(s.stretch, 'asinh');
  assert.equal(s.frame, 0);
  assert.equal(s.px, null);
  assert.equal(s.stars, false);
  assert.equal(s.loop, 'loop');
  assert.equal(s.blinkHz, 1);
});

test('view settings round-trip through the query string', () => {
  const q = '?ra=133.75991&dec=-7.24225&fov=0.1&det=D6&mode=visits&fps=4&frame=7&tool=diff&a=0&b=2'
    + '&stars=1&gmax=15&minpm=100&flags=1&cmap=inferno&stretch=faint&bright=1.5&contrast=0.8&smooth=1'
    + '&px=10&py=20&ap=1&sort=wavelength&loop=bounce&blink=2&cross=corners';
  const s = readUrlState(q);
  assert.equal(s.frame, 7);
  assert.equal(s.tool, 'diff');
  assert.deepEqual([s.a, s.b], [0, 2]);
  assert.equal(s.cmap, 'inferno');
  assert.equal(s.gmax, 15);
  assert.equal(s.minPm, 100);
  assert.deepEqual([s.px, s.py, s.ap], [10, 20, 1]);
  const again = readUrlState(`?${toQuery(s)}`);
  ['frame', 'tool', 'a', 'b', 'stars', 'flags', 'gmax', 'minPm', 'cmap', 'stretch', 'bright', 'contrast',
    'smooth', 'px', 'py', 'ap', 'sort', 'loop', 'blinkHz', 'cross'].forEach((k) => assert.deepEqual(again[k], s[k], k));
});

test('invalid values fall back to defaults', () => {
  const s = readUrlState('?tool=evil&cmap=<x>&bright=99&blink=10&frame=-3&px=1.5&ap=9&loop=zz&stretch=no&cross=x');
  assert.equal(s.tool, 'animate');
  assert.equal(s.cmap, 'grey');
  assert.equal(s.bright, 4);       // clamped to the slider range
  assert.equal(s.blinkHz, 1);      // only 0.5, 1 or 2 Hz: never near the WCAG limit
  assert.equal(s.frame, 0);
  assert.equal(s.px, null);
  assert.equal(s.ap, 0);
  assert.equal(s.loop, 'loop');
  assert.equal(s.stretch, 'asinh');
  assert.equal(s.cross, 'cross');
});

test('default settings are left out of the share URL', () => {
  const q = toQuery({ ...readUrlState(''), ra: 1, dec: 2 });
  ['frame=', 'tool=', 'cmap=', 'stretch=', 'bright=', 'px=', 'loop=', 'blink='].forEach((k) => assert.ok(!q.includes(k), k));
  assert.equal(DEFAULTS.fov, 0.1);
});

test('playback speed is capped at 6 fps (never more than 3 flashes a second)', async () => {
  const { readUrlState, clampFps, FPS_MAX } = await import('../../frontend/js/urlstate.js');
  assert.equal(FPS_MAX, 6);
  assert.equal(clampFps(12), 6);
  assert.equal(readUrlState('?ra=1&dec=2&fps=12').fps, 6);
  assert.equal(readUrlState('?ra=1&dec=2&fps=3').fps, 3);
});
