// Finds tab and the numbered rings on the image. Wording lives in finds-text.js.
import { el } from './ui.js';
import { describeFind, emptyFindsText } from './finds-text.js';

const RING_COLOURS = { moving: '#5ce1ff', variable: '#ffd166' };

/** Fill the Finds list. `onPick(find)` and `onHear(find)` run on the entry's buttons. */
export function renderFinds(listEl, finds, view, { onPick, onHear }) {
  if (!finds.length) {
    listEl.replaceChildren(el('li', { class: 'hint' }, emptyFindsText(view)));
    return;
  }
  listEl.replaceChildren(...finds.map((f) => {
    const { title, body } = describeFind(f, view);
    const show = el('button', { type: 'button', class: 'find-main' },
      el('span', { class: `find-num ${f.kind}`, 'aria-hidden': 'true' }, String(f.id)),
      el('span', { class: 'find-text' }, el('strong', {}, title), el('span', {}, ` ${body}`)));
    show.addEventListener('click', () => onPick(f));
    const hear = el('button', { type: 'button', class: 'btn btn-ghost small', 'aria-label': `Hear find ${f.id}` }, '🔊');
    hear.addEventListener('click', () => onHear(f));
    return el('li', { class: 'find' }, show, hear);
  }));
}

/** Player decorator drawing numbered rings on the finds (when enabled). */
export function findsDecorator(getFinds, isOn) {
  return (ctx, player) => {
    const finds = getFinds();
    if (!isOn() || !finds.length || player.override) return;
    const r = Math.max(9, player.pixelSize * 2.6);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = `bold ${Math.max(11, Math.round(r * 0.7))}px system-ui, sans-serif`;
    finds.forEach((f) => {
      const p = player.toScreen(f.x + 0.5, f.y + 0.5);
      ctx.strokeStyle = RING_COLOURS[f.kind] || '#fff';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillText(String(f.id), p.x + r * 0.75, p.y - r * 0.75);
    });
    ctx.restore();
  };
}
