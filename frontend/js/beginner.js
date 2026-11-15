// Beginner features, mounted once by app.js: Finds (auto-marked movers/variables),
// "What am I looking at?" card, false colour, popular sights + sky-map picker,
// guided tours, GIF / picture-card sharing and sonification.
import * as api from './api.js';
import { $, el, toast } from './ui.js';
import { detectFinds, saturationMask } from './detect.js';
import { renderFinds, findsDecorator } from './finds-ui.js';
import { revealTabFor } from './finds-text.js';
import { renderObjectCard } from './objectcard.js';
import { spectrumWords } from './describe.js';
import { loadColour, COLOUR_DETS } from './colour.js';
import { detectorViews, gatherSpectrum, rememberView } from './spectrum-data.js';
import { SIGHTS } from './sights.js';
import { pickOnSky } from './aladin.js';
import { startTour } from './tour.js';
import { TOURS } from './tours.js';
import { makeGif, makeCard, shareOrDownload, fileName } from './share.js';
import { toNotes, describeSound, lightcurve, spectrumSeries, play } from './sonify.js';
import { shareUrl } from './urlstate.js';

const POLL_MS = 1500;
const PULSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ctx: {player, compare, current() → {view, frames, mode, target}, getCube(view), selectSideTab(id),
 *       getState(), ensureStacks(), pick(target), featured() → list}
 */
