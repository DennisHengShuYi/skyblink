import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sunPosition, sideOnBaseline, parallaxJump, nextLook, bunchingText, nextLookIcs, dateToMjd, AU_PER_PC } from '../../frontend/js/skyclock.js';

const manifest = (hash, det) => JSON.parse(readFileSync(new URL(`../../public/data/${hash}-${det}/manifest.json`, import.meta.url)));
const DEG = 180 / Math.PI;

test('Sun longitude: ~0° at the March equinox, ~90° at the June solstice', () => {
  assert.ok(Math.abs(sunPosition(dateToMjd(new Date(Date.UTC(2026, 2, 20, 14)))).lambda * DEG) < 1 ||
    Math.abs(sunPosition(dateToMjd(new Date(Date.UTC(2026, 2, 20, 14)))).lambda * DEG - 360) < 1);
  assert.ok(Math.abs(sunPosition(dateToMjd(new Date(Date.UTC(2026, 5, 21, 8)))).lambda * DEG - 90) < 1);
});

test("Barnard's parallax: ~0.17 px Aug→Mar, ~0 Aug→Aug (as the checker found)", () => {
  const v = manifest('768d33c99b4c', 'D2');
  const [w0, w1, w2] = v.stacks;
  const pAU = AU_PER_PC * 1.83; // Barnard is 1.83 pc away
  const augMar = parallaxJump(v.ra, v.dec, w0.mjd, w1.mjd, pAU) / 6.15;
  const augAug = parallaxJump(v.ra, v.dec, w0.mjd, w2.mjd, pAU) / 6.15;
  assert.ok(augMar > 0.12 && augMar < 0.22, String(augMar));
  assert.ok(augAug < 0.03, String(augAug));
  assert.ok(sideOnBaseline(v.ra, v.dec, w0.mjd, w1.mjd).total > 1.7);
});

test('a Planet Nine at 500 AU would leave the picture between two half-year visits', () => {
  const v = manifest('768d33c99b4c', 'D2');
  const px = parallaxJump(v.ra, v.dec, v.stacks[0].mjd, v.stacks[1].mjd, 500) / 6.15;
  assert.ok(px > 29.5, String(px));
});

test('next look: a year after a past visit, after the latest picture', () => {
  const v = manifest('768d33c99b4c', 'D2'); // visits Aug 2025, Mar 2026, Aug 2026
  const look = nextLook(v, 61300);
  const d = new Date((look.mjd - 40587) * 86400000);
  assert.ok(look.mjd > 61305, 'after the latest picture');
  assert.ok([1, 2, 3].includes(d.getUTCMonth()), `Feb–Apr 2027 expected, got ${d.toISOString()}`);
  assert.equal(look.to - look.from, 42);
});

test('bunching text and ics are computed per view', () => {
  const v = manifest('e5f4784477c4', 'D3');
  assert.match(bunchingText(v), /usable pictures/);
  const ics = nextLookIcs("Barnard's Star", 'D2', { mjd: 61480, from: 61459, to: 61501 }, 61000);
  assert.match(ics, /UID:skyblink-BarnardsStar-D2-/);
  assert.match(ics, /DTSTART;VALUE=DATE:\d{8}/);
  assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
});
