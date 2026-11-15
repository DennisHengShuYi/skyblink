// Lesson in a Link (brainstorm idea I26, ready-made lesson only): a printable worksheet,
// "How fast is a star?", on pre-built featured views. Every number in the answer key is
// computed from the views' own data (Gaia motions, the Then & Now geometry, the
// "nothing moves here" maths), never typed in.
import { thenTargetFor, moverFor, thenNowGeometry, deepEpoch } from './thennow.js';
import { motionSummary, yearsText } from './movers.js';
import { totalPm } from './gaia.js';
import { MEASURE_PAIRS, FLOOR_PX } from './measure.js';

const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Absolute link to a featured view with optional extra query keys. */
export function viewLink(base, f, det, extra = {}) {
  const q = new URLSearchParams({ ra: f.ra.toFixed(5), dec: f.dec.toFixed(5), fov: String(f.fov), det, mode: 'stack', target: f.name, level: 'simple', ...extra });
  return `${base}?${q}`;
}

/** Answer key from the manifests: {barnard: {gaia, err, thenPx, years}, epsindib: {...}, rwaur: {yearsPerPixel}}. */
export function answerKey({ barnard, epsindib, rwaur }) {
  const key = {};
  [['barnard', barnard], ['epsindib', epsindib]].forEach(([name, view]) => {
    const target = thenTargetFor(view);
    const star = moverFor(view, target);
    const pair = MEASURE_PAIRS[view.key];
    const sa = view.stacks.find((s) => s.window === pair.a);
    const sb = view.stacks.find((s) => s.window === pair.b);
    const years = (sb.mjd - sa.mjd) / 365.25;
    const g = thenNowGeometry(view, star, target.mjd, deepEpoch(view));
    key[name] = {
      gaia: totalPm(star),
      err: (Math.SQRT2 * FLOOR_PX * view.grid.scale_arcsec) / years,
      pxPerYear: totalPm(star) / view.grid.scale_arcsec,
      thenPx: g.shiftPx,
      thenYears: g.years,
      thenYear: target.year,
    };
  });
  key.rwaur = { yearsPerPixel: motionSummary(rwaur).yearsPerPixel };
  return key;
}

/** Open the worksheet in a new window for printing. views: {barnard, epsindib, rwaur} manifests. */
export function printLesson(win, { base, featured, views }) {
  const f = (slug) => featured.find((x) => x.slug === slug);
  const k = answerKey(views);
  const steps = [
    ['Watch', `Open <a href="${esc(viewLink(base, f('barnard'), 'D2'))}">Barnard's Star</a> and press Play. Each picture is SPHEREx looking at the same patch months apart. What do you notice about the bright star in the middle?`],
    ['Measure', `Press <b>Measure it</b>. Tap the star in the first picture, then in the last one. Write down: the shift in pixels ______ and your speed ______″ a year (± ______).`],
    ['Check', 'Gaia, a different space telescope, measured this star\'s speed too (SkyBlink shows its value). Does your answer agree within your error bar? Why might it not agree exactly?'],
    ['Compare', `Now open <a href="${esc(viewLink(base, f('epsindib'), 'D6'))}">Epsilon Indi B</a> and measure it the same way. Which crosses the sky faster? Use "How far away is everything?" to find which is closer.`],
    ['Go back in time', `On Barnard's Star, press <b>Then &amp; now</b>. How many SPHEREx pixels did the star move since the older picture? ______ How many years is that?`],
    ['Explain', `Open <a href="${esc(viewLink(base, f('rwaur'), 'D1'))}">RW Aurigae</a>. Its card says why nothing seems to move. In your own words: why do almost all stars look still?`],
  ];
  const b = k.barnard;
  const e = k.epsindib;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>How fast is a star? · SkyBlink lesson</title>
<style>@page{size:A4;margin:14mm} body{font-family:sans-serif;color:#000;background:#fff;max-width:180mm;margin:0 auto;line-height:1.45}
h1{font-size:18pt;margin:0 0 2mm} h2{font-size:12pt;margin:6mm 0 1mm} ol{padding-left:6mm} li{margin:0 0 4mm}
.key{border-top:2px solid #000;margin-top:10mm;padding-top:3mm;break-before:page} a{color:#000}
@media print{button{display:none}}</style></head><body>
<h1>How fast is a star?</h1><p>A 30-minute lesson with real NASA SPHEREx pictures in SkyBlink. Ages 12+. You need a computer or tablet.</p>
<button onclick="print()">Print</button>
<ol>${steps.map(([t, s]) => `<li><b>${t}.</b> ${s}</li>`).join('')}</ol>
<div class="key"><h2>Answer key (computed from the same data the class sees)</h2><ul>
<li>Barnard's Star: Gaia ${b.gaia.toFixed(2)}″ a year = ${b.pxPerYear.toFixed(1)} SPHEREx pixels a year. A careful two-tap measurement should land within about ±${b.err.toFixed(1)}″ a year of it (two pictures line up to about 0.2 pixels).</li>
<li>Epsilon Indi B: Gaia ${e.gaia.toFixed(2)}″ a year (${e.pxPerYear.toFixed(1)} pixels a year), so slower across the sky than Barnard's Star, although both are close: 6 and 12 light-years. Error bar again about ±${e.err.toFixed(1)}″ a year: a harder measurement, because the shift is under one pixel.</li>
<li>Then &amp; now: Barnard's Star moved about ${Math.round(b.thenPx)} SPHEREx pixels in ${Math.round(b.thenYears)} years since the ${b.thenYear} picture.</li>
<li>RW Aurigae: the fastest star in that picture needs ${yearsText(k.rwaur.yearsPerPixel)} to move one SPHEREx pixel. Stars look still because they are very far away; only the Sun's nearest neighbours move a pixel a year.</li>
<li>Why measurements disagree a little: blurry 6″ pixels, pictures taken in slightly different infrared colours, and how well two pictures line up.</li></ul>
<p>Pictures: NASA SPHEREx via NASA/IPAC Infrared Science Archive. Star motions and distances: ESA Gaia DR3.</p></div>
</body></html>`;
  win.document.write(html);
  win.document.close();
}

/** Open the worksheet window at once (pop-up rules), then fill it from three manifests. */
export async function openLesson({ featured, view }) {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Pop-ups are blocked: allow them for SkyBlink to print the lesson.');
  win.document.write('<p style="font-family:sans-serif">Preparing the lesson…</p>');
  try {
    const keyOf = (slug, det) => `${featured.find((x) => x.slug === slug).key.split('-')[0]}-${det}`;
    const [barnard, epsindib, rwaur] = await Promise.all([
      view(keyOf('barnard', 'D2')), view(keyOf('epsindib', 'D6')), view(keyOf('rwaur', 'D1')),
    ]);
    win.document.open();
    printLesson(win, { base: `${location.origin}${location.pathname}`, featured, views: { barnard, epsindib, rwaur } });
  } catch {
    win.close();
    throw new Error("The lesson couldn't be prepared right now. Please try again.");
  }
}
