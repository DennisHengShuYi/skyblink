// Pure helpers for the search box: fuzzy "did you mean" suggestions and the
// recent-searches list. Storage lives in app.js (wrapped in try/catch).

export function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Comparison key for names in any script: lower case, Latin accents dropped (é → e), then
 * only letters, digits and combining marks kept. Combining marks outside the Latin accent
 * block stay, because scripts such as Tamil or Devanagari need them to spell anything.
 */
export const norm = (s) => String(s).toLowerCase().normalize('NFKD')
  .replace(/(\p{Script=Latin})\p{M}+/gu, '$1').replace(/[^\p{L}\p{N}\p{M}]/gu, '');

/** Names close to `query` (prefix match or ≤ 30% edits), best first. */
export function suggestNames(query, names, max = 3) {
  const q = norm(query);
  if (!q) return [];
  return names
    .map((name) => {
      const n = norm(name);
      if (n.startsWith(q) || (q.length >= 4 && n.includes(q))) return { name, d: 0 };
      return { name, d: levenshtein(q, n) / Math.max(q.length, n.length) };
    })
    .filter((s) => s.d <= 0.3)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((s) => s.name);
}

/** New recent list with `entry` first, duplicates removed, at most `max` long. */
export function addRecent(list, entry, max = 8) {
  const e = String(entry || '').trim();
  if (!e) return list;
  return [e, ...list.filter((x) => x !== e)].slice(0, max);
}

// Things people type first that SkyBlink can't show as a fixed patch of sky. Each gets an
// honest one-line answer and, where one exists, a featured view to try instead.
const NEARBY = {
  sun: 'The Sun is far too bright: SPHEREx always points well away from it.',
  moon: "The Moon crosses a SPHEREx-sized patch of sky in minutes, so it never stays in one place to be blinked.",
  mercury: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  venus: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  earth: "That's where SPHEREx is looking from!",
  mars: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  jupiter: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  saturn: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  uranus: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  neptune: 'Planets move across the sky every night, so they never stay in one fixed patch.',
  pluto: 'Pluto moves too: it creeps a little every day, which is how Clyde Tombaugh found it in 1930 by blinking two photographs.',
  blackhole: "Black holes don't shine on their own, so there is nothing to see in one small patch.",
  milkyway: 'The Milky Way is the whole band of stars across the sky, far bigger than one SkyBlink patch.',
  galaxy: 'Galaxies are so far away that nothing in them visibly moves in a human lifetime.',
};
const ALIASES = { themoon: 'moon', thesun: 'sun', blackholes: 'blackhole', galaxies: 'galaxy', themilkyway: 'milkyway' };

/**
 * An honest answer for a solar-system body or a big idea, or null for anything else.
 * {message, suggest}: suggest says which kind of featured view fits best ('motion' or null).
 */
export function friendlyAnswer(query) {
  const raw = norm(query).replace(/^(planet)/, '');
  const key = ALIASES[raw] || raw;
  if (!Object.prototype.hasOwnProperty.call(NEARBY, key)) return null;
  return {
    message: `${NEARBY[key]} SkyBlink shows things that change in one fixed patch of sky: try a star that moves instead.`,
    suggest: 'motion',
  };
}
