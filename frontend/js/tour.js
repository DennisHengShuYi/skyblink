// Guided tour runner: a small coach panel that walks through a featured target's steps
// (tours.js) and acts each one out on the page. Back / Next / Exit; Esc exits.
import { $ } from './ui.js';
import { TOURS } from './tours.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * ctx: {player, compare, ensureStacks(), selectSideTab(id), setGaia(on), pulse()}
 * Returns false when the slug has no tour.
 */
export function startTour(slug, ctx) {
  const steps = TOURS[slug];
  if (!steps) return false;
  const panel = $('tour');
  let k = 0;

  async function act(action) {
    if (!action) return;
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
    act(steps[k].action);
  }

  function close() {
    panel.hidden = true;
    document.removeEventListener('keydown', onKey);
    ctx.compare.reset();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  $('tour-back').onclick = () => { if (k > 0) { k -= 1; show(); } };
  $('tour-next').onclick = () => { if (k < steps.length - 1) { k += 1; show(); } else close(); };
  $('tour-exit').onclick = close;
  document.addEventListener('keydown', onKey);
  ctx.ensureStacks();
  panel.hidden = false;
  show();
  $('tour-next').focus();
  return true;
}
