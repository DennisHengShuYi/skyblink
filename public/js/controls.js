// Viewer controls that only talk to the player: Display (stretch, colours, smooth,
// brightness, contrast), Overlays (target marker, flags, Gaia filters), the colour
// bar, the hover readout, the Gaia star tooltip and the zoom buttons.
import { STRETCH_KINDS, STRETCH_LABELS, COLORMAPS, COLORMAP_LABELS, colormapLut, colorbarTicks } from './render.js';
import { unproject, totalPm } from './gaia.js';
import { DEFAULT_DISPLAY } from './player.js';
import { $, el } from './ui.js';

const STAR_CAP = 400; // backend MAX_STARS: the brightest 400 are returned

export function fmtRa(ra) {
  const h = ra / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(2).padStart(5, '0')}`;
}

export function fmtDec(dec) {
  const sign = dec < 0 ? '−' : '+';
  const a = Math.abs(dec);
  const dd = Math.floor(a);
  const mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${sign}${String(dd).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${ss.toFixed(1).padStart(4, '0')}`;
}

const fmtVal = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(3));
const fmtTick = (v) => (v === 0 ? '0' : String(+v.toPrecision(2)));

/**
 * @param {import('./player.js').Player} player
 * @param {object} ctx  current() → {view}; update(patch) → URL state
 */
