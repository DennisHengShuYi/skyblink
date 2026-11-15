// Compare tools: Animation, Blink A/B (0.5–2 Hz), Difference (S/N or robust scale,
// computed in the browser from the float cube), Deep stack and Reference (a sharper
// 2MASS/AllWISE/DSS image of the same field from CDS hips2fits). Owns the tool radio
// group, its panels and the stage badge.
import { loadImage } from './player.js';
import { planeFor } from './cube.js';
import { snDifference, diffToRGBA, robustSigma, stackVariance, deepVariance } from './photometry.js';
import { $, el, toast, setupRadioGroup, frameOption } from './ui.js';

// Main CDS host first, then its mirror (CDS has had outages: see CLAUDE.md archive gotchas).
const HIPS2FITS = ['https://alasky.cds.unistra.fr/hips-image-services/hips2fits', 'https://alaskybis.cds.unistra.fr/hips-image-services/hips2fits'];
export const REFERENCE_SURVEYS = {
  '2mass': { id: 'CDS/P/2MASS/color', label: '2MASS (1–2 µm, 1″ pixels)' },
  allwise: { id: 'CDS/P/allWISE/color', label: 'AllWISE (3–22 µm)' },
  dss2: { id: 'CDS/P/DSS2/color', label: 'DSS2 (visible light)' },
};
const SN_FULL_SCALE = 12;     // a 12σ change is full red/blue
const ROBUST_FULL_SCALE = 12; // ×robust σ of the difference image

/** hips2fits URL for a north-up, east-left TAN cutout matching the view's grid. */
export function referenceUrl(view, survey, size, host = HIPS2FITS[0]) {
  const width = (view.grid.npix * view.grid.scale_arcsec) / 3600;
  const q = new URLSearchParams({
    hips: (REFERENCE_SURVEYS[survey] || REFERENCE_SURVEYS['2mass']).id,
    width: String(size), height: String(size), fov: width.toFixed(5), projection: 'TAN',
    coordsys: 'icrs', rotation_angle: '0.0', ra: String(view.ra), dec: String(view.dec), format: 'jpg',
  });
  return `${host}?${q}`;
}

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object, frames: object[], mode: string}} ctx.current
 * @param {(view: object) => Promise<object>} ctx.getCube
 * @param {(state: {tool: string, a: number|null, b: number|null}) => void} ctx.onChange
 * @param {Object<string, object>} [ctx.extraTools] tools owned elsewhere, in one of two shapes:
 *   {show, stop} (Then & Now: shown when selected, stopped on every tool change) or
 *   {enter, leave} (Colour: enter resolves to a badge text, leave runs when the user moves off it).
 */
