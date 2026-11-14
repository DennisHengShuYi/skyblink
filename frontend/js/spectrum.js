// Hand-drawn flux-vs-wavelength chart on a canvas: axes, ticks, error bars and
// points coloured by detector. No chart library.

export const DET_COLORS = {
  D1: '#7aa2ff', D2: '#5ce1ff', D3: '#6ee7a8', D4: '#ffd166', D5: '#ff9f6b', D6: '#ff6b8b',
};
const PAD = { left: 56, right: 14, top: 14, bottom: 40 };

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toPrecision(10));
  return { ticks, step };
}

function fmt(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(decimals, 4));
}

function readCss(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Draw `points` ([{um, flux, err, det}]) into `canvas`. `unit` labels the y axis.
 * Sizes itself to the canvas's CSS box at device pixel ratio.
 */
export function drawSpectrum(canvas, points, unit = 'MJy/sr') {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 360;
  const cssH = canvas.clientHeight || 240;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const text = readCss('--text-dim', '#aab');
  const grid = readCss('--grid', 'rgba(255,255,255,0.08)');
  const valid = points.filter((p) => Number.isFinite(p.um) && Number.isFinite(p.flux));
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = text;
  if (!valid.length) {
    ctx.fillText('No measurements at this pixel.', PAD.left, cssH / 2);
    return;
  }

  const errOf = (p) => (Number.isFinite(p.err) ? Math.abs(p.err) : 0);
  const xMin = Math.min(0.7, ...valid.map((p) => p.um));
  const xMax = Math.max(5.05, ...valid.map((p) => p.um));
  let yMin = Math.min(...valid.map((p) => p.flux - errOf(p)));
  let yMax = Math.max(...valid.map((p) => p.flux + errOf(p)));
  const yPad = (yMax - yMin || Math.abs(yMax) || 1) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const plotW = cssW - PAD.left - PAD.right;
  const plotH = cssH - PAD.top - PAD.bottom;
  const sx = (v) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // Grid and tick labels.
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const xt = niceTicks(xMin, xMax, 6);
  const yt = niceTicks(yMin, yMax, 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  xt.ticks.forEach((v) => {
    ctx.beginPath();
    ctx.moveTo(sx(v), PAD.top);
    ctx.lineTo(sx(v), PAD.top + plotH);
    ctx.stroke();
    ctx.fillText(fmt(v, xt.step), sx(v), PAD.top + plotH + 6);
  });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  yt.ticks.forEach((v) => {
    ctx.beginPath();
    ctx.moveTo(PAD.left, sy(v));
    ctx.lineTo(PAD.left + plotW, sy(v));
    ctx.stroke();
    ctx.fillText(fmt(v, yt.step), PAD.left - 6, sy(v));
  });

  // Axes.
  ctx.strokeStyle = text;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Wavelength (µm)', PAD.left + plotW / 2, cssH - 2);
  ctx.save();
  ctx.translate(12, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(`Brightness (${unit})`, 0, 0);
  ctx.restore();

  // Error bars, then points.
  valid.forEach((p) => {
    const color = DET_COLORS[p.det] || '#ccc';
    const e = errOf(p);
    if (e > 0) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(sx(p.um), sy(p.flux - e));
      ctx.lineTo(sx(p.um), sy(p.flux + e));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx(p.um), sy(p.flux), 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Detectors present in a point list, in D1..D6 order. */
export function detectorsIn(points) {
  return Object.keys(DET_COLORS).filter((d) => points.some((p) => p.det === d));
}