export function createControls(player, { current, update }) {
  $('disp-stretch').replaceChildren(...STRETCH_KINDS.map((k) => el('option', { value: k }, STRETCH_LABELS[k])));
  $('disp-cmap').replaceChildren(...Object.keys(COLORMAPS).map((k) => el('option', { value: k }, COLORMAP_LABELS[k])));

  function drawColorbar() {
    const view = current().view;
    const c = $('colorbar-canvas');
    const ctx = c.getContext('2d');
    const lut = colormapLut(player.display.cmap);
    const { brightness, contrast } = player.display;
    for (let x = 0; x < c.width; x += 1) {
      const t = Math.min(1, (x / (c.width - 1)) * brightness) ** contrast;
      const k = Math.round(t * 255) * 3;
      ctx.fillStyle = `rgb(${lut[k]}, ${lut[k + 1]}, ${lut[k + 2]})`;
      ctx.fillRect(x, 0, 1, c.height);
    }
    const ticks = view?.stretch ? colorbarTicks(view.stretch, player.display.stretch) : [];
    const unit = view?.stretch?.unit || 'MJy/sr';
    $('colorbar-ticks').replaceChildren(...ticks.map((t, i) => {
      const s = el('span', {}, `${fmtTick(t.value)}${i === ticks.length - 1 ? ` ${unit}` : ''}`);
      s.style.left = `${Math.min(1, t.pos * brightness) ** contrast * 100}%`;
      return s;
    }));
    $('colorbar').hidden = !ticks.length;
  }

  function syncDisplayInputs() {
    const d = player.display;
    $('disp-stretch').value = d.stretch;
    $('disp-cmap').value = d.cmap;
    $('disp-smooth').checked = d.smooth;
    $('disp-bright').value = String(d.brightness);
    $('disp-contrast').value = String(d.contrast);
  }

  function setDisplay(changes) {
    player.setDisplay(changes);
    drawColorbar();
    const d = player.display;
    update({ stretch: d.stretch, cmap: d.cmap, smooth: d.smooth, bright: d.brightness, contrast: d.contrast });
  }

  function syncStarInputs() {
    const on = player.overlays.stars;
    $('ov-stars').checked = on;
    document.querySelectorAll('.star-opt').forEach((n) => n.classList.toggle('disabled', !on));
    $('star-gmax').value = String(player.overlays.gmax);
    $('star-gmax-out').textContent = player.overlays.gmax >= 21 ? 'all' : String(player.overlays.gmax);
    $('star-minpm').value = String(player.overlays.minPm);
    const view = current().view;
    const n = (view?.stars || []).length;
    $('star-note').textContent = `${n >= STAR_CAP ? `Showing the brightest ${STAR_CAP} Gaia stars (the catalogue has more here). ` : ''}`
      + 'Ticks sit just outside each Gaia star so they never hide it. Arrows show motion over the time span (stars moving ≥ 20 mas/yr). Hover a star for details.';
  }

  function setStars(on) {
    player.setOverlay('stars', on);
    syncStarInputs();
    update({ stars: on });
  }

  /** Flags exist per image only: the checkbox is disabled in stacked mode. */
  function syncFlags(mode) {
    const stacked = mode !== 'visits';
    $('ov-flags').disabled = stacked;
    $('flags-label').classList.toggle('disabled', stacked);
    $('flags-label').title = stacked ? 'Flags are per image: switch to "Every image" to see them.' : '';
  }

  // ---------- hover readout and star tooltip ----------

  function onHover(pixel, star, evt) {
    const view = current().view;
    if (!view || !pixel) {
      $('readout').textContent = 'Hover over the image to read pixel values.';
      $('star-tip').hidden = true;
      return;
    }
    const sky = unproject(pixel.x, pixel.y, view);
    const v = player.valueAt(pixel.x, pixel.y);
    let val = ' · loading values…';
    if (v && Number.isFinite(v.value)) {
      const sn = Number.isFinite(v.sigma) && v.sigma > 0 ? ` · S/N ${(v.value / v.sigma).toFixed(1)}` : '';
      val = ` · ${fmtVal(v.value)} ${view.stretch?.unit || 'MJy/sr'}${sn}`;
    } else if (v) {
      val = ' · masked';
    } else if (player.override) {
      val = '';
    }
    $('readout').textContent = `Pixel (${pixel.x}, ${pixel.y}) · RA ${fmtRa(sky.ra)} Dec ${fmtDec(sky.dec)}${val}`;
    const tip = $('star-tip');
    if (!star || !evt) {
      tip.hidden = true;
      return;
    }
    const s = star.star;
    const g = Number(s.gmag);
    tip.replaceChildren(
      el('b', {}, `Gaia DR3 ${s.source_id || ''}`), el('br'),
      `G = ${Number.isFinite(g) ? g.toFixed(2) : '?'} · motion ${(totalPm(s) * 1000).toFixed(1)} mas/yr`, el('br'),
      `(${Number(s.pmra || 0).toFixed(1)}, ${Number(s.pmdec || 0).toFixed(1)}) mas/yr east, north`);
    const rect = $('stage').getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    tip.hidden = false;
    tip.style.left = `${Math.min(x + 14, rect.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 10)}px`;
  }

  // ---------- events ----------

  $('disp-stretch').addEventListener('change', (e) => setDisplay({ stretch: e.target.value }));
  $('disp-cmap').addEventListener('change', (e) => setDisplay({ cmap: e.target.value }));
  $('disp-smooth').addEventListener('change', (e) => setDisplay({ smooth: e.target.checked }));
  $('disp-bright').addEventListener('input', (e) => setDisplay({ brightness: Number(e.target.value) }));
  $('disp-contrast').addEventListener('input', (e) => setDisplay({ contrast: Number(e.target.value) }));
  $('disp-reset').addEventListener('click', () => {
    player.setDisplay({ ...DEFAULT_DISPLAY });
    syncDisplayInputs();
    setDisplay({});
  });
  $('cross-style').addEventListener('change', (e) => {
    player.setOverlay('cross', e.target.value);
    update({ cross: e.target.value });
  });
  $('ov-flags').addEventListener('change', (e) => {
    player.setOverlay('flags', e.target.checked);
    update({ flags: e.target.checked });
  });
  $('ov-stars').addEventListener('change', (e) => setStars(e.target.checked));
  $('star-gmax').addEventListener('input', (e) => {
    player.setOverlay('gmax', Number(e.target.value));
    syncStarInputs();
    update({ gmax: player.overlays.gmax });
  });
  $('star-minpm').addEventListener('change', (e) => {
    player.setOverlay('minPm', Number(e.target.value));
    update({ minPm: player.overlays.minPm });
  });
  $('exag').addEventListener('input', () => {
    $('exag-out').textContent = `×${$('exag').value}`;
    player.setOverlay('exaggeration', Number($('exag').value));
  });
  $('zoom-in').addEventListener('click', () => player.zoomBy(1.5));
  $('zoom-out').addEventListener('click', () => player.zoomBy(1 / 1.5));
  $('zoom-fit').addEventListener('click', () => player.resetZoom());

  return {
    onHover,
    drawColorbar,
    syncFlags,
    syncStarInputs,
    toggleStars: () => setStars(!player.overlays.stars),
    /** Apply settings from the URL state to the player and the inputs. */
    applyState(s) {
      player.display = { smooth: s.smooth, brightness: s.bright, contrast: s.contrast, cmap: s.cmap, stretch: s.stretch };
      player.overlays = { ...player.overlays, stars: s.stars, flags: s.flags, gmax: s.gmax, minPm: s.minPm, cross: s.cross };
      $('cross-style').value = s.cross;
      $('ov-flags').checked = s.flags;
      syncDisplayInputs();
      syncStarInputs();
      drawColorbar();
    },
  };
}
