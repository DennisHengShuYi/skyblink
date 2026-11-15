// Spectrum (flux vs wavelength) and light curve (flux vs time) charts, drawn with
// chart.js. Points come from photometry.pixelSeries: {i, flux, err, um, mjd, window, det, saturated}.
import { drawScatter } from './chart.js';
import { colormapLut } from './render.js';

export const DET_COLORS = {
  D1: '#7aa2ff', D2: '#5ce1ff', D3: '#6ee7a8', D4: '#ffd166', D5: '#ff9f6b', D6: '#ff6b8b',
};
export const WINDOW_COLORS = ['#5ce1ff', '#ffd166', '#ff6b8b', '#6ee7a8', '#8b7bff', '#ff9f6b', '#7aa2ff', '#e8ecf8'];

const MJD_EPOCH_MS = Date.UTC(1858, 10, 17);
export const mjdToDate = (mjd) => new Date(MJD_EPOCH_MS + mjd * 86400000);
export const mjdLabel = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);

/** Detectors present in a point list, in D1..D6 order. */
export function detectorsIn(points) {
  return Object.keys(DET_COLORS).filter((d) => points.some((p) => p.det === d));
}

/** Windows present in a point list, in order. */
export function windowsIn(points) {
  return [...new Set(points.map((p) => p.window).filter((w) => w !== undefined))].sort((a, b) => a - b);
}

function pointLines(p, unit) {
  const lines = [
    `${p.flux.toPrecision(4)} ± ${Number.isFinite(p.err) ? p.err.toPrecision(2) : '?'} ${unit}`,
    `${p.um.toFixed(3)} µm · ${p.det || ''}`,
  ];
  if (Number.isFinite(p.mjd)) lines.push(`${mjdLabel(p.mjd)} (MJD ${p.mjd.toFixed(2)})`);
  if (p.saturated) lines.push('Saturated core (filled): not a real measurement');
  return lines;
}

/**
 * Spectrum chart. colorBy: 'det' | 'window' (window colours reveal variability).
 * Returns the chart's hit tester.
 */
export function drawSpectrum(canvas, points, { unit = 'MJy/sr', colorBy = 'det', logY = false, highlight = null, yFixed = null } = {}) {
  const wins = windowsIn(points);
  const color = colorBy === 'window'
    ? (p) => WINDOW_COLORS[Math.max(0, wins.indexOf(p.window)) % WINDOW_COLORS.length]
    : (p) => DET_COLORS[p.det] || '#ccc';
  return drawScatter(canvas, points, {
    x: (p) => p.um,
    y: (p) => p.flux,
    err: (p) => p.err,
    color,
    hollow: (p) => p.saturated,
    xMin: 0.7,
    xMax: 5.05,
    xLabel: 'Wavelength (µm)',
    yLabel: `Brightness (${unit})`,
    logY,
    highlight,
    yFixed,
    tooltip: (p) => pointLines(p, unit),
    emptyText: logY ? 'No positive measurements to show on a log scale.' : 'No measurements at this pixel.',
  });
}

/** Light curve: flux vs date, coloured by wavelength (SPHEREx changes wavelength between images). */
export function drawLightCurve(canvas, points, { unit = 'MJy/sr', logY = false, highlight = null, current = null } = {}) {
  const ums = points.map((p) => p.um);
  const lo = Math.min(...ums);
  const hi = Math.max(...ums);
  const lut = colormapLut('viridis');
  const color = (p) => {
    const k = Math.round(((p.um - lo) / (hi - lo || 1)) * 255) * 3;
    return `rgb(${lut[k]}, ${lut[k + 1]}, ${lut[k + 2]})`;
  };
  return drawScatter(canvas, points, {
    x: (p) => p.mjd,
    y: (p) => p.flux,
    err: (p) => p.err,
    color,
    hollow: (p) => p.saturated,
    size: (p) => (current !== null && p.i === current ? 6 : 3.5),
    xLabel: 'Date',
    xFormat: (v) => mjdLabel(v).slice(0, 7),
    yLabel: `Brightness (${unit})`,
    logY,
    highlight,
    tooltip: (p) => pointLines(p, unit),
    emptyText: 'No measurements at this pixel.',
  });
}

/** CSS gradient for the light-curve wavelength legend. */
export function viridisGradient() {
  const lut = colormapLut('viridis');
  const stops = [0, 64, 128, 192, 255].map((i) => `rgb(${lut[i * 3]}, ${lut[i * 3 + 1]}, ${lut[i * 3 + 2]})`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
