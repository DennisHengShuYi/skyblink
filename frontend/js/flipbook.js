// Hold the Change: a printable paper flip-book of a moving star (brainstorm idea I27).
// Each page is one survey picture, cropped around the mover, enlarged with crisp pixels,
// printed as a negative (dark star on white paper), with a FIXED reticle in the same
// place on every page: hand-cut pages misalign by about as much as the star moves, so
// the reticle is what lets your eye see the step. Same stretch on every page (the view's
// shared stack PNGs).
import { project, propagate } from './gaia.js';

export const CROP_PX = 15;
export const SCALE = 20; // printed pixels per SPHEREx pixel
export const PAGES = 12; // the windows repeat to make a book thick enough to flip

/** Crop window (grid px, top-left) centred on the mover's mid-track, kept inside the picture. */
export function cropBox(view, star) {
  const mjds = (view.stacks || []).map((s) => s.mjd).filter(Number.isFinite);
  const mid = mjds.length ? (Math.min(...mjds) + Math.max(...mjds)) / 2 : star.epoch_mjd;
  const p = propagate(star, mid);
  const g = project(p.ra, p.dec, view);
  const P = view.grid.npix;
  const clamp = (v) => Math.min(P - CROP_PX, Math.max(0, Math.round(v - (CROP_PX - 1) / 2)));
  return { x0: clamp(g.x), y0: clamp(g.y) };
}

/** Page order: windows in time order, repeated to PAGES pages, each with its repeat number. */
export function pageOrder(nWindows, pages = PAGES) {
  return Array.from({ length: pages }, (_, k) => ({ window: k % nWindows, round: Math.floor(k / nWindows) + 1 }));
}

function panel(img, view, box, stack, k, n) {
  const size = CROP_PX * SCALE;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.filter = 'invert(1)';
  ctx.drawImage(img, box.x0, box.y0, CROP_PX, CROP_PX, 0, 0, size, size);
  ctx.filter = 'none';
  // Fixed reticle: centre of the crop, identical on every page.
  ctx.strokeStyle = '#d00';
  ctx.lineWidth = 3;
  const m = size / 2;
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(m + dx * 40, m + dy * 40);
    ctx.lineTo(m + dx * 90, m + dy * 90);
    ctx.stroke();
  });
  ctx.fillStyle = '#000';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`${stack.date.slice(0, 7)} · survey picture ${k + 1} of ${n}`, 10, size - 12);
  ctx.fillText('N↑  E←', size - 80, 24);
  return c.toDataURL('image/png');
}

/** Open a print-ready flip-book page for the view (stack PNGs, mover star). */
export async function printFlipbook(view, star, title) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-ups are blocked: allow them for SkyBlink to print the flip-book.');
  const stacks = [...(view.stacks || [])].sort((a, b) => a.mjd - b.mjd);
  const { loadImage } = await import('./player.js'); // browser-only (keeps the maths testable in node)
  const imgs = await Promise.all(stacks.map((s) => loadImage(s.png)));
  const box = cropBox(view, star);
  const panels = stacks.map((s, k) => panel(imgs[k], view, box, s, k, stacks.length));
  const order = pageOrder(stacks.length);
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const cells = order.map((o, i) => `<figure><span class="num">${i + 1}</span><img src="${panels[o.window]}" alt="Page ${i + 1}">${o.round > 1 ? `<figcaption>repeat ${o.round}</figcaption>` : ''}</figure>`).join('');
  win.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} flip-book · SkyBlink</title>
<style>
@page { size: A4; margin: 10mm; }
body { font-family: sans-serif; color: #000; background: #fff; margin: 0 auto; max-width: 190mm; }
h1 { font-size: 16pt; margin: 0 0 4mm; } p { font-size: 10pt; margin: 0 0 3mm; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
figure { margin: 0; padding: 4mm; border: 1px dashed #999; position: relative; break-inside: avoid; }
figure img { width: 100%; image-rendering: pixelated; display: block; }
.num { position: absolute; left: 1mm; top: 0; font-size: 9pt; color: #555; }
figcaption { font-size: 8pt; color: #555; }
@media screen { button { font-size: 14pt; margin: 4mm 0; } }
@media print { button { display: none; } }
</style></head><body>
<h1>${esc(title)}: a paper flip-book from NASA SPHEREx</h1>
<p>Cut along the dashed lines, stack the pages in number order (1 on top), staple the left edge and flip with your thumb. Watch the dark dot step past the red reticle: that is real motion across the sky, about a year of it, enlarged ${SCALE}×. The reticle is in the same place on every page, so line the pages up by the reticle, not the paper edge.</p>
<p>Printed as a negative: stars are dark on white. Every page uses the same brightness scale. Pages repeat after ${stacks.length}.</p>
<button onclick="print()">Print</button>
<div class="grid">${cells}</div>
<p>Images: NASA SPHEREx via NASA/IPAC Infrared Science Archive. Made with SkyBlink.</p>
</body></html>`);
  win.document.close();
}