export function createCompare({ player, current, getCube, onChange = () => {}, extraTools = {} }) {
  let tool = 'animate';
  const setTool = setupRadioGroup($('tool-group'), 'tool', (t) => selectTool(t));
  const refCache = new Map();

  function setBadge(text) {
    $('stage-badge').hidden = !text;
    $('stage-badge').textContent = text || '';
  }

  function setBlinkButton(on) {
    $('blink-go').textContent = on ? 'Stop blinking' : 'Start blinking';
    $('blink-go').setAttribute('aria-pressed', String(on));
  }

  function report() {
    const pairTool = tool === 'blink' ? 'blink' : tool === 'diff' ? 'diff' : null;
    const val = (id) => {
      const v = $(id).value;
      return v === '' || v === 'deep' ? null : Number(v);
    };
    onChange({
      tool,
      a: pairTool ? val(`${pairTool}-a`) : null,
      b: pairTool ? val(`${pairTool}-b`) : null,
    });
  }

  function applyTool(t) {
    if (tool !== t) extraTools[tool]?.leave?.();
    tool = t;
    Object.values(extraTools).forEach((x) => x.stop?.());
    document.querySelectorAll('.tool-panel').forEach((p) => { p.hidden = p.dataset.panel !== t || !p.childElementCount; });
    player.stopBlink();
    player.clearOverride();
    setBlinkButton(false);
    setBadge(null);
    $('frame-label').hidden = false;
    report();
  }

  function showOverride(override, badge) {
    player.setOverride(override);
    setBadge(badge);
    $('frame-label').hidden = true;
  }

  async function withLoading(message, task) {
    $('stage-loading').hidden = false;
    $('stage-loading-msg').textContent = message;
    try {
      return await task();
    } finally {
      $('stage-loading').hidden = true;
    }
  }

  async function showDeep() {
    const { view } = current();
    if (!view?.deep?.png) return;
    try {
      const img = await withLoading('Loading the deep stack…', () => loadImage(view.deep.png));
      if (tool !== 'deep' || current().view !== view) return;
      showOverride({ kind: 'deep', img }, `Deep stack · ${view.deep.n ?? ''} images`);
    } catch {
      toast("The deep stack couldn't be loaded. Please try again.");
    }
  }

  async function showReference() {
    const { view } = current();
    if (!view) return;
    const survey = $('ref-survey').value;
    const size = Math.min(1024, player.canvas.width);
    const key = `${view.key}|${survey}|${size}`;
    try {
      let img = refCache.get(key);
      if (!img) {
        img = await withLoading('Fetching the reference image from CDS…', async () => {
          for (const host of HIPS2FITS) {
            try {
              return await loadImage(referenceUrl(view, survey, size, host), { crossOrigin: 'anonymous' });
            } catch {
              // Try the mirror.
            }
          }
          throw new Error('unavailable');
        });
        refCache.set(key, img);
      }
      if (tool !== 'reference' || current().view !== view) return;
      showOverride({ kind: 'reference', img }, `Reference · ${REFERENCE_SURVEYS[survey].label.split(' (')[0]}`);
    } catch {
      toast("The CDS image service (Strasbourg) isn't answering right now, so the reference image is unavailable. The rest of SkyBlink still works; try again later.");
    }
  }

  async function selectTool(t) {
    applyTool(t);
    player.pause();
    if (t === 'deep') await showDeep();
    if (t === 'reference') await showReference();
    if (extraTools[t] && tool === t) {
      const x = extraTools[t];
      if (x.show) {
        $('frame-label').hidden = true;
        await x.show();
      } else {
        const badge = await x.enter();
        if (tool === t && badge) setBadge(badge);
      }
    }
  }

  function startBlink() {
    const a = Number($('blink-a').value);
    const b = Number($('blink-b').value);
    if (a === b) {
      toast('Pick two different frames to blink.');
      return;
    }
    player.startBlink(a, b);
    setBlinkButton(true);
    setBadge(`Blinking frame ${a + 1} ↔ ${b + 1}`);
    report();
  }

  function toggleBlink() {
    if (player.blinkPair) {
      player.stopBlink();
      setBlinkButton(false);
      setBadge(null);
      return;
    }
    startBlink();
  }

  function refOf(value, frames) {
    if (value === 'deep') return { ref: 'deep' };
    const f = frames[Number(value)];
    return Number.isInteger(f.i) ? { ref: `v${f.i}`, visit: f.i } : { ref: `s${f.window}`, window: f.window };
  }

  function varianceOf(cube, view, r) {
    if (r.ref === 'deep') return deepVariance(cube);
    if (r.visit !== undefined) return cube.variance((view.visits || []).findIndex((v) => v.i === r.visit));
    return stackVariance(cube, view, r.window);
  }

  async function showDiff() {
    const { view, frames } = current();
    const ra = refOf($('diff-a').value, frames);
    const rb = refOf($('diff-b').value, frames);
    if (ra.ref === rb.ref) {
      toast('Pick two different frames to compare.');
      return;
    }
    const short = (id) => $(id).selectedOptions[0].text.split(' · ')[0];
    const sn = $('diff-scale').value === 'sn';
    const badge = `Difference B − A (${short('diff-b')} − ${short('diff-a')})${sn ? ' · S/N' : ''}`;
    try {
      const cube = await withLoading('Loading pixel data…', () => getCube(view));
      if (current().view !== view || tool !== 'diff') return;
      const a = planeFor(cube, view, ra.ref);
      const b = planeFor(cube, view, rb.ref);
      let rgba;
      if (sn) {
        rgba = diffToRGBA(snDifference(a, b, varianceOf(cube, view, ra), varianceOf(cube, view, rb)), SN_FULL_SCALE);
      } else {
        const d = Float32Array.from(a, (v, k) => b[k] - v);
        rgba = diffToRGBA(d, ROBUST_FULL_SCALE * robustSigma(d));
      }
      showOverride({ kind: 'diff', rgba }, badge);
      report();
    } catch (err) {
      toast(err.message || "The difference image couldn't be made.");
    }
  }

  $('blink-go').addEventListener('click', toggleBlink);
  $('blink-rate').addEventListener('change', () => player.setBlinkRate(Number($('blink-rate').value)));
  $('diff-go').addEventListener('click', showDiff);
  $('diff-scale').addEventListener('change', () => {
    $('diff-legend-note').textContent = $('diff-scale').value === 'sn'
      ? 'Full colour = a 12σ change, judged with each pixel\'s own noise (variance plane). Faint flickers under 2.5σ are dimmed.'
      : 'Full colour = 12× the typical pixel-to-pixel scatter of the whole difference image.';
    if (tool === 'diff' && player.override?.kind === 'diff') showDiff();
  });
  $('ref-survey').addEventListener('change', () => { if (tool === 'reference') showReference(); });
  ['blink-a', 'blink-b', 'diff-a', 'diff-b'].forEach((id) => $(id).addEventListener('change', report));

  return {
    /** Refill the A/B selects for the current frame list (optionally restoring a, b). */
    fillSelects({ a = null, b = null } = {}) {
      const { view, frames, mode } = current();
      const opts = (withDeep) => [
        ...frames.map((f, i) => el('option', { value: String(i) }, frameOption(f, mode, i))),
        ...(withDeep && view.deep ? [el('option', { value: 'deep' }, 'Deep stack (all images)')] : []),
      ];
      const n = frames.length;
      const pick = (v, dflt) => String(Number.isInteger(v) && v < n ? v : dflt);
      const first = pick(a, 0);
      const last = pick(b, Math.max(0, n - 1));
      [['blink-a', false, first], ['blink-b', false, last], ['diff-a', true, first], ['diff-b', true, last]]
        .forEach(([id, deep, value]) => {
          $(id).replaceChildren(...opts(deep));
          $(id).value = value;
        });
    },
    get tool() {
      return tool;
    },
    /** Switch tool programmatically (keyboard shortcut or a shared link); `run` starts blink/diff. */
    async select(t, { run = false } = {}) {
      setTool(t);
      await selectTool(t);
      if (run && t === 'blink') startBlink();
      if (run && t === 'diff') await showDiff();
    },
    /** Blink or difference two given frames (indices into the current frame list). */
    async pair(t, a, b) {
      [`${t}-a`, `${t}-b`].forEach((id, k) => { $(id).value = String(k ? b : a); });
      await this.select(t, { run: true });
    },
    toggleBlink() {
      if (tool !== 'blink') {
        this.select('blink', { run: true });
        return;
      }
      toggleBlink();
    },
    /** Return to the plain animation (used by every transport action). */
    reset() {
      if (tool === 'animate') return;
      setTool('animate');
      applyTool('animate');
    },
  };
}
