// "SPHEREx's year" side tab: the year clock (where Earth was for each picture), why the
// pictures bunch, the next expected look (+ calendar reminder), and the Planet X lab
// ("blink your thumb": how far a far-away planet would jump between this patch's visits).
import {
  earthLongitude, bunchingText, nextLook, nextLookIcs, monthYear, parallaxJump, dateToMjd, MOON_ARCSEC, AU_PER_PC,
} from './skyclock.js';
import { downloadBlob } from './exporter.js';
import { $, el } from './ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAB_STOPS = [
  { au: 30, name: 'Neptune (30 AU)' },
  { au: 40, name: 'Pluto (~35–49 AU)' },
  { au: 500, name: 'a hypothetical Planet Nine (~500 AU)' },
  { au: 5000, name: 'a comet cloud object (5,000 AU)' },
  { au: AU_PER_PC * 1.83, name: "Barnard's Star (6 light-years)" },
];

function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
  return n;
}

function clock(view, frameMjd) {
  const s = svg('svg', { viewBox: '-110 -110 220 220', class: 'year-clock', role: 'img',
    'aria-label': 'Simplified diagram: the Sun in the middle, Earth\'s orbit around it, and a dot where Earth was for each SPHEREx picture of this patch.' });
  s.append(svg('circle', { cx: 0, cy: 0, r: 80, fill: 'none', stroke: 'rgba(169,179,209,0.35)', 'stroke-dasharray': '3 4' }));
  s.append(svg('circle', { cx: 0, cy: 0, r: 9, fill: '#ffd166' }));
  const pos = (mjd) => {
    const a = earthLongitude(mjd);
    return { x: 80 * Math.cos(a), y: -80 * Math.sin(a) };
  };
  ['Mar', 'Jun', 'Sep', 'Dec'].forEach((m, i) => {
    const p = pos(dateToMjd(new Date(Date.UTC(2026, 2 + 3 * i, 21))));
    const t = svg('text', { x: p.x * 1.22, y: p.y * 1.22 + 3, 'text-anchor': 'middle', class: 'clock-month' });
    t.textContent = m;
    s.append(t);
  });
  (view.visits || []).forEach((v) => {
    if (!Number.isFinite(v.mjd)) return;
    const p = pos(v.mjd);
    s.append(svg('circle', { cx: p.x, cy: p.y, r: 3, fill: '#5ce1ff', opacity: 0.8 }));
  });
  if (Number.isFinite(frameMjd)) {
    const p = pos(frameMjd);
    s.append(svg('circle', { cx: p.x, cy: p.y, r: 7, fill: 'none', stroke: '#7CFC9A', 'stroke-width': 2.5 }));
  }
  return s;
}

function labLine(view, au) {
  const ws = (view.stacks || []).filter((w) => Number.isFinite(w.mjd));
  if (ws.length < 2) return 'This band has only one visit so far, so there is no pair of dates to compare yet.';
  // The pair of visits closest to half a year apart: the biggest wobble.
  let best = null;
  ws.forEach((a, i) => ws.slice(i + 1).forEach((b) => {
    const j = parallaxJump(view.ra, view.dec, a.mjd, b.mjd, au);
    if (!best || j > best.j) best = { a, b, j };
  }));
  const px = best.j / view.grid.scale_arcsec;
  const half = (view.grid.npix * view.grid.scale_arcsec) / 2;
  const sizeText = best.j >= 120 ? `${(best.j / 60).toFixed(1)}′ (${(best.j / MOON_ARCSEC).toFixed(2)} Moon widths)` : `${best.j.toFixed(2)}″`;
  const verdict = best.j > half
    ? 'It would jump right out of this picture.'
    : px >= 0.5 ? 'It stays in the picture, and the jump is big enough to see by blinking.' : 'Too small to see in SPHEREx\'s 6″ pixels.';
  return `Between the ${best.a.date.slice(0, 7)} and ${best.b.date.slice(0, 7)} visits Earth swung round its orbit, so it would appear to jump ${sizeText} = ${px >= 10 ? Math.round(px) : px.toFixed(2)} SPHEREx pixels. ${verdict}`;
}

/** @param {{player: import('./player.js').Player, current: () => {view: object, frame: object}}} ctx */
export function createSkyClock({ current }) {
  let labIndex = 2;

  function render() {
    const { view, frame } = current();
    const box = $('year-panel');
    if (!view || !box) return;
    const today = dateToMjd(new Date());
    const look = nextLook(view, today);
    const name = $('view-title').textContent || 'this patch';
    const ics = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Add to my calendar');
    ics.addEventListener('click', () => {
      downloadBlob(new Blob([nextLookIcs(name, view.det, look, today)], { type: 'text/calendar' }), 'skyblink-next-look.ics');
    });
    const slider = el('input', { type: 'range', id: 'lab-distance', min: '0', max: String(LAB_STOPS.length - 1), step: '1', value: String(labIndex), 'aria-describedby': 'lab-out' });
    const stopName = el('p', { class: 'lab-stop' }, `Something as far away as ${LAB_STOPS[labIndex].name}:`);
    const out = el('p', { id: 'lab-out', 'aria-live': 'polite' }, labLine(view, LAB_STOPS[labIndex].au));
    slider.addEventListener('input', () => {
      labIndex = Number(slider.value);
      stopName.textContent = `Something as far away as ${LAB_STOPS[labIndex].name}:`;
      out.textContent = labLine(view, LAB_STOPS[labIndex].au);
    });
    box.replaceChildren(
      el('h3', {}, 'Where SPHEREx was for each picture'),
      clock(view, frame && frame.mjd),
      el('p', { class: 'hint' }, 'Simplified, top-down: the Sun in the middle, a blue dot where Earth (and SPHEREx with it) was for each picture, a green ring for the picture on screen.'),
      el('p', {}, bunchingText(view)),
      ...(look ? [el('p', {}, `Next look in this band: around ${monthYear(look.mjd)}, give or take 3 weeks, if the mission continues. New pictures reach the archive some weeks later.`), ics] : []),
      el('h3', {}, 'Planet X lab: blink your thumb'),
      el('p', {}, 'Hold up a thumb at arm\'s length and close one eye, then the other: your thumb jumps against the background. Nearby things jump more. SPHEREx does the same from opposite sides of Earth\'s orbit, so a far-off planet would jump between visits while the stars stay put.'),
      el('label', { for: 'lab-distance' }, 'Distance'), slider, stopName, out,
      el('p', { class: 'hint' }, 'This shows only the jump caused by Earth\'s own motion (parallax). Planet Nine is hypothetical, and SkyBlink can\'t search for it: a patch this small, and probably far too faint.'),
    );
  }

  return { render, onFrame: () => { if (!$('panel-year').hidden) render(); } };
}
