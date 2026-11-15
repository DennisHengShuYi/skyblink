// Guided tour runner: a small coach panel that walks through a featured target's steps
// (tours.js) and acts each one out on the page. Back / Next / Exit; Esc exits.
import { $ } from './ui.js';
import { TOURS } from './tours.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let openTour = null; // the one tour that may be open at a time

/** Close the open tour, if any. Safe to call at any time (view change, going home). */
export function closeTour() {
  if (openTour) openTour.close();
}

/**
 * ctx: {player, compare, ensureStacks(), selectSideTab(id), setGaia(on), pulse()}
 * Returns {close} for the tour, or null when the slug has no tour. Starting a tour closes any
 * tour already open; Back/Next clicks run one at a time, in order.
 */
export async function startTour(slug, ctx) {
  const steps = TOURS[slug];
  if (!steps) return null;
  closeTour();
  const panel = $('tour');
  let k = 0;
  let closed = false;
  let queue = Promise.resolve(); // serialises step actions so fast clicks can't overlap

  async function act(action) {
    if (!action || closed) return;
    const { player, compare } = ctx;
    const n = player.frames.length;
    const idx = (i) => Math.min(Math.max(0, i), n - 1);
    switch (action.type) {
      case 'frame': compare.reset(); player.pause(); player.setIndex(idx(action.index)); break;
      case 'play':
        compare.reset();
        if (reducedMotion()) player.setIndex(n - 1);
        else player.play();
        break;
      case 'pause': player.pause(); break;
      case 'diff': await compare.pair('diff', idx(action.a), idx(action.b)); break;
      case 'blink':
        if (reducedMotion()) { compare.reset(); player.setIndex(idx(action.b)); } else await compare.pair('blink', idx(action.a), idx(action.b));
        break;
      case 'pulse': ctx.pulse(); break;
      case 'tab': ctx.selectSideTab(`tab-${action.tab}`); break;
      case 'gaia': ctx.setGaia(action.on !== false); break;
      case 'colour': await compare.select('colour'); break;
      default: break;
    }
  }

  function show() {
    $('tour-step').textContent = `Step ${k + 1} of ${steps.length}`;
    $('tour-text').textContent = steps[k].text;
    $('tour-back').disabled = k === 0;
    $('tour-next').textContent = k === steps.length - 1 ? 'Finish' : 'Next';
    const step = steps[k];
    queue = queue.then(() => act(step.action)).catch(() => {});
  }

  function close() {
    if (closed) return;
    closed = true;
    if (openTour === handle) openTour = null;
    panel.hidden = true;
    document.removeEventListener('keydown', onKey);
    ctx.compare.reset();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  const handle = { close };
  $('tour-back').onclick = () => { if (k > 0) { k -= 1; show(); } };
  $('tour-next').onclick = () => { if (k < steps.length - 1) { k += 1; show(); } else close(); };
  $('tour-exit').onclick = close;
  document.addEventListener('keydown', onKey);
  openTour = handle;
  await ctx.ensureStacks(); // stacked frames must be loaded before step actions run
  if (closed) return handle; // closed (view change, Esc, another tour) while stacks loaded
  panel.hidden = false;
  show();
  $('tour-next').focus();
  return handle;
}
