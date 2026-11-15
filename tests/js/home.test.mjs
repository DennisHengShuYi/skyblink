import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findBirthday, birthdayText, dayOfYear, validBirthday } from '../../frontend/js/birthday.js';
import { puzzleOfDay, answerTrack, checkTap, quarterOf, shareLine, nextStreak, PUZZLES } from '../../frontend/js/puzzle.js';

const calendar = JSON.parse(readFileSync(new URL('../../frontend/calendar.json', import.meta.url)));
const manifest = (key) => { const [h, d] = key.split('-'); return JSON.parse(readFileSync(new URL(`../../public/data/${h}-${d}/manifest.json`, import.meta.url))); };
const featured = JSON.parse(readFileSync(new URL('../../public/data/featured.json', import.meta.url)));
const keyOf = (slug, det) => `${featured.find((f) => f.slug === slug).key.split('-')[0]}-${det}`;

test('birthday: exact day when SPHEREx pictured something then', () => {
  const hit = findBirthday(calendar, 8, 31); // Barnard D1 has a 31 Aug 2025 picture
  assert.equal(hit.offsetDays, 0);
  assert.match(birthdayText(hit), /\(your birthday!\)/);
});

test('birthday: nearest day otherwise, wrapping round New Year; 29 Feb works', () => {
  for (let m = 1; m <= 12; m += 1) {
    const hit = findBirthday(calendar, m, 15);
    assert.ok(hit && Math.abs(hit.offsetDays) < 60, `month ${m}`);
  }
  assert.ok(findBirthday(calendar, 2, 29));
  assert.equal(validBirthday(2, 30), false);
  assert.equal(dayOfYear(1, 1), 0);
  assert.equal(findBirthday(calendar, 13, 1), null);
});

test('puzzle rotation is daily and numbered', () => {
  const a = puzzleOfDay(new Date(Date.UTC(2026, 10, 1, 12)));
  const b = puzzleOfDay(new Date(Date.UTC(2026, 10, 2, 0, 5)));
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  assert.notEqual(a.slug, b.slug);
});

test('every puzzle answer is in the picture and a tap on it counts', () => {
  PUZZLES.forEach((p) => {
    const view = manifest(keyOf(p.slug, p.det));
    const track = answerTrack(view, p);
    assert.ok(track.length >= 1);
    track.forEach((pt) => assert.ok(pt.x > 1 && pt.y > 1 && pt.x < 57 && pt.y < 57, `${p.slug} inside`));
    assert.ok(checkTap(track, { x: Math.round(track[0].x), y: Math.round(track[0].y) }));
    assert.equal(checkTap(track, { x: 2, y: 2 }), false);
    assert.match(quarterOf(track, 59), /quarter|middle/);
  });
});

test('share line has no answer; streaks count consecutive days', () => {
  const s = shareLine(12, 2, true);
  assert.match(s, /#12/);
  PUZZLES.forEach((p) => assert.ok(!s.toLowerCase().includes(p.slug)));
  assert.deepEqual(nextStreak({ last: 4, count: 3 }, 5, true), { last: 5, count: 4 });
  assert.deepEqual(nextStreak({ last: 2, count: 3 }, 5, true), { last: 5, count: 1 });
  assert.deepEqual(nextStreak({ last: 5, count: 4 }, 5, true), { last: 5, count: 4 });
});

test('flip-book: crop keeps the mover inside, pages repeat the windows', async () => {
  const { cropBox, pageOrder, CROP_PX } = await import('../../frontend/js/flipbook.js');
  const { moverFor } = await import('../../frontend/js/thennow.js');
  const { project, propagate } = await import('../../frontend/js/gaia.js');
  const view = manifest(keyOf('barnard', 'D2'));
  const star = moverFor(view, null);
  const box = cropBox(view, star);
  view.stacks.forEach((s) => {
    const p = propagate(star, s.mjd); const g = project(p.ra, p.dec, view);
    assert.ok(g.x >= box.x0 + 2 && g.x <= box.x0 + CROP_PX - 3 && g.y >= box.y0 + 2 && g.y <= box.y0 + CROP_PX - 3);
  });
  const order = pageOrder(3, 12);
  assert.equal(order.length, 12);
  assert.deepEqual(order.slice(0, 4).map((o) => o.window), [0, 1, 2, 0]);
  assert.equal(order[3].round, 2);
});

test('lesson answer key is computed from the featured data', async () => {
  const { answerKey, viewLink } = await import('../../frontend/js/lesson.js');
  const k = answerKey({ barnard: manifest(keyOf('barnard', 'D2')), epsindib: manifest(keyOf('epsindib', 'D6')), rwaur: manifest(keyOf('rwaur', 'D1')) });
  assert.ok(Math.abs(k.barnard.gaia - 10.39) < 0.05);
  assert.ok(Math.abs(k.epsindib.gaia - 4.68) < 0.05);
  assert.ok(k.barnard.thenPx > 24 && k.barnard.thenPx < 29);
  assert.ok(k.barnard.err > 1 && k.barnard.err < 1.5);
  assert.ok(k.rwaur.yearsPerPixel > 100);
  const link = viewLink('https://x.test/', featured.find((f) => f.slug === 'barnard'), 'D2', { tool: 'measure' });
  assert.match(link, /det=D2/);
  assert.match(link, /tool=measure/);
});

test("planets: Barnard's Star is a known host; its system fits in one ~11 AU pixel", async () => {
  const { hostsIn, hostText } = await import('../../frontend/js/planets.js');
  const hosts = hostsIn(manifest(keyOf('barnard', 'D2')));
  assert.equal(hosts.length, 1);
  assert.ok(hosts[0].pixelAu > 10 && hosts[0].pixelAu < 12.5, String(hosts[0].pixelAu));
  assert.match(hostText(hosts[0]), /at least 4 known planets/);
  assert.equal(hostsIn(manifest(keyOf('rwaur', 'D3'))).length, 0);
});
