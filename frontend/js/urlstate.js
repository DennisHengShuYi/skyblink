// Page URL state (see docs/api.md):
//   ?ra=&dec=&fov=&det=&mode=stack|visits&fps=&target=&embed=1
// plus optional view settings so a shared link reopens exactly what you saw:
//   frame, tool, a, b, stars, gmax, minpm, flags, cmap, stretch, bright, contrast, smooth,
//   px, py, ap, sort, loop, blink, cross, level (simple|full), calm
// Settings at their default are left out of the URL. `mock=1` is carried through untouched.

export const FOVS = [0.05, 0.1, 0.2, 0.3, 0.5];
export const DETECTORS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
export const MODES = ['stack', 'visits'];
export const TOOLS = ['animate', 'blink', 'diff', 'deep', 'reference', 'then', 'measure'];
export const CMAPS = ['grey', 'inferno', 'viridis', 'cubehelix'];
export const STRETCHES = ['asinh', 'linear', 'sqrt', 'log', 'faint'];
export const SORTS = ['time', 'wavelength'];
export const LOOPS = ['loop', 'bounce', 'once'];
export const BLINK_RATES = [0.5, 1, 2]; // changes per second; WCAG limit is 3 flashes/s
export const CROSSHAIRS = ['cross', 'corners', 'off'];
export const MIN_PMS = [0, 20, 100, 500];
export const APERTURES = [0, 1, 2]; // radius: 1×1, 3×3, 5×5 pixels
export const LEVEL_VALUES = ['simple', 'full'];

export const DEFAULTS = Object.freeze({
  fov: 0.1, det: 'D6', mode: 'stack', fps: 2,
  frame: 0, tool: 'animate', a: null, b: null, stars: false, gmax: 21, minPm: 0, flags: false,
  cmap: 'grey', stretch: 'asinh', bright: 1, contrast: 1, smooth: false,
  px: null, py: null, ap: 0, sort: 'time', loop: 'loop', blinkHz: 1, cross: 'cross',
  level: null, calm: false, skip: false,
});
const FPS_MIN = 0.5;
// Photosensitivity (WCAG 2.3.1): a flash is a pair of opposing brightness changes, so
// 6 frame changes a second can never make more than 3 flashes a second, whatever the
// frames look like. Faster playback (and links asking for it) is capped here.
export const FPS_MAX = 6;
const RANGES = { bright: [0.5, 4], contrast: [0.4, 2.5], gmax: [8, 21] };

function num(value) {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const intOrNull = (v, min = 0) => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= min ? n : null;
};
const oneOf = (list, v, dflt) => (list.includes(v) ? v : dflt);
const clampTo = (key, v) => {
  const [lo, hi] = RANGES[key];
  return v === null ? DEFAULTS[key] : Math.min(hi, Math.max(lo, v));
};

export function clampFps(v) {
  return Math.min(FPS_MAX, Math.max(FPS_MIN, v));
}

