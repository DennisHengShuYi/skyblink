// No Dead Ends (brainstorm idea I20), part 1: while a live build runs, show an older
// survey's look at the same patch (clearly labelled as a different telescope) and offer
// featured views to watch meanwhile, without throwing the build away.
import { referenceUrl } from './compare.js';
import { $, el } from './ui.js';

const PIXEL_ARCSEC = 6.15;

const isFeaturedPosition = (featured, { ra, dec }) => featured.some((f) => Math.abs(f.ra - ra) < 1e-6 && Math.abs(f.dec - dec) < 1e-6);

/**
 * @param {{ra: number, dec: number, fov: number}} snapshot  the position being built
 * @param {object} ctx
 * @param {object[]} ctx.featured
 * @param {boolean} ctx.mock
 * @param {(f: object) => void} ctx.meanwhile  open a featured view, keeping the build
 */
export function showBuildPreview(snapshot, { featured, mock, meanwhile }) {
  const box = $('build-preview');
  box.hidden = true;
  $('build-meanwhile').replaceChildren();
  if (mock || isFeaturedPosition(featured, snapshot)) return;
  const grid = { npix: Math.round((snapshot.fov * 3600) / PIXEL_ARCSEC), scale_arcsec: PIXEL_ARCSEC };
  const img = $('build-preview-img');
  img.onerror = () => { box.hidden = true; };
  img.onload = () => { box.hidden = false; };
  img.src = referenceUrl({ ra: snapshot.ra, dec: snapshot.dec, grid }, '2mass', 240);
  $('build-meanwhile').replaceChildren(...featured.filter((f) => f.kind === 'motion').map((f) => {
    const b = el('button', { type: 'button', class: 'chip' }, `Meanwhile, watch ${f.name}`);
    b.addEventListener('click', () => meanwhile(f));
    return b;
  }));
}

/**
 * The "Ready: <name>" banner for a build the visitor walked away from.
 * park(view, snapshot) shows it (and the tab title); onShow({view, snapshot}) opens it.
 */
export function createReadyBanner({ onShow }) {
  let ready = null;
  const hide = () => { ready = null; $('ready-banner').hidden = true; };
  $('ready-show').addEventListener('click', () => {
    const r = ready;
    hide();
    if (r) onShow(r);
  });
  $('ready-dismiss').addEventListener('click', hide);
  return {
    park(view, snapshot) {
      const label = snapshot.target || `RA ${view.ra.toFixed(3)}, Dec ${view.dec.toFixed(3)}`;
      ready = { view, snapshot };
      document.title = `Ready: ${label} · SkyBlink`;
      $('ready-msg').textContent = `Ready: ${label}. SkyBlink finished fetching it while you looked around.`;
      $('ready-banner').hidden = false;
    },
  };
}
