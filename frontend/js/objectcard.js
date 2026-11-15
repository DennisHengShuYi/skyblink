// "What am I looking at?" card for a clicked pixel: nearest Gaia star at the frame's
// date, described in plain words (describe.js), plus listen / spectrum buttons.
import { el } from './ui.js';
import { starGeometry, frameSpan, nearestStar as nearestGeo } from './gaia.js';
import { starType, distanceText, speedText, NOT_IN_GAIA } from './describe.js';

const MATCH_PX = 2;
const EMPTY_SNR = 5;

/** The Gaia star nearest grid pixel (x, y) at `mjd`, within `tolPx`; null if none. */
export function nearestStar(view, x, y, mjd, tolPx = MATCH_PX) {
  const span = { start: mjd, end: mjd };
  const geo = starGeometry(view, mjd, span, 1);
  return nearestGeo(geo, x, y, tolPx)?.star || null;
}

/**
 * Render the card into `container`. `ctx`:
 * {view, pixel, frames, value: {value, sigma}|null, caption, untrackedMover: Find|null, spectrumWords: Promise<string|null>,
 *  onHearBrightness, onHearSpectrum, onShowSpectrum}
 */
export function renderObjectCard(container, ctx) {
  const { view, pixel, frames } = ctx;
  const mjd = frameSpan(frames || view.stacks || []).start;
  // A mover that Gaia doesn't know (e.g. WISE 0855) may sit on an unrelated background star.
  const star = ctx.untrackedMover ? null : nearestStar(view, pixel.x, pixel.y, Number.isFinite(mjd) ? mjd : 61000);
  const snr = ctx.value && ctx.value.sigma > 0 ? ctx.value.value / ctx.value.sigma : null;
  const lines = [];
  let title;
  if (star) {
    const type = starType(star);
    title = type ? type.label : 'A star catalogued by Gaia';
    if (type) lines.push(type.blurb);
    [distanceText(star.parallax), speedText(star)].filter(Boolean).forEach((t) => lines.push(t));
  } else if (ctx.untrackedMover) {
    title = `Moving object — about ${ctx.untrackedMover.arcsecPerYr.toFixed(1)}″ a year`;
    lines.push(NOT_IN_GAIA);
  } else if (snr !== null && snr < EMPTY_SNR) {
    title = 'Mostly empty sky';
    lines.push('Nothing bright enough to stand out here. Try clicking one of the dots.');
  } else {
    title = 'Something Gaia has not catalogued';
    lines.push(NOT_IN_GAIA);
  }
  if (ctx.caption) lines.unshift(ctx.caption);
  const words = el('p', { class: 'card-words hint' }, 'Reading its infrared colours…');
  const hearB = el('button', { type: 'button', class: 'btn btn-ghost small' }, '🔊 Hear its brightness');
  const hearS = el('button', { type: 'button', class: 'btn btn-ghost small' }, '🔊 Hear its spectrum');
  const spec = el('button', { type: 'button', class: 'btn btn-ghost small' }, 'Show its spectrum');
  const soundText = el('p', { class: 'hint sound-text', 'aria-live': 'polite' });
  hearB.addEventListener('click', () => ctx.onHearBrightness(soundText));
  hearS.addEventListener('click', () => ctx.onHearSpectrum(soundText));
  spec.addEventListener('click', () => ctx.onShowSpectrum());
  container.replaceChildren(el('section', { class: 'object-card', 'aria-label': 'What am I looking at?' },
    el('h3', {}, 'What am I looking at?'),
    el('p', { class: 'card-title' }, el('strong', {}, title)),
    ...lines.map((t) => el('p', {}, t)),
    words,
    el('div', { class: 'card-actions' }, hearB, hearS, spec),
    soundText,
    el('p', { class: 'hint' }, 'Spectra are a visualization, not science-grade measurements.')));
  Promise.resolve(ctx.spectrumWords).then((w) => {
    if (w) words.textContent = w;
    else words.remove();
  }).catch(() => words.remove());
  return star;
}