export function mountBeginner(ctx) {
  const { player } = ctx;
  let finds = [];
  let findsKey = null;
  let colourFrames = null;
  let sound = null;
  let pulseUntil = 0;

  // ---------- rings and pulse ----------
  player.addDecorator(findsDecorator(() => finds, () => $('ov-finds').checked));
  player.addDecorator((c, p) => {
    const left = pulseUntil - performance.now();
    if (left <= 0) return;
    const centre = (p.P - 1) / 2;
    const s = p.toScreen(centre + 0.5, centre + 0.5);
    const t = 1 - left / PULSE_MS;
    c.save();
    c.strokeStyle = `rgba(124, 252, 154, ${1 - t})`;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(s.x, s.y, p.pixelSize * (2 + 6 * t), 0, Math.PI * 2);
    c.stroke();
    c.restore();
    requestAnimationFrame(() => p.render());
  });
  $('ov-finds').addEventListener('change', () => player.render());

  function pulse() {
    pulseUntil = performance.now() + PULSE_MS;
    player.render();
  }

  // ---------- sound ----------
  function hear(values, label, textEl) {
    if (sound) {
      sound.stop();
      sound = null;
      textEl.textContent = '';
      return;
    }
    const words = `Sound: ${label} ${describeSound(values)}.`;
    textEl.textContent = words;
    sound = play(toNotes(values));
    if (!sound) {
      textEl.textContent = `${words} (Sound isn't available in this browser.)`;
      return;
    }
    setTimeout(() => { sound = null; }, sound.durationMs + 400);
  }

  async function hearBrightness(pixel, textEl) {
    const { view } = ctx.current();
    try {
      const cube = await ctx.getCube(view);
      hear(lightcurve(cube, view, pixel.x, pixel.y), 'its brightness over time', textEl);
    } catch (err) {
      textEl.textContent = err.message || 'No pixel data for sound.';
    }
  }

  async function hearSpectrum(pixel, textEl) {
    const { view } = ctx.current();
    try {
      const { points } = await gatherSpectrum(view, pixel.x, pixel.y, { allBands: true });
      hear(spectrumSeries(points), 'from short to long wavelength, its brightness', textEl);
    } catch (err) {
      textEl.textContent = err.message || 'No spectrum for sound.';
    }
  }

  // ---------- object card ----------
  function featuredFor(view) {
    return (ctx.featured() || []).find((f) => f.key === view?.key) || null;
  }

  function onPixel(pixel) {
    const { view, frames } = ctx.current();
    if (!view) return;
    const f = featuredFor(view);
    const centre = (view.grid.npix - 1) / 2;
    const atCentre = Math.hypot(pixel.x - centre, pixel.y - centre) <= 2;
    renderObjectCard($('object-card'), {
      view, pixel, frames,
      value: player.valueAt(pixel.x, pixel.y),
      caption: f && atCentre ? f.caption : null,
      untrackedMover: finds.find((m) => m.kind === 'moving' && !m.gaia && Math.hypot(m.x - pixel.x, m.y - pixel.y) <= 2) || null,
      spectrumWords: gatherSpectrum(view, pixel.x, pixel.y, { allBands: true }).then((r) => spectrumWords(r.points)),
      onHearBrightness: (t) => hearBrightness(pixel, t),
      onHearSpectrum: (t) => hearSpectrum(pixel, t),
      onShowSpectrum: () => ctx.selectSideTab('tab-spec'),
    });
    const tab = revealTabFor(document.querySelector('.side [aria-selected="true"]')?.id);
    if (tab) ctx.selectSideTab(tab);
  }

  // ---------- finds ----------
  async function runFinds() {
    const { view } = ctx.current();
    if (!view || findsKey === view.key) return;
    findsKey = view.key;
    finds = [];
    $('finds-list').replaceChildren(el('li', { class: 'hint' }, 'Looking for things that moved or changed…'));
    try {
      const cube = await ctx.getCube(view);
      if (ctx.current().view !== view) return;
      const stacks = Array.from({ length: cube.W }, (_, w) => cube.stack(w));
      const variances = Array.from({ length: cube.N }, (_, i) => cube.variance(i));
      finds = detectFinds(view, stacks, cube.deep(), cube.P, { saturated: saturationMask(variances, cube.P) });
    } catch {
      if (ctx.current().view !== view) return; // a newer view owns the list now
      findsKey = null; // allow a retry next time this view loads
      finds = [];
      $('finds-list').replaceChildren(el('li', { class: 'hint' }, "Couldn't check this view for changes: its pixel data didn't load. Try reloading it."));
      $('finds-count').textContent = '';
      player.render();
      return;
    }
    if (ctx.current().view !== view) return;
    renderFinds($('finds-list'), finds, view, {
      onPick: async (f) => {
        const pixel = { x: Math.round(f.x), y: Math.round(f.y) };
        await ctx.ensureStacks(); // wait for stacked frames before choosing the blink pair
        player.select(pixel);
        onPixel(pixel);
        await ctx.compare.pair('blink', f.from, f.to);
      },
      onHear: (f) => hearBrightness({ x: Math.round(f.x), y: Math.round(f.y) }, $('finds-sound')),
    });
    $('finds-count').textContent = finds.length ? `(${finds.length})` : '';
    player.render();
  }

  // ---------- colour ----------
  async function buildExtra(dets) {
    const { view } = ctx.current();
    for (const det of dets) {
      $('colour-msg').textContent = `Building ${det} (about 1–2 minutes)…`;
      const started = await api.startBuild({ ra: view.ra, dec: view.dec, fov: view.fov, det });
      let v = started.view || null;
      let { status } = started;
      while (!v && status !== 'done') {
        if (status === 'error') throw new Error(`The ${det} build failed.`);
        await sleep(POLL_MS);
        status = (await api.buildStatus(started.key)).status;
      }
      if (!v) v = await api.view(started.key);
      rememberView(v);
    }
  }

  async function colourEnter() {
    const { view, mode } = ctx.current();
    $('colour-build').hidden = true;
    if (mode !== 'stack') {
      $('colour-msg').textContent = 'Colour works on survey stacks — switch to Stacked.';
      return null;
    }
    $('colour-msg').textContent = 'Mixing D1 (blue), D3 (green) and D6 (red)…';
    try {
      const result = await loadColour(view, detectorViews(view));
      if (ctx.compare.tool !== 'colour' || ctx.current().view !== view) return null;
      if (result.missing) {
        $('colour-msg').textContent = `Colour needs ${result.missing.join(', ')} — build them? (about 1–2 minutes each)`;
        $('colour-build').hidden = false;
        $('colour-build').onclick = async () => {
          $('colour-build').hidden = true;
          try {
            await buildExtra(result.missing);
            if (ctx.compare.tool === 'colour') ctx.compare.select('colour');
          } catch (err) {
            $('colour-msg').textContent = err.message || 'Building the extra bands failed. Try again in a minute.';
            $('colour-build').hidden = false;
          }
        };
        return null;
      }
      colourFrames = result.frames;
      player.useImages(colourFrames);
      $('colour-msg').textContent = 'Hot stars look blue-white; cold brown dwarfs and dusty objects glow red.';
      if (!player.playing && player.frames.length > 1) player.play();
      return `Colour: ${COLOUR_DETS.b} blue · ${COLOUR_DETS.g} green · ${COLOUR_DETS.r} red`;
    } catch (err) {
      $('colour-msg').textContent = err.message || "The colour picture couldn't be made.";
      return null;
    }
  }

  function colourLeave() {
    colourFrames = null;
    player.useImages(null);
  }

  // ---------- home: sights and sky map ----------
  $('sights').replaceChildren(...SIGHTS.map((s) => {
    const b = el('button', { type: 'button', class: 'chip', title: s.teaser },
      el('strong', {}, s.name), el('span', {}, s.teaser));
    b.addEventListener('click', () => ctx.pick({ name: s.name, ra: s.ra, dec: s.dec, fov: s.fov, det: s.det }));
    return el('li', {}, b);
  }));
  $('sky-pick').addEventListener('click', async () => {
    $('sky-picker').hidden = false;
    $('sky-picker-msg').textContent = 'Loading the sky map… then click anywhere to look there.';
    try {
      await pickOnSky($('sky-map'), {}, ({ ra, dec }) => {
        $('sky-picker').hidden = true;
        ctx.pick({ name: `RA ${ra.toFixed(3)}°, Dec ${dec.toFixed(3)}°`, ra, dec, fov: 0.1, det: ctx.getState().det });
      });
      $('sky-picker-msg').textContent = 'Drag to look around, scroll to zoom, then click a spot.';
    } catch (err) {
      $('sky-picker-msg').textContent = `${err.message} You can still type a name or coordinates above.`;
    }
  });
  $('sky-close').addEventListener('click', () => { $('sky-picker').hidden = true; });

  // ---------- tours ----------
  $('tour-start').addEventListener('click', () => {
    const f = featuredFor(ctx.current().view);
    if (!f) return;
    startTour(f.slug, {
      player, compare: ctx.compare, ensureStacks: ctx.ensureStacks, selectSideTab: ctx.selectSideTab, pulse,
      setGaia: (on) => { $('ov-stars').checked = on; $('ov-stars').dispatchEvent(new Event('change')); },
    });
  });

  // ---------- sharing ----------
  async function shareThing(kind) {
    const { view, target } = ctx.current();
    if (!view) return;
    const title = target || 'SkyBlink view';
    const url = shareUrl(ctx.getState(), { embed: false });
    const f = featuredFor(view);
    const btn = $(kind === 'gif' ? 'save-gif' : 'save-card');
    btn.disabled = true;
    try {
      const blob = kind === 'gif'
        ? await makeGif(player, { fps: ctx.getState().fps, title })
        : await makeCard(player, { title, kind: f?.kind || (finds.some((x) => x.kind === 'moving') ? 'motion' : null), url });
      const res = await shareOrDownload(blob, fileName(title, kind === 'gif' ? 'gif' : 'png'), { title, url });
      if (res === 'downloaded') toast(kind === 'gif' ? 'GIF saved.' : 'Picture card saved.');
    } catch (err) {
      toast(err.message || 'Sharing failed.');
    } finally {
      btn.disabled = false;
    }
  }
  $('save-gif').addEventListener('click', () => shareThing('gif'));
  $('save-card').addEventListener('click', () => shareThing('card'));
  $('spec-hear').addEventListener('click', () => {
    const p = player.selected;
    if (!p) {
      toast('Click a pixel first, then listen to its spectrum.');
      return;
    }
    hearSpectrum(p, $('spec-sound'));
  });

  return {
    onPixel,
    /** After frames load: finds (once per view), tour button, colour state reset. */
    onFramesLoaded() {
      const { view } = ctx.current();
      const f = featuredFor(view);
      $('tour-start').hidden = !(f && TOURS[f.slug]);
      runFinds();
    },
    onHome() {
      $('tour').hidden = true;
      if (sound) sound.stop();
      sound = null;
    },
    colour: { enter: colourEnter, leave: colourLeave },
    get finds() {
      return finds;
    },
  };
}
