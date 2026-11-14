// SkyBlink frontend entry point: state, search → build → poll → view flow,
// player wiring, compare tools, side panels and URL state.
import * as api from './js/api.js';
import { readUrlState, writeUrlState, shareUrl, clampFps } from './js/urlstate.js';
import { Player } from './js/player.js';
import { createCompare } from './js/compare.js';
import { drawSpectrum, detectorsIn, DET_COLORS } from './js/spectrum.js';
import { rememberView, gatherSpectrum } from './js/spectrum-data.js';
import { showAladin, setSurvey } from './js/aladin.js';
import {
  $, el, toast, copyText, setupTabs, setupRadioGroup, renderGallery, frameTitle,
  renderTicks, setActiveTick, renderMeta,
} from './js/ui.js';

const POLL_MS = 1500;
const LIVE_BUILD_MSG = "Fetching SPHEREx images from NASA's archive — new spots take 1–2 minutes";
const BANDS = { D1: '0.75–1.09', D2: '1.10–1.62', D3: '1.63–2.41', D4: '2.42–3.82', D5: '3.83–4.41', D6: '4.42–5.00' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = readUrlState();
let view = null;
let frames = [];
let gen = 0;
let aladin = { widget: null, key: null };
let specToken = 0;
let activeSideTab = 'tab-info';

const player = new Player($('canvas'), { onFrame, onPixel: loadSpectrum, onPlayState });
const setMode = setupRadioGroup($('mode-group'), 'mode', (m) => changeMode(m));
const compare = createCompare({ player, current: () => ({ view, frames, mode: state.mode }) });
const selectSideTab = setupTabs(document.querySelector('.side [role="tablist"]'), onSideTab);

function update(patch) {
  state = { ...state, ...patch };
  writeUrlState(state);
}

// ---------- status and errors ----------

function showStatus(message, progress = null) {
  $('status').hidden = false;
  $('status-msg').textContent = message;
  const pct = progress === null ? 0 : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  $('progress').setAttribute('aria-valuenow', String(pct));
  $('progress-bar').style.width = `${pct}%`;
  $('progress').classList.toggle('indeterminate', progress === null);
}

const hideStatus = () => { $('status').hidden = true; };

function showError(message, retry = null) {
  hideStatus();
  $('error').hidden = !message;
  $('error-msg').textContent = message || '';
  $('error-retry').hidden = !retry;
  $('error-retry').onclick = retry;
}

function friendly(err, what) {
  if (err && err.status === 404) return `${what}: ${err.message}`;
  return (err && err.message) || `Something went wrong (${what}).`;
}

// ---------- search → build → view ----------

async function search(query) {
  const myGen = ++gen;
  showError(null);
  showStatus(`Looking up “${query}”…`);
  try {
    const r = await api.resolve(query);
    if (myGen !== gen) return;
    update({ ra: r.ra, dec: r.dec, target: r.name || query });
    await buildAndShow();
  } catch (err) {
    if (myGen !== gen) return;
    const msg = err.status === 404
      ? `We couldn't find “${query}”. Check the spelling, or enter coordinates such as 133.795 -7.245.`
      : friendly(err, 'name lookup');
    showError(msg, () => search(query));
  }
}

async function buildAndShow() {
  const myGen = ++gen;
  const { ra, dec, fov, det } = state;
  showError(null);
  showStatus(LIVE_BUILD_MSG);
  try {
    // Hosted (Vercel): one long POST that may return the finished view inline.
    const started = await api.startBuild({ ra, dec, fov, det });
    if (myGen !== gen) return;
    if (started.view) {
      await showView(started.view, myGen);
      return;
    }
    // Local dev server: queued/running → poll. Featured targets: done → GET the view.
    let status = started.status;
    while (status !== 'done') {
      if (status === 'error') throw new Error('The server could not build this view.');
      await sleep(POLL_MS);
      if (myGen !== gen) return;
      const s = await api.buildStatus(started.key);
      if (myGen !== gen) return;
      status = s.status;
      if (status === 'error') throw new Error(s.error || s.message || 'The server could not build this view.');
      const label = s.status === 'queued' ? 'Waiting in line…' : (s.message || 'Working…');
      showStatus(label, Number.isFinite(s.progress) ? s.progress : null);
    }
    showStatus('Loading the image list…', 1);
    const v = await api.view(started.key);
    if (myGen !== gen) return;
    await showView(v, myGen);
  } catch (err) {
    if (myGen !== gen) return;
    showError(friendly(err, 'building the view'), () => buildAndShow());
  }
}

async function showView(v, myGen) {
  view = v;
  rememberView(v);
  hideStatus();
  $('home').hidden = true;
  $('viewer').hidden = false;
  $('view-title').textContent = state.target || `RA ${v.ra.toFixed(4)}°, Dec ${v.dec.toFixed(4)}°`;
  $('view-coords').textContent = `RA ${v.ra.toFixed(5)}° · Dec ${v.dec.toFixed(5)}° · ${v.det} (${BANDS[v.det] || ''} µm) · ${v.fov}° field · ${(v.visits || []).length} images in ${(v.windows || []).length} survey windows`;
  $('notes').replaceChildren(...(v.notes || []).map((n) => el('li', {}, n)));
  $('deep-info').textContent = `All ${v.deep?.n ?? ''} images added together: the deepest, least noisy view. Moving objects smear out.`;
  $('open-full').href = shareUrl(state, { embed: false });
  document.title = `${$('view-title').textContent} · SkyBlink`;
  resetSpectrum();
  if (activeSideTab === 'tab-atlas') loadAtlas();
  await loadFrames(myGen, true);
}

function framesFor(mode) {
  if (!view) return [];
  return (mode === 'visits' ? view.visits : view.stacks) || [];
}

async function loadFrames(myGen = gen, fresh = false) {
  let list = framesFor(state.mode);
  if (!list.length && framesFor(state.mode === 'stack' ? 'visits' : 'stack').length) {
    update({ mode: state.mode === 'stack' ? 'visits' : 'stack' });
    setMode(state.mode);
    list = framesFor(state.mode);
  }
  if (!list.length) {
    showError(`SPHEREx has no images of this patch in band ${state.det} yet. Try another band or a nearby position.`);
    $('viewer').hidden = true;
    return;
  }
  compare.reset();
  $('stage-loading').hidden = false;
  if (fresh) player.index = 0;
  try {
    const ok = await player.load(view, list, (done, total) => {
      $('stage-loading-msg').textContent = `Loading frames ${done}/${total}…`;
    });
    if (!ok || myGen !== gen) return;
  } catch {
    showError("Some image frames didn't load. Please try again.", () => loadFrames());
    return;
  } finally {
    $('stage-loading').hidden = true;
  }
  frames = list;
  $('scrub').max = String(list.length - 1);
  renderTicks($('ticks'), list, (i) => { leaveCompare(); player.step(i - player.index); });
  compare.fillSelects();
  onFrame(player.index, player.frame);
  if (!reducedMotion && list.length > 1) player.play();
}

// ---------- player callbacks ----------

function onFrame(index, frame) {
  if (!frame) return;
  $('frame-label').textContent = frameTitle(frame, state.mode, view, index, frames.length || 1);
  $('scrub').value = String(index);
  $('scrub').setAttribute('aria-valuetext', frameTitle(frame, state.mode, view, index, frames.length || 1));
  setActiveTick($('ticks'), index);
  renderMeta($('meta'), { view, frame, mode: state.mode });
}

function onPlayState(playing) {
  $('play').textContent = playing ? '⏸' : '▶';
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').setAttribute('aria-label', playing ? 'Pause (space)' : 'Play (space)');
}

/** Any transport action returns from Blink/Difference/Deep to the plain animation. */
function leaveCompare() {
  compare.reset();
}

function changeMode(mode) {
  if (mode === state.mode) return;
  update({ mode });
  if (view) loadFrames(gen, true);
}

// ---------- spectrum ----------

function resetSpectrum() {
  specToken += 1;
  player.select(null);
  $('spec-hint').textContent = 'Click any pixel in the image to see how bright it is at each infrared wavelength.';
  $('spec-legend').replaceChildren();
  const c = $('spec-canvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

async function loadSpectrum(pixel) {
  if (!view) return;
  const token = ++specToken;
  player.select(pixel);
  if (activeSideTab !== 'tab-spec') selectSideTab('tab-spec');
  $('spec-hint').textContent = `Loading pixel data for (${pixel.x}, ${pixel.y})…`;
  try {
    const { points: pts, failed } = await gatherSpectrum(view, pixel.x, pixel.y);
    if (token !== specToken) return;
    const missing = failed.length ? ` · couldn't load ${failed.join(', ')}` : '';
    $('spec-hint').textContent = `Pixel (${pixel.x}, ${pixel.y}) · ${pts.length} measurements in ${detectorsIn(pts).length || 0} band(s)${missing}`;
    drawSpectrum($('spec-canvas'), pts, view.stretch?.unit || 'MJy/sr');
    $('spec-legend').replaceChildren(...detectorsIn(pts).map((d) => el('li', {},
      el('span', { class: 'dot', 'aria-hidden': 'true', style: `background:${DET_COLORS[d]}` }), `${d} ${BANDS[d]} µm`)));
  } catch (err) {
    if (token !== specToken) return;
    $('spec-hint').textContent = friendly(err, 'spectrum');
  }
}

// ---------- side tabs and Aladin ----------

function onSideTab(id) {
  activeSideTab = id;
  if (id === 'tab-atlas') loadAtlas();
}

async function loadAtlas() {
  if (!view || aladin.key === view.key) return;
  aladin = { widget: null, key: view.key };
  const box = $('aladin');
  box.replaceChildren(el('p', { class: 'hint' }, 'Loading the Aladin sky atlas…'));
  try {
    const widget = await showAladin(box, { ra: view.ra, dec: view.dec, fov: view.fov }, $('atlas-survey').value);
    if (aladin.key === view.key) aladin = { ...aladin, widget };
  } catch (err) {
    aladin = { widget: null, key: null };
    box.replaceChildren(el('p', { class: 'hint' }, `${err.message} The rest of SkyBlink still works.`));
  }
}

// ---------- events ----------

function bindEvents() {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (!q) {
      $('q').focus();
      toast('Type a star name or coordinates first.');
      return;
    }
    search(q);
  });
  $('fov').addEventListener('change', () => {
    update({ fov: Number($('fov').value) });
    if (state.ra !== null) buildAndShow();
  });
  document.querySelectorAll('#det-tabs .det').forEach((b) => b.addEventListener('click', () => {
    update({ det: b.dataset.det });
    syncDetectors();
    if (state.ra !== null) buildAndShow();
  }));
  $('play').addEventListener('click', () => { leaveCompare(); player.toggle(); });
  $('prev').addEventListener('click', () => { leaveCompare(); player.step(-1); });
  $('next').addEventListener('click', () => { leaveCompare(); player.step(1); });
  $('scrub').addEventListener('input', () => { leaveCompare(); player.step(Number($('scrub').value) - player.index); });
  $('fps').addEventListener('input', () => {
    const fps = clampFps(Number($('fps').value));
    $('fps-out').textContent = `${fps} fps`;
    player.setFps(fps);
    update({ fps });
  });
  $('ov-stars').addEventListener('change', (e) => {
    player.setOverlay('stars', e.target.checked);
    $('exag-wrap').classList.toggle('disabled', !e.target.checked);
    if (e.target.checked && view && !(view.stars || []).length) toast('No Gaia stars catalogued in this field.');
  });
  $('exag').addEventListener('input', () => {
    $('exag-out').textContent = `×${$('exag').value}`;
    player.setOverlay('exaggeration', Number($('exag').value));
  });
  $('ov-flags').addEventListener('change', (e) => {
    player.setOverlay('flags', e.target.checked);
    if (e.target.checked && state.mode !== 'visits') toast('Flags are per image: switch to "Every image" to see them.');
  });
  $('spec-centre').addEventListener('click', () => {
    if (!view) return;
    const c = Math.floor(view.grid.npix / 2);
    loadSpectrum({ x: c, y: c });
  });
  $('atlas-survey').addEventListener('change', () => setSurvey(aladin.widget, $('atlas-survey').value));
  $('copy-link').addEventListener('click', async () => {
    toast((await copyText(shareUrl(state, { embed: false }))) ? 'Link copied.' : 'Copy failed: copy the address bar instead.');
  });
  $('copy-embed').addEventListener('click', async () => {
    const title = ($('view-title').textContent || 'SkyBlink').replace(/"/g, '&quot;');
    const code = `<iframe src="${shareUrl(state, { embed: true })}" width="600" height="720" style="border:0;max-width:100%" title="SkyBlink: ${title}" loading="lazy"></iframe>`;
    toast((await copyText(code)) ? 'Embed code copied.' : 'Copy failed.');
  });
  $('home-link').addEventListener('click', (e) => {
    if (state.embed) return;
    e.preventDefault();
    goHome();
  });
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!view || $('viewer').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  const tag = t.tagName;
  const isScrub = t.id === 'scrub';
  if (e.key === ' ' || e.code === 'Space') {
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag) && !isScrub) return;
    e.preventDefault();
    leaveCompare();
    player.toggle();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if ((['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) && !isScrub) || t.getAttribute('role') === 'tab' || t.getAttribute('role') === 'radio') return;
    e.preventDefault();
    leaveCompare();
    player.step(e.key === 'ArrowLeft' ? -1 : 1);
  }
}

function goHome() {
  gen += 1;
  player.pause();
  view = null;
  update({ ra: null, dec: null, target: null });
  showError(null);
  hideStatus();
  $('viewer').hidden = true;
  $('home').hidden = false;
  document.title = 'SkyBlink: watch the infrared sky change';
}

function syncDetectors() {
  document.querySelectorAll('#det-tabs .det').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.det === state.det)));
}

