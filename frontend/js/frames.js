// Pure frame-list helpers: ordering (time or wavelength), time-proportional
// positions for the date strip, survey-window starts and playback stepping.

const byNumber = (key) => (a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0);

/** A new array of the same frames, sorted by 'time' (mjd) or 'wavelength' (um). */
export function orderFrames(frames, sort = 'time') {
  return frames.slice().sort(sort === 'wavelength' ? byNumber('um') : byNumber('mjd'));
}

/** 0..1 position of each frame along the time axis (0.5 when all share one date). */
export function timePositions(frames) {
  const mjds = frames.map((f) => Number(f.mjd));
  const finite = mjds.filter(Number.isFinite);
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return mjds.map((m) => (Number.isFinite(m) && hi > lo ? (m - lo) / (hi - lo) : 0.5));
}

/** First frame index of each survey window, with that window's label. */
export function windowStarts(frames, view) {
  const seen = new Set();
  const out = [];
  frames.forEach((f, index) => {
    if (seen.has(f.window)) return;
    seen.add(f.window);
    const win = (view.windows || []).find((w) => w.id === f.window);
    out.push({ index, label: win ? win.label : String(f.date || '').slice(0, 7) });
  });
  return out;
}

/** Next playback step for loop / bounce / once. */
export function nextIndex(index, n, mode = 'loop', dir = 1) {
  if (n < 2) return { index: 0, dir, stop: true };
  if (mode === 'bounce') {
    let d = dir;
    if (index + d >= n || index + d < 0) d = -d;
    return { index: index + d, dir: d, stop: false };
  }
  if (mode === 'once') {
    return index + 1 >= n ? { index, dir: 1, stop: true } : { index: index + 1, dir: 1, stop: false };
  }
  return { index: (index + 1) % n, dir: 1, stop: false };
}