/** Parse and validate the current location into a plain state object. */
export function readUrlState(search = location.search) {
  const p = new URLSearchParams(search);
  const ra = num(p.get('ra'));
  const dec = num(p.get('dec'));
  const fov = num(p.get('fov'));
  const fps = num(p.get('fps'));
  const det = (p.get('det') || '').toUpperCase();
  const validCoords = ra !== null && dec !== null && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
  const px = intOrNull(p.get('px'));
  const py = intOrNull(p.get('py'));
  return {
    ra: validCoords ? ra : null,
    dec: validCoords ? dec : null,
    target: (p.get('target') || '').trim() || null,
    fov: FOVS.includes(fov) ? fov : DEFAULTS.fov,
    det: DETECTORS.includes(det) ? det : DEFAULTS.det,
    mode: oneOf(MODES, p.get('mode'), DEFAULTS.mode),
    fps: fps !== null ? clampFps(fps) : DEFAULTS.fps,
    embed: p.get('embed') === '1',
    kiosk: p.get('kiosk') === '1',
    mock: p.get('mock') === '1',
    frame: intOrNull(p.get('frame')) ?? DEFAULTS.frame,
    tool: oneOf(TOOLS, p.get('tool'), DEFAULTS.tool),
    a: intOrNull(p.get('a')),
    b: intOrNull(p.get('b')),
    stars: p.get('stars') === '1',
    gmax: clampTo('gmax', num(p.get('gmax'))),
    minPm: oneOf(MIN_PMS, num(p.get('minpm')), DEFAULTS.minPm),
    flags: p.get('flags') === '1',
    cmap: oneOf(CMAPS, p.get('cmap'), DEFAULTS.cmap),
    stretch: oneOf(STRETCHES, p.get('stretch'), DEFAULTS.stretch),
    bright: clampTo('bright', num(p.get('bright'))),
    contrast: clampTo('contrast', num(p.get('contrast'))),
    smooth: p.get('smooth') === '1',
    px: px !== null && py !== null ? px : null,
    py: px !== null && py !== null ? py : null,
    ap: oneOf(APERTURES, num(p.get('ap')), DEFAULTS.ap),
    sort: oneOf(SORTS, p.get('sort'), DEFAULTS.sort),
    loop: oneOf(LOOPS, p.get('loop'), DEFAULTS.loop),
    blinkHz: oneOf(BLINK_RATES, num(p.get('blink')), DEFAULTS.blinkHz),
    cross: oneOf(CROSSHAIRS, p.get('cross'), DEFAULTS.cross),
    level: oneOf(LEVEL_VALUES, p.get('level'), DEFAULTS.level),
    calm: p.get('calm') === '1',
    skip: p.get('skip') === '1',
  };
}

// [state key, query key, encoder]
const OPTIONAL = [
  ['frame', 'frame', String], ['tool', 'tool', String], ['a', 'a', String], ['b', 'b', String],
  ['stars', 'stars', () => '1'], ['gmax', 'gmax', String], ['minPm', 'minpm', String], ['flags', 'flags', () => '1'],
  ['cmap', 'cmap', String], ['stretch', 'stretch', String], ['bright', 'bright', String],
  ['contrast', 'contrast', String], ['smooth', 'smooth', () => '1'], ['px', 'px', String], ['py', 'py', String],
  ['ap', 'ap', String], ['sort', 'sort', String], ['loop', 'loop', String], ['blinkHz', 'blink', String],
  ['cross', 'cross', String], ['level', 'level', String], ['calm', 'calm', () => '1'],
  ['skip', 'skip', () => '1'],
];

/** Build the query string for a state object (no leading "?"). */
export function toQuery(state, { embed = state.embed } = {}) {
  const p = new URLSearchParams();
  if (state.ra !== null && state.dec !== null) {
    p.set('ra', state.ra.toFixed(5));
    p.set('dec', state.dec.toFixed(5));
  }
  p.set('fov', String(state.fov));
  p.set('det', state.det);
  p.set('mode', state.mode);
  p.set('fps', String(state.fps));
  if (state.target) p.set('target', state.target);
  OPTIONAL.forEach(([key, q, enc]) => {
    const v = state[key];
    if (v === undefined || v === null || v === DEFAULTS[key]) return;
    p.set(q, enc(v));
  });
  if (embed) p.set('embed', '1');
  if (state.kiosk) p.set('kiosk', '1');
  if (state.mock) p.set('mock', '1');
  return p.toString();
}

const WRITE_DELAY_MS = 250;
let writeTimer = null;

/**
 * Mirror the state into the address bar. Debounced: browsers throttle replaceState
 * (Safari/Firefox throw after ~100 calls in 10 s), and sliders/playback change state often.
 */
export function writeUrlState(state) {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const hasView = state.ra !== null || state.target;
    const query = hasView ? `?${toQuery(state)}` : state.mock ? '?mock=1' : '';
    try {
      history.replaceState(null, '', `${location.pathname}${query}`);
    } catch {
      // Throttled by the browser: the next change writes the URL again.
    }
  }, WRITE_DELAY_MS);
}

export function shareUrl(state, opts) {
  return `${location.origin}${location.pathname}?${toQuery(state, opts)}`;
}