function pickFeatured(f) {
  $('q').value = f.name;
  $('fov').value = String(f.fov ?? state.fov);
  update({ ra: f.ra, dec: f.dec, target: f.name, fov: Number(f.fov ?? state.fov), det: f.det || state.det });
  syncDetectors();
  buildAndShow();
  $('main').focus({ preventScroll: true });
}

/** Grey out field sizes the hosted server can't build live (GET /api/config). */
async function applyConfig() {
  let cfg = null;
  try {
    cfg = await api.config();
  } catch {
    cfg = null; // Unknown config: allow everything; the server will explain any refusal.
  }
  const live = Array.isArray(cfg?.live_fovs) ? cfg.live_fovs.map(Number) : null;
  let restricted = false;
  [...$('fov').options].forEach((o) => {
    const off = Boolean(live) && !live.includes(Number(o.value));
    restricted = restricted || off;
    o.disabled = off;
    o.textContent = o.textContent.replace(/ · featured only$/, '') + (off ? ' · featured only' : '');
  });
  if (restricted) $('fov-hint').textContent = 'Larger fields: featured targets only.';
}

async function loadFeatured() {
  try {
    renderGallery($('gallery'), await api.featured(), pickFeatured);
  } catch (err) {
    $('gallery').replaceChildren(el('li', { class: 'hint' }, `Featured targets are unavailable right now (${err.message}). You can still search above.`));
  }
}

function init() {
  document.body.classList.toggle('embed', state.embed);
  $('mock-badge').hidden = !api.MOCK;
  $('fov').value = String(state.fov);
  $('fps').value = String(state.fps);
  $('fps-out').textContent = `${state.fps} fps`;
  player.setFps(state.fps);
  setMode(state.mode);
  syncDetectors();
  $('exag-wrap').classList.add('disabled');
  if (state.target) $('q').value = state.target;
  bindEvents();
  if (!state.embed) {
    loadFeatured();
    applyConfig();
  }
  if (state.ra !== null) buildAndShow();
  else if (state.target) search(state.target);
  else writeUrlState(state);
}

init();
