// Spectrum and light-curve panels for the selected pixel: aperture size, colour-by,
// log scale, "add other bands" (lazy cube downloads), hover tooltips and CSV export.
import { gatherSpectrum, extraBands, cubeMegabytes } from './spectrum-data.js';
import { pixelSeries } from './photometry.js';
import {
  drawSpectrum, drawLightCurve, detectorsIn, windowsIn, DET_COLORS, WINDOW_COLORS, viridisGradient, mjdLabel,
} from './spectrum.js';
import { interactiveChart } from './chart.js';
import { toCsv } from './csv.js';
import { downloadText, fileStem } from './exporter.js';
import { $, el, toast } from './ui.js';

const BANDS = { D1: '0.75–1.09', D2: '1.10–1.62', D3: '1.63–2.41', D4: '2.42–3.82', D5: '3.83–4.41', D6: '4.42–5.00' };
const CSV_COLUMNS = ['image', 'band', 'wavelength_um', 'mjd', 'date', 'survey_window', 'flux_MJy_sr', 'error_MJy_sr', 'saturated_core'];

const csvRows = (pts) => pts.map((p) => [
  p.i, p.det, p.um?.toFixed(4), p.mjd?.toFixed(5), Number.isFinite(p.mjd) ? mjdLabel(p.mjd) : '',
  p.window, p.flux, p.err, p.saturated ? 1 : 0,
]);

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object, frame: object, target: string}} ctx.current
 * @param {(view: object) => Promise<object>} ctx.getCube
 * @param {(tabId: string) => void} ctx.showTab
 * @param {(visitIndex: number) => void} ctx.onJump  jump to an image from the light curve
 * @param {(pixel: {x, y}|null, ap: number) => void} ctx.onChange  for the URL
 */
