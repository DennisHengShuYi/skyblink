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

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

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
