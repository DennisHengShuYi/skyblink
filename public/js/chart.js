// Small hand-drawn scatter chart on a canvas (no chart library): grid, ticks, error
// bars, coloured points, hollow markers, log y, a highlighted point with a tooltip,
// and hit-testing for hover/click. Used by the spectrum and the light curve.

const PAD = { left: 60, right: 14, top: 14, bottom: 40 };
const HIT_PX = 9;

function niceTicks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toPrecision(10));
  return { ticks, step };
}

export function fmtTick(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(decimals, 4));
}

function readCss(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Draw `points` into `canvas` and return {hit(clientX, clientY) → point|null}.
 * opts: x(p), y(p), err(p), color(p), hollow(p), size(p), xLabel, yLabel, xFormat(v, step),
 * xMin/xMax (minimum x range), logY, highlight (a point), tooltip(p) → string[], emptyText.
 */
export function drawScatter(canvas, points, opts) {
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
  const errOf = (p) => {
    const e = opts.err ? opts.err(p) : 0;
    return Number.isFinite(e) ? Math.abs(e) : 0;
  };
  const yRaw = (p) => opts.y(p);
  const valid = points.filter((p) => Number.isFinite(opts.x(p)) && Number.isFinite(yRaw(p)) && (!opts.logY || yRaw(p) > 0));
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = text;
  const none = { hit: () => null };
  if (!valid.length) {
    ctx.fillText(opts.emptyText || 'No measurements here.', PAD.left, cssH / 2);
    return none;
  }
  const ty = (v) => (opts.logY ? Math.log10(v) : v);
  let xMin = Math.min(...valid.map(opts.x));
  let xMax = Math.max(...valid.map(opts.x));
  if (Number.isFinite(opts.xMin)) xMin = Math.min(xMin, opts.xMin);
  if (Number.isFinite(opts.xMax)) xMax = Math.max(xMax, opts.xMax);
  if (xMax === xMin) { xMin -= 1; xMax += 1; }
  let yMin = Math.min(...valid.map((p) => ty(opts.logY ? yRaw(p) : yRaw(p) - errOf(p))));
  let yMax = Math.max(...valid.map((p) => ty(opts.logY ? yRaw(p) : yRaw(p) + errOf(p))));
  const yPad = (yMax - yMin || Math.abs(yMax) || 1) * 0.08;
  yMin -= yPad;
  yMax += yPad;
  const xPad = (xMax - xMin) * 0.03;
  xMin -= xPad;
  xMax += xPad;

  const plotW = cssW - PAD.left - PAD.right;
  const plotH = cssH - PAD.top - PAD.bottom;
  const sx = (v) => PAD.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const sy = (v) => PAD.top + (1 - (ty(v) - yMin) / (yMax - yMin)) * plotH;
  const syT = (t) => PAD.top + (1 - (t - yMin) / (yMax - yMin)) * plotH;

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const xt = niceTicks(xMin, xMax, Math.max(3, Math.floor(plotW / 70)));
  const yt = niceTicks(yMin, yMax, 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  xt.ticks.forEach((v) => {
    ctx.beginPath();
    ctx.moveTo(sx(v), PAD.top);
    ctx.lineTo(sx(v), PAD.top + plotH);
    ctx.stroke();
    ctx.fillText(opts.xFormat ? opts.xFormat(v, xt.step) : fmtTick(v, xt.step), sx(v), PAD.top + plotH + 6);
  });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  yt.ticks.forEach((t) => {
    ctx.beginPath();
    ctx.moveTo(PAD.left, syT(t));
    ctx.lineTo(PAD.left + plotW, syT(t));
    ctx.stroke();
    const label = opts.logY ? `${(10 ** t).toPrecision(2)}` : fmtTick(t, yt.step);
    ctx.fillText(label, PAD.left - 6, syT(t));
  });

  ctx.strokeStyle = text;
  ctx.beginPath();
  ctx.moveTo(PAD.left, PAD.top);
  ctx.lineTo(PAD.left, PAD.top + plotH);
  ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(opts.xLabel || '', PAD.left + plotW / 2, cssH - 2);
  ctx.save();
  ctx.translate(12, PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.yLabel || '', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, plotW, plotH);
  ctx.clip();
  const placed = valid.map((p) => ({ p, x: sx(opts.x(p)), y: sy(yRaw(p)) }));
  placed.forEach(({ p, x }) => {
    const e = errOf(p);
    if (e <= 0) return;
    const lo = opts.logY ? Math.max(yRaw(p) - e, 10 ** yMin) : yRaw(p) - e;
    ctx.strokeStyle = opts.color(p);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x, sy(lo));
    ctx.lineTo(x, sy(yRaw(p) + e));
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  placed.forEach(({ p, x, y }) => {
    const r = opts.size ? opts.size(p) : 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (opts.hollow && opts.hollow(p)) {
      ctx.strokeStyle = opts.color(p);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = opts.color(p);
      ctx.fill();
    }
  });
  ctx.restore();

  const hl = opts.highlight && placed.find((q) => q.p === opts.highlight);
  if (hl) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hl.x, hl.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    if (opts.tooltip) drawTooltip(ctx, opts.tooltip(hl.p), hl.x, hl.y, cssW);
  }

  return {
    hit(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      let best = null;
      let bestD = HIT_PX;
      placed.forEach((q) => {
        const d = Math.hypot(q.x - mx, q.y - my);
        if (d <= bestD) { best = q.p; bestD = d; }
      });
      return best;
    },
  };
}

function drawTooltip(ctx, lines, x, y, cssW) {
  ctx.font = '12px system-ui, sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
  const h = lines.length * 16 + 8;
  let bx = x + 10;
  if (bx + w > cssW - 4) bx = x - w - 10;
  const by = Math.max(4, y - h - 8);
  ctx.fillStyle = 'rgba(4, 7, 16, 0.92)';
  ctx.strokeStyle = 'rgba(92, 225, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(bx, by, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8ecf8';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 5 + i * 16));
}

/** Redraw on hover with the nearest point highlighted; `onClick(point)` for clicks. */
export function interactiveChart(canvas, draw, onClick = null) {
  let highlight = null;
  let chart = draw(null);
  const redraw = () => { chart = draw(highlight); };
  canvas.addEventListener('pointermove', (e) => {
    const p = chart.hit(e.clientX, e.clientY);
    canvas.style.cursor = p && onClick ? 'pointer' : 'default';
    if (p !== highlight) { highlight = p; redraw(); }
  });
  canvas.addEventListener('pointerleave', () => { if (highlight) { highlight = null; redraw(); } });
  if (onClick) canvas.addEventListener('click', (e) => { const p = chart.hit(e.clientX, e.clientY); if (p) onClick(p); });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => redraw()).observe(canvas);
  return {
    update(newDraw) { draw = newDraw; highlight = null; redraw(); },
    /** Redraw from the same data, keeping the hovered point (e.g. on every frame change). */
    redraw,
  };
}
