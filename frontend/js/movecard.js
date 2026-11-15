// The "What moves here?" card in the Frame info tab (see movers.js for the numbers).
import { motionSummary, motionText } from './movers.js';
import { thenTargetFor } from './thennow.js';
import { project, propagate } from './gaia.js';
import { distanceSummary, distanceText, rulerPosition } from './distances.js';
import { printFlipbook } from './flipbook.js';
import { hostsIn, hostText } from './planets.js';
import { $, el, toast } from './ui.js';

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => object[]} ctx.featured  featured target list (for "try one of these")
 * @param {(f: object) => void} ctx.pick  open a featured target
 */
export function renderMoveCard(view, { player, featured, pick }) {
  const box = $('move-card');
  if (!box) return;
  const target = thenTargetFor(view);
  const sum = motionSummary(view, target?.star ? [target.star] : []);
  const text = motionText(sum);
  const children = [el('h3', {}, text.title), el('p', {}, text.body)];
  if (sum.kind === 'mover') {
    const btn = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Show me where');
    btn.addEventListener('click', () => {
      const mjd = player.frame && Number.isFinite(player.frame.mjd) ? player.frame.mjd : sum.star.epoch_mjd;
      const p = propagate(sum.star, mjd);
      const g = project(p.ra, p.dec, view);
      if (g) player.setMarks([{ kind: 'ring', x: g.x, y: g.y, r: 2.5, color: '#7CFC9A', label: 'this one moves' }]);
    });
    children.push(btn);
    if (!sum.star.published && (view.stacks || []).length >= 2) {
      const book = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Print it as a paper flip-book');
      book.addEventListener('click', () => {
        printFlipbook(view, sum.star, $('view-title').textContent || 'SkyBlink').catch((err) => toast(err.message));
      });
      children.push(book);
    }
  }
  if (sum.kind !== 'mover') {
    const movers = (featured() || []).filter((f) => f.kind === 'motion');
    if (movers.length) {
      children.push(el('div', { class: 'chips' }, ...movers.map((f) => {
        const b = el('button', { type: 'button', class: 'chip' }, f.name);
        b.addEventListener('click', () => pick(f));
        return b;
      })));
    }
  }
  hostsIn(view).forEach((h) => {
    children.push(el('h3', { class: 'planets-title' }, 'Planets hiding in a pixel'), el('p', {}, hostText(h)));
  });
  box.replaceChildren(...children);
  box.hidden = false;
}

const RULER_TICKS = [1, 10, 100, 1000, 10000, 100000];

/** "How far away is everything?": the picture's stars on a log distance ruler; tap to ring one. */
export function renderDistanceCard(view, { player }) {
  const box = $('distance-card');
  if (!box) return;
  const target = thenTargetFor(view);
  const sum = distanceSummary(view, target?.star ? [target.star] : []);
  const ruler = el('div', { class: 'ruler', role: 'group', 'aria-label': 'Distance ruler, 1 to 100,000 light-years, logarithmic' });
  RULER_TICKS.forEach((t) => {
    ruler.append(el('span', { class: 'ruler-tick', style: `left:${rulerPosition(t) * 100}%` }, t >= 1000 ? `${t / 1000}k` : String(t)));
  });
  sum.measured.forEach((m, i) => {
    const name = m.star.published ? 'WISE 0855' : `Gaia star, G ${Number(m.star.gmag).toFixed(1)}`;
    const dot = el('button', {
      type: 'button',
      class: `ruler-dot${m.moves ? ' moves' : ''}${i === 0 ? ' nearest' : ''}`,
      style: `left:${rulerPosition(m.ly) * 100}%`,
      'aria-label': `${name}: ${m.ly < 100 ? m.ly.toFixed(1) : Math.round(m.ly)} light-years${m.moves ? ', visibly moves' : ''}. Show it on the picture.`,
      title: `${m.ly < 100 ? m.ly.toFixed(1) : Math.round(m.ly).toLocaleString('en')} light-years`,
    });
    dot.addEventListener('click', () => player.setMarks([{ kind: 'ring', x: m.x, y: m.y, r: 2, color: '#ffd166', label: `${m.ly < 100 ? m.ly.toFixed(1) : Math.round(m.ly).toLocaleString('en')} ly` }]));
    ruler.append(dot);
  });
  box.replaceChildren(
    el('h3', {}, 'How far away is everything?'),
    ruler,
    el('p', { class: 'ruler-caption' }, 'light-years (each step is 10× farther) · green = moves visibly · tap a dot to find it'),
    el('p', {}, distanceText(sum)),
  );
  box.hidden = false;
}

/** "Describe this picture in words": text + keyboard-friendly object list (narrate.js). */
export function renderDescribeCard(view, { player, getCube }) {
  const box = $('describe-card');
  if (!box) return;
  const target = thenTargetFor(view);
  const extra = target?.star ? [target.star] : [];
  const go = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Describe this picture in words');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const [{ describeObjects, describeView }, cube] = await Promise.all([import('./narrate.js'), getCube(view)]);
      const objects = describeObjects(view, cube.deep(), extra);
      const text = describeView(view, objects, extra);
      const copy = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Copy as alt text');
      copy.addEventListener('click', async () => {
        const { copyText } = await import('./ui.js');
        toast((await copyText(text)) ? 'Description copied.' : 'Copy failed.');
      });
      const list = el('ol', { class: 'object-list' }, ...objects.map((o) => {
        const b = el('button', { type: 'button', class: 'linklike' }, `${o.where}`);
        b.addEventListener('click', () => player.setMarks([{ kind: 'ring', x: o.x, y: o.y, r: 2, color: '#ffd166', label: `#${o.rank}` }]));
        return el('li', {}, b, ` · ${o.star?.published ? 'WISE 0855' : o.star ? `Gaia star G ${Number(o.star.gmag).toFixed(1)}` : 'unmatched'} · ${o.motion}`);
      }));
      box.replaceChildren(el('h3', {}, 'This picture in words'), el('p', {}, text), copy,
        el('h4', {}, `Brightest objects (${objects.length}), brightest first`), list);
    } catch {
      go.disabled = false;
      toast("The pixel data didn't load, so the description isn't available right now.");
    }
  });
  box.replaceChildren(go);
  box.hidden = false;
}
