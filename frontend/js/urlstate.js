// Page URL state, exactly as in docs/api.md:
//   ?ra=&dec=&fov=&det=&mode=stack|visits&fps=&target=&embed=1
// `mock=1` is carried through untouched so the offline demo keeps working.

export const FOVS = [0.05, 0.1, 0.2, 0.3, 0.5];
export const DETECTORS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
export const MODES = ['stack', 'visits'];
export const DEFAULTS = Object.freeze({ fov: 0.1, det: 'D6', mode: 'stack', fps: 2 });
const FPS_MIN = 0.5;
const FPS_MAX = 12;

function num(value) {
  if (value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
  const mode = p.get('mode');
  const validCoords = ra !== null && dec !== null && ra >= 0 && ra < 360 && dec >= -90 && dec <= 90;
  return {
    ra: validCoords ? ra : null,
    dec: validCoords ? dec : null,
    target: (p.get('target') || '').trim() || null,
    fov: FOVS.includes(fov) ? fov : DEFAULTS.fov,
    det: DETECTORS.includes(det) ? det : DEFAULTS.det,
    mode: MODES.includes(mode) ? mode : DEFAULTS.mode,
    fps: fps !== null ? clampFps(fps) : DEFAULTS.fps,
    embed: p.get('embed') === '1',
    mock: p.get('mock') === '1',
  };
}

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
  if (embed) p.set('embed', '1');
  if (state.mock) p.set('mock', '1');
  return p.toString();
}

export function writeUrlState(state) {
  const hasView = state.ra !== null || state.target;
  const query = hasView ? `?${toQuery(state)}` : state.mock ? '?mock=1' : '';
  history.replaceState(null, '', `${location.pathname}${query}`);
}

export function shareUrl(state, opts) {
  return `${location.origin}${location.pathname}?${toQuery(state, opts)}`;
}
