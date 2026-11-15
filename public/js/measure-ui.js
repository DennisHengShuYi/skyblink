// "Measure it" tool: two taps on a vetted mover, snapped to the star, then the sums.
import { planeFor } from './cube.js';
import { stackVariance } from './photometry.js';
import { snapToStar, motionBetween, resultText, MEASURE_PAIRS } from './measure.js';
import { $, el, toast } from './ui.js';

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object, frames: object[], mode: string}} ctx.current
 * @param {(view: object) => Promise<object>} ctx.getCube
 * @param {(text: string|null) => void} ctx.setBadge
 */
export function createMeasure({ player, current, getCube, setBadge }) {
  let job = null; // {view, pair, step: 'a'|'b'|'done', a, b}

  const pairFor = (view) => (view ? MEASURE_PAIRS[view.key] || null : null);

  function sync(view) {
    const btn = document.querySelector('#tool-group [data-tool="measure"]');
    if (btn) btn.hidden = !pairFor(view);
  }

  function stackOf(frames, w) {
    return frames.findIndex((f) => f.window === w && !Number.isInteger(f.i));
  }

  function say(step, more = []) {
    $('measure-steps').replaceChildren(el('p', { class: 'measure-step' }, step), ...more);
  }

  function goTo(which) {
    const { frames, view } = current();
    const w = which === 'a' ? job.pair.a : job.pair.b;
    const k = stackOf(frames, w);
    player.setIndex(k);
    const s = view.stacks.find((x) => x.window === w);
    setBadge(`Measure it · ${s.date.slice(0, 7)}`);
  }

  function marks() {
    const m = [];
    if (job.a) m.push({ kind: 'ring', x: job.a.x, y: job.a.y, r: 1.2, color: '#7CFC9A', label: 'first' });
    if (job.b) m.push({ kind: 'ring', x: job.b.x, y: job.b.y, r: 1.2, color: '#ffd166', label: 'second' });
    if (job.a && job.b) {
      // Drawn 10× longer so a 1–2 pixel step is easy to see.
      m.push({ kind: 'arrow', x0: job.a.x, y0: job.a.y, x1: job.a.x + (job.b.x - job.a.x) * 10, y1: job.a.y + (job.b.y - job.a.y) * 10, color: '#ffffff', label: 'shift ×10' });
    }
    return m;
  }

  async function show() {
    const { view, mode } = current();
    const pair = pairFor(view);
    if (!pair) return;
    if (mode !== 'stack') {
      say('Switch "Frames to show" to "Stacked per survey window" first, then pick Measure it again.');
      return;
    }
    job = { view, pair, step: 'a', a: null, b: null };
    player.pause();
    goTo('a');
    player.setMarks([]);
    const s = view.stacks.find((x) => x.window === pair.a);
    say(`Step 1 of 2: tap ${pair.name} in this ${s.date.slice(0, 7)} picture. Your tap snaps to the middle of the star.`);
  }

  async function tap(p) {
    if (!job || job.step === 'done') return false;
    const { view } = current();
    if (view !== job.view) return false;
    let cube;
    try {
      cube = await getCube(view);
    } catch {
      toast("The pixel data didn't load, so measuring isn't possible right now.");
      return true;
    }
    const w = job.step === 'a' ? job.pair.a : job.pair.b;
    const snap = snapToStar(planeFor(cube, view, `s${w}`), view.grid.npix, p.x, p.y, stackVariance(cube, view, w));
    if (!snap || snap.masked > 2) {
      toast(snap ? 'That spot is a saturated star core: pick the moving star instead.' : 'No star there: tap right on the dot.');
      return true;
    }
    if (job.step === 'a') {
      job.a = snap;
      job.step = 'b';
      goTo('b');
      player.setMarks(marks());
      const s = view.stacks.find((x) => x.window === job.pair.b);
      say(`Step 2 of 2: now tap the same star in the ${s.date.slice(0, 7)} picture, about a year later. The green ring shows where it was.`);
      return true;
    }
    job.b = snap;
    job.step = 'done';
    player.setMarks(marks());
    const sa = view.stacks.find((x) => x.window === job.pair.a);
    const sb = view.stacks.find((x) => x.window === job.pair.b);
    const m = motionBetween(job.a, job.b, sa.mjd, sb.mjd, view.grid.scale_arcsec);
    const r = resultText(m, job.pair);
    const again = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Measure again');
    again.addEventListener('click', show);
    say(`You measured ${job.pair.name} moving ${m.arcsecPerYear.toFixed(1)}″ a year.`, [
      el('p', {}, r.sums),
      el('p', { class: r.agrees ? 'good' : 'warn' }, r.verdict),
      el('p', {}, r.speed),
      el('p', { class: 'hint' }, 'This is a classroom measurement from two blurry SPHEREx pictures. The ± includes about 0.2 pixels for how well two pictures line up. Both pictures are from the same season, so Earth\'s yearly wobble (parallax) cancels out.'),
      again,
    ]);
    return true;
  }

  function stop() {
    if (!job) return;
    job = null;
    player.setMarks([]);
  }

  return { sync, show, stop, tap, get active() { return Boolean(job) && job.step !== 'done'; } };
}
