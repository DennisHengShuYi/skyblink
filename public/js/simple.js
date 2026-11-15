// Simple view: plain words for newcomers. The level comes from the URL first, then the
// visitor's remembered choice, then the default (simple). Calm mode slows everything down.

export const LEVELS = ['simple', 'full'];
export const DEFAULT_LEVEL = 'simple';
export const CALM_FPS = 2;
export const CALM_BLINK_HZ = 0.5;

/** 'simple' | 'full' from a URL value and a stored value (either may be junk). */
export function resolveLevel(urlValue, storedValue) {
  if (LEVELS.includes(urlValue)) return urlValue;
  if (LEVELS.includes(storedValue)) return storedValue;
  return DEFAULT_LEVEL;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthSpan(win) {
  if (!win) return '';
  const a = new Date((win.mjd_start - 40587) * 86400000);
  const b = new Date((win.mjd_end - 40587) * 86400000);
  const ma = MONTHS[a.getUTCMonth()];
  const mb = MONTHS[b.getUTCMonth()];
  const ya = a.getUTCFullYear();
  const yb = b.getUTCFullYear();
  if (ya !== yb) return `${ma} ${ya}–${mb} ${yb}`;
  return ma === mb ? `${ma} ${ya}` : `${ma}–${mb} ${ya}`;
}

/** "Look 2 of 3 · Nov–Dec 2025 · 21 photos combined" (or one photo in Every image mode). */
export function plainTitle(frame, mode, view, index, total) {
  if (!frame) return '';
  if (mode === 'visits') {
    const d = new Date((frame.mjd - 40587) * 86400000);
    const day = Number.isFinite(frame.mjd) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : (frame.date || '');
    return `Photo ${index + 1} of ${total} · ${day}`;
  }
  const win = (view.windows || []).find((w) => w.id === frame.window);
  const n = frame.n ?? win?.n;
  return `Look ${index + 1} of ${total} · ${monthSpan(win) || frame.date || ''}${n ? ` · ${n} photo${n === 1 ? '' : 's'} combined` : ''}`;
}
