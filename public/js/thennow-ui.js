// Then & Now tool UI: flip (1 change a second, WCAG-safe), tap to flip, or drag a curtain
// between an older survey picture and SPHEREx's deep stack, with Gaia then/now rings.
import { loadImage } from './player.js';
import {
  thenTargetFor, moverFor, thenNowGeometry, deepEpoch, badgeText, yearOf, SURVEY_CREDITS, MIN_SHIFT_PX,
} from './thennow.js';
import { $, toast } from './ui.js';

const REMOTE_TIMEOUT_MS = 12000; // per CDS host; then the next host, then a polite message
const FLIP_MS = 1000; // one change a second: well under 3 flashes a second
const HIPS2FITS = ['https://alasky.cds.unistra.fr/hips-image-services/hips2fits', 'https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits'];

/** Live fallback when no saved copy ships: the same single-band survey from CDS hips2fits. */
function liveUrl(view, target, host) {
  const q = new URLSearchParams({
    hips: target.hips, width: '177', height: '177', fov: ((view.grid.npix * view.grid.scale_arcsec) / 3600).toFixed(5),
    projection: 'TAN', coordsys: 'icrs', rotation_angle: '0.0', ra: String(view.ra), dec: String(view.dec), format: 'png',
    stretch: 'asinh',
  });
  return `${host}?${q}`;
}

async function loadThenImage(view, target) {
  try {
    return await loadImage(`thennow/${target.slug}-${target.survey}.png`);
  } catch {
    for (const host of HIPS2FITS) {
      try {
        return await loadImage(liveUrl(view, target, host), { crossOrigin: 'anonymous', timeoutMs: REMOTE_TIMEOUT_MS });
      } catch {
        // try the mirror
      }
    }
  }
  throw new Error('unavailable');
}

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object}} ctx.current
 * @param {(text: string|null) => void} ctx.setBadge
 * @param {() => boolean} [ctx.calm] calm motion / reduced motion: don't start flipping by itself
 */
export function createThenNow({ player, current, setBadge, calm = () => false }) {
  let timer = null;
  let state = null; // {view, thenImg, deepImg, geo, target, showingThen}

  /** Show or hide the tool button for this view. */
  function sync(view) {
    const target = thenTargetFor(view);
    const btn = document.querySelector('#tool-group [data-tool="then"]');
    if (btn) btn.hidden = !target;
  }

  function marks(showingThen) {
    const { geo, target } = state;
    if (!geo) return [];
    const nowYear = yearOf(deepEpoch(state.view));
    return [
      { kind: 'ring', x: geo.then.x, y: geo.then.y, r: 2.2, color: showingThen ? '#ffd166' : 'rgba(255, 209, 102, 0.55)', dashed: true, label: String(target.year) },
      { kind: 'ring', x: geo.now.x, y: geo.now.y, r: 2.2, color: showingThen ? 'rgba(124, 252, 154, 0.55)' : '#7CFC9A', label: `${nowYear}` },
      { kind: 'arrow', x0: geo.then.x, y0: geo.then.y, x1: geo.now.x, y1: geo.now.y, color: 'rgba(255, 255, 255, 0.45)', width: 1.25 },
    ];
  }

  function show(which) {
    if (!state) return;
    state.showingThen = which === 'then';
    if (state.showingThen) player.setOverride({ kind: 'reference', img: state.thenImg });
    else player.setOverride({ kind: 'deep', img: state.deepImg });
    player.setMarks(marks(state.showingThen));
    $('then-which').textContent = state.showingThen
      ? `Showing: ${state.target.label}, ${state.target.year}`
      : `Showing: SPHEREx, all images combined (${yearOf(deepEpoch(state.view))})`;
  }

  function stopFlip() {
    clearInterval(timer);
    timer = null;
    $('then-flip').textContent = 'Flip automatically';
    $('then-flip').setAttribute('aria-pressed', 'false');
  }

  function startFlip() {
    stopFlip();
    timer = setInterval(() => show(state.showingThen ? 'now' : 'then'), FLIP_MS);
    $('then-flip').textContent = 'Stop flipping';
    $('then-flip').setAttribute('aria-pressed', 'true');
  }

  async function open() {
    const { view } = current();
    const target = thenTargetFor(view);
    if (!target) return;
    $('stage-loading').hidden = false;
    $('stage-loading-msg').textContent = `Loading the ${target.year} picture…`;
    try {
      const [thenImg, deepImg] = await Promise.all([loadThenImage(view, target), loadImage(view.deep.png)]);
      if (current().view !== view) return;
      const star = moverFor(view, target);
      const geo = thenNowGeometry(view, star, target.mjd, deepEpoch(view));
      state = { view, target, thenImg, deepImg, geo, showingThen: true };
      $('then-story').textContent = target.story;
      $('then-credit').textContent = `${SURVEY_CREDITS[target.survey]} ${star?.published ? `Motion: ${star.published}.` : 'Rings: Gaia DR3 positions moved along its measured motion.'}`;
      const big = geo && geo.shiftPx >= MIN_SHIFT_PX;
      setBadge(big ? badgeText(geo) : 'Then & Now');
      $('then-curtain').value = '100';
      show('then');
      if (!calm()) startFlip();
    } catch {
      toast("The older picture couldn't be loaded right now. The rest of SkyBlink still works.");
    } finally {
      $('stage-loading').hidden = true;
    }
  }

  function close() {
    stopFlip();
    state = null;
    player.setMarks([]);
  }

  $('then-flip').addEventListener('click', () => {
    if (!state) return;
    if (timer) stopFlip();
    else startFlip();
  });
  $('then-tap').addEventListener('click', () => {
    if (!state) return;
    stopFlip();
    show(state.showingThen ? 'now' : 'then');
  });
  $('then-curtain').addEventListener('input', (e) => {
    if (!state) return;
    stopFlip();
    const at = Number(e.target.value) / 100;
    player.setOverride({ kind: 'split', img: state.thenImg, deepImg: state.deepImg, at });
    player.setMarks(marks(at > 0.5));
    $('then-which').textContent = `Left of the line: ${state.target.label}, ${state.target.year} · right: SPHEREx`;
  });

  return { sync, show: open, stop: close };
}
