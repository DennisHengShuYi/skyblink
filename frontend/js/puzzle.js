// Spot the Change: one puzzle a day (UTC), from a fixed rotation of featured views whose
// answer is known and checkable. Tap what moved or changed; hints climb from Blink to
// Difference to "which quarter" to the reveal. A spoiler-free share line, a local streak.
import { project, propagate } from './gaia.js';
import { moverFor, thenTargetFor } from './thennow.js';

export const TOLERANCE_PX = 2.5;
export const EPOCH_DAY = Date.UTC(2026, 10, 1) / 86400000; // puzzle #1 = 1 Nov 2026

export const PUZZLES = Object.freeze([
  { slug: 'barnard', det: 'D2', kind: 'motion',
    reveal: "Barnard's Star, 6 light-years away: the fastest-moving star in our sky. It crept north about 1.7 SPHEREx pixels in a year." },
  { slug: 'rwaur', det: 'D1', kind: 'variable',
    reveal: 'RW Aurigae, a young star wrapped in dust that dims and brightens as clumps pass in front of it. It changed brightness between SPHEREx\'s visits.' },
  { slug: 'wise0855', det: 'D5', kind: 'motion',
    reveal: 'WISE 0855, the coldest brown dwarf known, 7.4 light-years away. Gaia can\'t even see it in visible light, but SPHEREx catches it crawling west.' },
  { slug: 'epsindib', det: 'D6', kind: 'motion',
    reveal: 'Epsilon Indi B, a pair of brown dwarfs 12 light-years away, drifting south-east about 0.8 pixels a year. A hard one!' },
]);

/** Days since EPOCH_DAY for a Date (UTC). */
export function puzzleDay(date) {
  return Math.floor(date.getTime() / 86400000) - EPOCH_DAY;
}

/** Today's puzzle and its number (1-based). */
export function puzzleOfDay(date) {
  const day = puzzleDay(date);
  const idx = ((day % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
  return { ...PUZZLES[idx], number: day + 1 };
}

/** Answer positions (grid px) at each stack date: the mover's track, or the crosshair. */
export function answerTrack(view, puzzle) {
  const c = (view.grid.npix - 1) / 2;
  if (puzzle.kind === 'variable') return [{ x: c, y: c }];
  const star = moverFor(view, thenTargetFor(view));
  if (!star) return [{ x: c, y: c }];
  return (view.stacks || []).filter((s) => Number.isFinite(s.mjd)).map((s) => {
    const p = propagate(star, s.mjd);
    return project(p.ra, p.dec, view);
  }).filter(Boolean);
}

/** True when a tap (grid px) lands within TOLERANCE_PX of the answer track. */
export function checkTap(track, tap) {
  return track.some((p) => Math.hypot(p.x - tap.x, p.y - tap.y) <= TOLERANCE_PX);
}

/** "top-left" style quarter of the track's middle. */
export function quarterOf(track, npix) {
  const x = track.reduce((a, p) => a + p.x, 0) / track.length;
  const y = track.reduce((a, p) => a + p.y, 0) / track.length;
  const half = (npix - 1) / 2;
  if (Math.abs(x - half) < 3 && Math.abs(y - half) < 3) return 'right in the middle';
  return `${y <= half ? 'top' : 'bottom'}-${x <= half ? 'left' : 'right'} quarter`;
}

/** Spoiler-free share text: number, hints used, no target name or position. */
export function shareLine(number, hints, solved) {
  const squares = solved ? `${'🟨'.repeat(hints)}🟩` : `${'🟨'.repeat(hints)}🟥`;
  return `SkyBlink sky puzzle #${number}: ${solved ? `found it with ${hints} hint${hints === 1 ? '' : 's'}` : 'needed the answer'} ${squares}`;
}

/** Streak update: {last, count} → new object (immutable). */
export function nextStreak(prev, day, solved) {
  if (!solved) return { last: prev?.last ?? null, count: prev?.last === day ? prev.count : 0 };
  if (prev?.last === day) return prev;
  return { last: day, count: prev?.last === day - 1 ? prev.count + 1 : 1 };
}