export function createAnalysis({ player, current, getCube, showTab, onJump, onChange }) {
  let pixel = null;
  let ap = 0;
  let allBands = false;
  let token = 0;
  let specPts = [];
  let lcPts = [];
  const unit = () => current().view?.stretch?.unit || 'MJy/sr';

  const spec = interactiveChart($('spec-canvas'), (highlight) => drawSpectrum($('spec-canvas'), specPts, {
    unit: unit(), colorBy: $('spec-color').value, logY: $('spec-log').checked, highlight,
  }));
  const lc = interactiveChart($('lc-canvas'), (highlight) => drawLightCurve($('lc-canvas'), lcPts, {
    unit: unit(), logY: $('lc-log').checked, highlight, current: current().frame?.i ?? null,
  }), (p) => onJump(p.i));

  function legend() {
    const byWindow = $('spec-color').value === 'window';
    const view = current().view;
    const items = byWindow
      ? windowsIn(specPts).map((w, k) => {
        const label = (view?.windows || []).find((x) => x.id === w)?.label || `window ${w}`;
        return [WINDOW_COLORS[k % WINDOW_COLORS.length], `Survey ${label}`];
      })
      : detectorsIn(specPts).map((d) => [DET_COLORS[d], `${d} ${BANDS[d]} µm`]);
    $('spec-legend').replaceChildren(...items.map(([color, text]) => el('li', {},
      el('span', { class: 'dot', 'aria-hidden': 'true', style: `background:${color}` }), text)));
  }

  function bandsButton() {
    const view = current().view;
    const extra = view && !allBands ? extraBands(view) : [];
    $('spec-all').hidden = !pixel || !extra.length;
    if (extra.length) {
      const mb = (cubeMegabytes(view) * extra.length).toFixed(0);
      $('spec-all').textContent = `Add ${extra.length} other band${extra.length > 1 ? 's' : ''} (~${mb} MB)`;
    }
  }

  function lcLegend() {
    const ums = lcPts.map((p) => p.um);
    $('lc-bar').style.background = lcPts.length ? viridisGradient() : 'none';
    $('lc-um-lo').textContent = lcPts.length ? `${Math.min(...ums).toFixed(2)} µm` : '';
    $('lc-um-hi').textContent = lcPts.length ? `${Math.max(...ums).toFixed(2)} µm` : '';
  }

  async function refresh() {
    const view = current().view;
    if (!view || !pixel) return;
    const my = ++token;
    const { x, y } = pixel;
    const area = ap ? `${2 * ap + 1}×${2 * ap + 1} pixels around ` : '';
    $('spec-hint').textContent = `Loading pixel data for ${area}(${x}, ${y})…`;
    $('lc-hint').textContent = $('spec-hint').textContent;
    try {
      const [spectrum, cube] = await Promise.all([gatherSpectrum(view, x, y, { r: ap, allBands }), getCube(view)]);
      if (my !== token) return;
      specPts = spectrum.points;
      lcPts = pixelSeries(cube, view, x, y, ap).sort((a, b) => a.mjd - b.mjd);
      const missing = spectrum.failed.length ? ` · couldn't load ${spectrum.failed.join(', ')}` : '';
      const sat = specPts.some((p) => p.saturated) ? ' · includes saturated cores (hollow)' : '';
      $('spec-hint').textContent = `${area}Pixel (${x}, ${y}) · ${specPts.length} measurements in ${detectorsIn(specPts).length || 0} band(s)${missing}${sat}`;
      $('lc-hint').textContent = `${area}Pixel (${x}, ${y}) · ${lcPts.length} images in ${view.det} over ${windowsIn(lcPts).length} survey window(s)`;
      spec.update((h) => drawSpectrum($('spec-canvas'), specPts, {
        unit: unit(), colorBy: $('spec-color').value, logY: $('spec-log').checked, highlight: h,
      }));
      redrawLc();
      legend();
      lcLegend();
      bandsButton();
      $('spec-csv').disabled = !specPts.length;
      $('lc-csv').disabled = !lcPts.length;
    } catch (err) {
      if (my !== token) return;
      const msg = (err && err.message) || 'The pixel data could not be loaded.';
      $('spec-hint').textContent = msg;
      $('lc-hint').textContent = msg;
    }
  }

  function redrawLc() {
    lc.update((h) => drawLightCurve($('lc-canvas'), lcPts, {
      unit: unit(), logY: $('lc-log').checked, highlight: h, current: current().frame?.i ?? null,
    }));
  }

  function pick(p, { reveal = true } = {}) {
    pixel = p;
    player.select(p ? { ...p, r: ap } : null);
    onChange(pixel, ap);
    if (!p) return;
    if (reveal && !['tab-spec', 'tab-lc'].includes(document.querySelector('.side [aria-selected="true"]')?.id)) showTab('tab-spec');
    refresh();
  }

  function reset() {
    token += 1;
    pixel = null;
    allBands = false;
    specPts = [];
    lcPts = [];
    player.select(null);
    $('spec-hint').textContent = 'Click any pixel in the image to see how bright it is at each infrared wavelength.';
    $('lc-hint').textContent = 'Click a pixel to see how its brightness changes over time.';
    $('spec-legend').replaceChildren();
    $('spec-all').hidden = true;
    $('spec-csv').disabled = true;
    $('lc-csv').disabled = true;
    spec.update((h) => drawSpectrum($('spec-canvas'), [], { highlight: h }));
    lc.update((h) => drawLightCurve($('lc-canvas'), [], { highlight: h }));
    lcLegend();
  }

  const csvName = (kind) => `${fileStem(current().target)}-${current().view?.det || ''}-px${pixel?.x}-${pixel?.y}-${kind}.csv`;

  $('aperture').addEventListener('change', () => {
    ap = Number($('aperture').value);
    if (pixel) pick(pixel, { reveal: false });
    else onChange(pixel, ap);
  });
  $('spec-color').addEventListener('change', () => { spec.update((h) => drawSpectrum($('spec-canvas'), specPts, { unit: unit(), colorBy: $('spec-color').value, logY: $('spec-log').checked, highlight: h })); legend(); });
  $('spec-log').addEventListener('change', () => spec.update((h) => drawSpectrum($('spec-canvas'), specPts, { unit: unit(), colorBy: $('spec-color').value, logY: $('spec-log').checked, highlight: h })));
  $('lc-log').addEventListener('change', redrawLc);
  $('spec-all').addEventListener('click', () => {
    allBands = true;
    toast('Downloading the other bands…');
    refresh();
  });
  $('spec-centre').addEventListener('click', () => {
    const view = current().view;
    if (!view) return;
    const c = Math.floor(view.grid.npix / 2);
    pick({ x: c, y: c });
  });
  $('spec-csv').addEventListener('click', () => downloadText(toCsv(CSV_COLUMNS, csvRows(specPts)), csvName('spectrum')));
  $('lc-csv').addEventListener('click', () => downloadText(toCsv(CSV_COLUMNS, csvRows(lcPts)), csvName('lightcurve')));

  return {
    pick,
    reset,
    setAperture(r) {
      ap = r;
      $('aperture').value = String(r);
    },
    /** Called on every frame change: keeps the light curve's current-image marker in step. */
    onFrame() {
      if (lcPts.length && !$('panel-lc').hidden) lc.redraw();
    },
    get pixel() {
      return pixel;
    },
  };
}
