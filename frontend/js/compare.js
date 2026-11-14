// Compare tools: Animation, Blink A/B (1 Hz), Difference (server diff PNG) and
// Deep stack. The difference is computed in the browser from the view's float16
// cube (loaded lazily on first use). Owns the tool radio group, its panels and the stage badge.
import { loadImage } from './player.js';
import { loadCube, planeFor, differenceCanvas } from './cube.js';
import { $, el, toast, setupRadioGroup, frameOption } from './ui.js';

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object, frames: object[], mode: string}} ctx.current
 */
export function createCompare({ player, current }) {
  let tool = 'animate';
  const setTool = setupRadioGroup($('tool-group'), 'tool', (t) => selectTool(t));

  function setBadge(text) {
    $('stage-badge').hidden = !text;
    $('stage-badge').textContent = text || '';
  }

  function setBlinkButton(on) {
    $('blink-go').textContent = on ? 'Stop blinking' : 'Start blinking';
    $('blink-go').setAttribute('aria-pressed', String(on));
  }

  function applyTool(t) {
    tool = t;
    document.querySelectorAll('.tool-panel').forEach((p) => { p.hidden = p.dataset.panel !== t; });
    player.stopBlink();
    player.clearOverride();
    setBlinkButton(false);
    setBadge(null);
    $('frame-label').hidden = false;
  }

  function showOverride(image, badge) {
    player.setOverride(image, badge);
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

  async function showStill(src, badge) {
    try {
      const img = await withLoading('Loading image…', () => loadImage(src));
      showOverride(img, badge);
    } catch {
      toast("That image couldn't be loaded. Please try again.");
    }
  }

  async function selectTool(t) {
    applyTool(t);
    const { view } = current();
    if (t === 'deep' && view?.deep?.png) {
      player.pause();
      await showStill(view.deep.png, `Deep stack · ${view.deep.n ?? ''} images`);
    }
  }

  function toggleBlink() {
    if (player.blinkPair) {
      player.stopBlink();
      setBlinkButton(false);
      setBadge(null);
      return;
    }
    const a = Number($('blink-a').value);
    const b = Number($('blink-b').value);
    if (a === b) {
      toast('Pick two different frames to blink.');
      return;
    }
    player.startBlink(a, b);
    setBlinkButton(true);
    setBadge(`Blinking frame ${a + 1} ↔ ${b + 1}`);
  }

  async function showDiff() {
    const { view, frames, mode } = current();
    const ref = (v) => {
      if (v === 'deep') return 'deep';
      const f = frames[Number(v)];
      return mode === 'visits' ? `v${f.i}` : `s${f.window}`;
    };
    const a = ref($('diff-a').value);
    const b = ref($('diff-b').value);
    if (a === b) {
      toast('Pick two different frames to compare.');
      return;
    }
    const short = (id) => $(id).selectedOptions[0].text.split(' · ')[0];
    const badge = `Difference B − A (${short('diff-b')} − ${short('diff-a')})`;
    try {
      const cube = await withLoading('Loading pixel data…', () => loadCube(view));
      if (current().view !== view || tool !== 'diff') return;
      const canvas = differenceCanvas(planeFor(cube, view, a), planeFor(cube, view, b), cube.P);
      showOverride(canvas, badge);
    } catch (err) {
      toast(err.message || "The difference image couldn't be made.");
    }
  }

  $('blink-go').addEventListener('click', toggleBlink);
  $('diff-go').addEventListener('click', showDiff);

  return {
    /** Refill the A/B selects for the current frame list. */
    fillSelects() {
      const { view, frames, mode } = current();
      const opts = (withDeep) => [
        ...frames.map((f, i) => el('option', { value: String(i) }, frameOption(f, mode, i))),
        ...(withDeep && view.deep ? [el('option', { value: 'deep' }, 'Deep stack (all images)')] : []),
      ];
      const last = String(Math.max(0, frames.length - 1));
      [['blink-a', false, '0'], ['blink-b', false, last], ['diff-a', true, '0'], ['diff-b', true, last]]
        .forEach(([id, deep, value]) => {
          $(id).replaceChildren(...opts(deep));
          $(id).value = value;
        });
    },
    /** Return to the plain animation (used by every transport action). */
    reset() {
      if (tool === 'animate') return;
      setTool('animate');
      applyTool('animate');
    },
  };
}
