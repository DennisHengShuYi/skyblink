// SkyBlink frontend entry point: state, search → build → view flow, frame loading,
// detector/fov choices, side panels, sharing, export and URL state. Viewer controls
// live in js/controls.js, spectrum + light curve in js/analysis.js, keys in js/keys.js.
import * as api from './js/api.js';
import { readUrlState, writeUrlState, shareUrl, clampFps } from './js/urlstate.js';
import { Player } from './js/player.js';
import { createCompare } from './js/compare.js';
import { createControls } from './js/controls.js';
import { createAnalysis } from './js/analysis.js';
import { createKeyHandler } from './js/keys.js';
import { loadCube } from './js/cube.js';
import { rememberView, builtDetectors } from './js/spectrum-data.js';
import { orderFrames, timePositions, windowStarts } from './js/frames.js';
import { unproject } from './js/gaia.js';
import { suggestNames, addRecent } from './js/search.js';
import { showAladin, setSurvey, drawFootprint, markSelection } from './js/aladin.js';
import { downloadBlob, canvasPng, recordFrames, videoSupported, fileStem } from './js/exporter.js';
import {
  $, el, toast, copyText, setupTabs, setupRadioGroup, renderGallery, frameTitle,
  renderTicks, setActiveTick, renderTimeStrip, setActiveDot, renderMeta,
} from './js/ui.js';

const POLL_MS = 1500;
const LIVE_BUILD_MSG = "Fetching SPHEREx images from NASA's archive";
const BANDS = { D1: '0.75–1.09', D2: '1.10–1.62', D3: '1.63–2.41', D4: '2.42–3.82', D5: '3.83–4.41', D6: '4.42–5.00' };
const RECENT_KEY = 'skyblink.recent';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = readUrlState();
let view = null;
let frames = [];
let gen = 0;
let aladin = { widget: null, key: null };
let featuredList = [];
let restore = state.ra !== null || Boolean(state.target); // apply URL view settings once
let build = null; // {abort, timer}
let shownTarget = null; // target name of the view on screen (restored on cancel)

const player = new Player($('canvas'), {
  onFrame, onPlayState, onPixel: (p) => analysis.pick(p), onHover: (...a) => controls.onHover(...a),
  onSwipe: (d) => { leaveCompare(); player.step(d); },
});
const current = () => ({ view, frames, mode: state.mode, frame: player.frame, target: $('view-title').textContent });
const getCube = (v) => loadCube(v);
const update = (patch) => {
  state = { ...state, ...patch };
  writeUrlState(state);
};
const setMode = setupRadioGroup($('mode-group'), 'mode', (m) => changeMode(m));
const selectSideTab = setupTabs(document.querySelector('.side [role="tablist"]'), onSideTab);
const controls = createControls(player, { current, update });
const compare = createCompare({ player, current, getCube, onChange: (s) => update(s) });
const analysis = createAnalysis({
  player, current, getCube, showTab: (id) => selectSideTab(id), onJump: jumpToVisit,
  onChange: (p, ap) => update({ px: p ? p.x : null, py: p ? p.y : null, ap }),
});

// ---------- status and errors ----------

function showStatus(message, progress = null) {
  $('status').hidden = false;
  $('status-msg').textContent = message;
  const pct = progress === null ? 0 : Math.round(Math.max(0, Math.min(1, progress)) * 100);
  $('progress').setAttribute('aria-valuenow', String(pct));
  $('progress-bar').style.width = `${pct}%`;
  $('progress').classList.toggle('indeterminate', progress === null);
}

function hideStatus() {
  $('status').hidden = true;
  stopBuildTimer();
}

function showError(message, retry = null, actions = []) {
  hideStatus();
  $('error').hidden = !message;
  $('error-msg').textContent = message || '';
  $('error-retry').hidden = !retry;
  $('error-retry').onclick = retry;
  $('error-actions').replaceChildren(...actions.map(([label, fn]) => {
    const b = el('button', { type: 'button', class: 'btn btn-ghost' }, label);
    b.addEventListener('click', fn);
    return b;
  }));
}

function friendly(err, what) {
  if (err && err.status === 404) return `${what}: ${err.message}`;
  return (err && err.message) || `Something went wrong (${what}).`;
}

function startBuildTimer(slow) {
  stopBuildTimer();
  const abort = new AbortController();
  const started = Date.now();
  const tick = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('status-elapsed').textContent = slow ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · usually 1–2 min` : '';
  };
  tick();
  build = { abort, timer: setInterval(tick, 1000) };
  $('status-cancel').hidden = false;
  return abort.signal;
}

function stopBuildTimer() {
  if (build) clearInterval(build.timer);
  build = null;
  $('status-elapsed').textContent = '';
}

function cancelBuild() {
  if (build) build.abort.abort();
  gen += 1;
  restore = false;
  hideStatus();
  toast(view ? 'Cancelled. Still showing the previous view.' : 'Cancelled.');
  if (view) update({ ra: view.ra, dec: view.dec, det: view.det, fov: view.fov, target: shownTarget });
  syncDetectors();
}

// ---------- search → build → view ----------

function recentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberSearch(q) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(addRecent(recentSearches(), q)));
  } catch {
    // Storage blocked (private mode): suggestions just won't include recent searches.
  }
  fillSuggestions();
}

function fillSuggestions() {
  const names = [...new Set([...recentSearches(), ...featuredList.map((f) => f.name)])];
  $('q-suggest').replaceChildren(...names.map((n) => el('option', { value: n })));
}

async function search(query) {
  const myGen = ++gen;
  restore = false;
  showError(null);
  showStatus(`Looking up “${query}”…`);
  $('status-cancel').hidden = true;
  try {
    const r = await api.resolve(query);
    if (myGen !== gen) return;
    rememberSearch(query);
    update({ ra: r.ra, dec: r.dec, target: r.name || query });
    await buildAndShow();
  } catch (err) {
    if (myGen !== gen) return;
    if (err.status === 404) {
      const close = suggestNames(query, [...featuredList.map((f) => f.name), ...recentSearches()]);
      showError(`We couldn't find “${query}”. Check the spelling, or enter coordinates such as 133.795 -7.245.${close.length ? ' Did you mean:' : ''}`,
        null, close.map((n) => [n, () => { $('q').value = n; search(n); }]));
      return;
    }
    showError(friendly(err, 'name lookup'), () => search(query));
  }
}

async function buildAndShow() {
  const myGen = ++gen;
  const { ra, dec, fov, det } = state;
  showError(null);
  showStatus(`${LIVE_BUILD_MSG}…`);
  const signal = startBuildTimer(true);
  try {
    // Hosted (Vercel): one long POST that may return the finished view inline.
    const started = await api.startBuild({ ra, dec, fov, det }, { signal });
    if (myGen !== gen) return;
    if (started.view) {
      await showView(started.view, myGen);
      return;
    }
    // Local dev server: queued/running → poll. Featured targets: done → GET the view.
    let { status } = started;
    while (status !== 'done') {
      if (status === 'error') throw new Error('The server could not build this view.');
      await sleep(POLL_MS);
      if (myGen !== gen) return;
      const s = await api.buildStatus(started.key);
      if (myGen !== gen) return;
      status = s.status;
      if (status === 'error') throw new Error(s.error || s.message || 'The server could not build this view.');
      showStatus(s.status === 'queued' ? 'Waiting in line…' : (s.message || 'Working…'), Number.isFinite(s.progress) ? s.progress : null);
    }
    showStatus('Loading the image list…', 1);
    const v = await api.view(started.key);
    if (myGen !== gen) return;
    await showView(v, myGen);
  } catch (err) {
    if (myGen !== gen || err.status === -1) return;
    restore = false;
    showError(friendly(err, 'building the view'), () => buildAndShow());
  }
}

const framesOf = (v, mode) => (v ? (mode === 'visits' ? v.visits : v.stacks) || [] : []);

async function showView(v, myGen) {
  hideStatus();
  if (!framesOf(v, 'stack').length && !framesOf(v, 'visits').length) {
    // Keep whatever was on screen and offer the other bands.
    const others = Object.keys(BANDS).filter((d) => d !== v.det);
    showError(`SPHEREx has no images of this patch in band ${v.det} yet. Try another band or a nearby position.`, null,
      others.map((d) => [`Try ${d}`, () => { update({ det: d }); syncDetectors(); buildAndShow(); }]));
    if (view) update({ det: view.det });
    syncDetectors();
    return;
  }
  const samePosition = view && view.ra === v.ra && view.dec === v.dec && view.fov === v.fov;
  view = v;
  shownTarget = state.target;
  rememberView(v);
  $('home').hidden = true;
  $('viewer').hidden = false;
  $('view-title').textContent = state.target || `RA ${v.ra.toFixed(4)}°, Dec ${v.dec.toFixed(4)}°`;
  $('view-coords').textContent = `RA ${v.ra.toFixed(5)}° · Dec ${v.dec.toFixed(5)}° · ${v.det} (${BANDS[v.det] || ''} µm) · ${v.fov}° field · ${(v.visits || []).length} images in ${(v.windows || []).length} survey windows`;
  $('notes').replaceChildren(...(v.notes || []).map((n) => el('li', {}, n)));
  $('deep-info').textContent = `All ${v.deep?.n ?? ''} images added together: the deepest, least noisy view. Moving objects smear out.`;
  $('open-full').href = shareUrl(state, { embed: false });
  document.title = `${$('view-title').textContent} · SkyBlink`;
  syncDetectors();
  controls.syncStarInputs();
  if (!restore && !samePosition) analysis.reset();
  if (activeSideTab() === 'tab-atlas') loadAtlas();
  await loadFrames(myGen, !restore);
  // Same field, new band: re-measure the selected pixel in this band.
  if (samePosition && analysis.pixel && myGen === gen) analysis.pick(analysis.pixel, { reveal: false });
}

async function loadFrames(myGen = gen, fresh = false, { visit = null } = {}) {
  let mode = state.mode;
  if (!framesOf(view, mode).length) {
    mode = mode === 'stack' ? 'visits' : 'stack';
    update({ mode });
    setMode(mode);
  }
  const list = mode === 'visits' ? orderFrames(framesOf(view, mode), state.sort) : framesOf(view, mode);
  syncModeUi();
  compare.reset();
  $('stage-loading').hidden = false;
  let start = fresh ? 0 : Math.min(player.index, list.length - 1);
  if (restore) start = Math.min(state.frame, list.length - 1);
  if (visit !== null) start = Math.max(0, list.findIndex((f) => f.i === visit));
  try {
    const ok = await player.load(view, list, {
      startIndex: start,
      onProgress: (done, total) => { $('stage-loading-msg').textContent = `Loading frames ${done}/${total}…`; },
    });
    if (!ok) return; // a newer load replaced this one, and the player shows that one
  } catch {
    showError("Some image frames didn't load. Please try again.", () => loadFrames());
    return;
  } finally {
    $('stage-loading').hidden = true;
  }
  frames = list;
  $('scrub').max = String(list.length - 1);
  const pick = (i) => { compare.reset(); player.step(i - player.index); };
  renderTicks($('ticks'), list, pick);
  renderTimeStrip($('timestrip'), list, timePositions(list), windowStarts(list, view), pick);
  compare.fillSelects(restore ? state : {});
  controls.drawColorbar();
  onFrame(player.index, player.frame);
  const v = view;
  getCube(v).then((cube) => { if (view === v) player.setCube(cube); }).catch(() => {
    // Without the cube the PNG frames still play; differences/spectra explain the failure themselves.
  });
  if (restore) {
    restore = false;
    await applyRestoredState();
  } else if (!reducedMotion && list.length > 1 && fresh) {
    player.play();
  }
}

/** Reopen exactly what a shared link showed: selected pixel and compare tool. */
async function applyRestoredState() {
  if (state.px !== null && state.py !== null) {
    analysis.setAperture(state.ap);
    analysis.pick({ x: state.px, y: state.py });
  }
  if (state.tool !== 'animate') await compare.select(state.tool, { run: true });
  else if (!reducedMotion && frames.length > 1 && state.frame === 0) player.play();
}

function syncModeUi() {
  const visits = state.mode === 'visits';
  $('sort-wrap').hidden = !visits;
  $('visits-warning').hidden = !visits;
  controls.syncFlags(state.mode);
}

// ---------- player callbacks ----------

function onFrame(index, frame) {
  if (!frame) return;
  const title = frameTitle(frame, state.mode, view, index, frames.length || 1);
  $('frame-label').textContent = title;
  $('scrub').value = String(index);
  $('scrub').setAttribute('aria-valuetext', title);
  setActiveTick($('ticks'), index);
  setActiveDot($('timestrip'), index);
  renderMeta($('meta'), { view, frame, mode: state.mode });
  $('canvas').setAttribute('aria-label', `SPHEREx ${view.det} image: ${title}.${player.overlays.stars ? ' Gaia star markers on.' : ''} Click a pixel for its spectrum; scroll or pinch to zoom.`);
  analysis.onFrame();
  if (!player.playing && !player.blinkPair && state.frame !== index) update({ frame: index });
}

function onPlayState(playing) {
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').setAttribute('aria-label', playing ? 'Pause (space)' : 'Play (space)');
  if (!playing) update({ frame: player.index });
}

const leaveCompare = () => compare.reset();

function changeMode(mode) {
  if (mode === state.mode) return;
  update({ mode, frame: 0 });
  if (view) loadFrames(gen, true);
}

async function jumpToVisit(i) {
  leaveCompare();
  if (state.mode !== 'visits') {
    update({ mode: 'visits' });
    setMode('visits');
    await loadFrames(gen, false, { visit: i });
    return;
  }
  const k = frames.findIndex((f) => f.i === i);
  if (k >= 0) player.step(k - player.index);
}

// ---------- side tabs and Aladin ----------

const activeSideTab = () => document.querySelector('.side [aria-selected="true"]')?.id;

function onSideTab(id) {
  if (id === 'tab-atlas') loadAtlas();
  if (id === 'tab-lc') analysis.onFrame();
}

async function loadAtlas() {
  if (!view || aladin.key === view.key) return;
  aladin = { widget: null, key: view.key };
  const box = $('aladin');
  box.replaceChildren(el('p', { class: 'hint' }, 'Loading the Aladin sky atlas…'));
  try {
    const v = view;
    const widget = await showAladin(box, { ra: v.ra, dec: v.dec, fov: v.fov }, $('atlas-survey').value);
    if (aladin.key !== v.key) return;
    aladin = { ...aladin, widget };
    const P = v.grid.npix;
    drawFootprint(widget, [[-0.5, -0.5], [P - 0.5, -0.5], [P - 0.5, P - 0.5], [-0.5, P - 0.5]]
      .map(([x, y]) => { const s = unproject(x, y, v); return [s.ra, s.dec]; }));
    markAtlas();
  } catch (err) {
    aladin = { widget: null, key: null };
    box.replaceChildren(el('p', { class: 'hint' }, `${err.message} The rest of SkyBlink still works.`));
  }
}

function markAtlas() {
  const p = analysis.pixel;
  if (!aladin.widget || !p || !view) return;
  const s = unproject(p.x, p.y, view);
  markSelection(aladin.widget, s.ra, s.dec);
}

// ---------- detectors and field size ----------

function readyDetectors() {
  if (!view || state.ra === null) return new Set();
  const same = Math.abs(view.ra - state.ra) < 1e-6 && Math.abs(view.dec - state.dec) < 1e-6 && view.fov === state.fov;
  return same ? builtDetectors(view) : new Set();
}

function syncDetectors() {
  const ready = readyDetectors();
  document.querySelectorAll('#det-tabs .det').forEach((b) => {
    const d = b.dataset.det;
    b.setAttribute('aria-pressed', String(d === state.det));
    b.classList.toggle('ready', ready.has(d) && d !== state.det);
    b.title = ready.has(d) ? `${d}: ready, opens instantly` : `${d}: built live from the archive (1–2 minutes)`;
  });
  $('det-legend').hidden = ready.size < 2;
}

function chooseDetector(det) {
  if (det === state.det) return;
  if (state.ra !== null && view && !readyDetectors().has(det)
    && !window.confirm(`Band ${det} isn't built for this position yet. SkyBlink will fetch its images from NASA's archive, which usually takes 1–2 minutes. Continue?`)) return;
  update({ det });
  syncDetectors();
  if (state.ra !== null) buildAndShow();
}

/** Grey out field sizes the hosted server can't build live (GET /api/config), and say why. */
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
  if (restricted) {
    $('fov-hint').textContent = '0.2° and up: featured targets only.';
    $('fov-hint').title = 'Larger fields need more images than the hosted server can fetch within its 5-minute limit, so they are pre-built for featured targets only. Run SkyBlink locally to build any size.';
    $('fov').title = $('fov-hint').title;
  }
}

// ---------- sharing and export ----------

async function savePng() {
  try {
    const blob = await canvasPng($('canvas'));
    downloadBlob(blob, `${fileStem($('view-title').textContent)}-${view.det}-frame${player.index + 1}.png`);
  } catch (err) {
    toast(err.message);
  }
}

async function saveVideo() {
  if (!videoSupported($('canvas'))) {
    toast("This browser can't record video. Try Chrome, Edge or Firefox.");
    return;
  }
  if (frames.length < 2) {
    toast('There is only one frame here, so there is nothing to animate.');
    return;
  }
  leaveCompare();
  player.pause();
  const btn = $('save-video');
  btn.disabled = true;
  btn.textContent = 'Recording…';
  try {
    const { blob, ext } = await recordFrames($('canvas'), {
      frameCount: frames.length, fps: player.fps, step: (i) => player.setIndex(i), cycles: frames.length < 6 ? 3 : 1,
    });
    downloadBlob(blob, `${fileStem($('view-title').textContent)}-${view.det}-${state.mode}.${ext}`);
  } catch (err) {
    toast(err.message || 'Recording failed.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Record animation (video)';
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
  document.querySelectorAll('#det-tabs .det').forEach((b) => b.addEventListener('click', () => chooseDetector(b.dataset.det)));
  $('status-cancel').addEventListener('click', cancelBuild);
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
  $('loop-mode').addEventListener('change', (e) => {
    player.setLoopMode(e.target.value);
    update({ loop: e.target.value });
  });
  $('sort').addEventListener('change', (e) => {
    update({ sort: e.target.value, frame: 0 });
    if (view) loadFrames(gen, true);
  });
  $('blink-rate').addEventListener('change', (e) => update({ blinkHz: Number(e.target.value) }));
  $('canvas').addEventListener('click', () => setTimeout(markAtlas, 0));
  $('atlas-survey').addEventListener('change', () => setSurvey(aladin.widget, $('atlas-survey').value));
  $('copy-link').addEventListener('click', async () => {
    toast((await copyText(shareUrl(state, { embed: false }))) ? 'Link copied, including your view settings.' : 'Copy failed: copy the address bar instead.');
  });
  $('copy-embed').addEventListener('click', async () => {
    const title = ($('view-title').textContent || 'SkyBlink').replace(/"/g, '&quot;');
    const code = `<iframe src="${shareUrl(state, { embed: true })}" width="600" height="720" style="border:0;max-width:100%" title="SkyBlink: ${title}" loading="lazy"></iframe>`;
    toast((await copyText(code)) ? 'Embed code copied.' : 'Copy failed.');
  });
  $('save-png').addEventListener('click', savePng);
  $('save-video').addEventListener('click', saveVideo);
  $('keys-open').addEventListener('click', () => $('keys-dialog').showModal());
  $('home-link').addEventListener('click', (e) => {
    if (state.embed) return;
    e.preventDefault();
    goHome();
  });
  document.addEventListener('keydown', createKeyHandler({
    active: () => Boolean(view) && !$('viewer').hidden && !$('keys-dialog').open,
    toggle: () => player.toggle(),
    step: (d) => player.step(d),
    first: () => player.step(-player.index),
    last: () => player.step(frames.length - 1 - player.index),
    go: (i) => { if (i < frames.length) player.step(i - player.index); },
    zoom: (f) => player.zoomBy(f),
    fit: () => player.resetZoom(),
    tool: (t) => compare.select(t),
    blink: () => compare.toggleBlink(),
    diff: () => compare.select('diff', { run: true }),
    stars: () => controls.toggleStars(),
    help: () => $('keys-dialog').showModal(),
    leave: leaveCompare,
  }));
}

function goHome() {
  gen += 1;
  restore = false;
  player.pause();
  view = null;
  update({ ra: null, dec: null, target: null });
  showError(null);
  hideStatus();
  $('viewer').hidden = true;
  $('home').hidden = false;
  document.title = 'SkyBlink: watch the infrared sky change';
  syncDetectors();
}

function pickFeatured(f) {
  restore = false;
  $('q').value = f.name;
  $('fov').value = String(f.fov ?? state.fov);
  update({ ra: f.ra, dec: f.dec, target: f.name, fov: Number(f.fov ?? state.fov), det: f.det || state.det, frame: 0, px: null, py: null });
  syncDetectors();
  buildAndShow();
  $('main').focus({ preventScroll: true });
}

async function loadFeatured() {
  const thumbKey = (f) => f.key || `mock-${f.det}`;
  const media = {
    thumb: (f) => (api.MOCK ? 'mock/png/deep.png' : f.key ? `/api/png/${encodeURIComponent(f.key)}/deep.png` : null),
    frames: async (f) => (await api.view(thumbKey(f))).stacks.map((s) => s.png),
  };
  try {
    featuredList = await api.featured();
    renderGallery($('gallery'), featuredList, pickFeatured, media);
    fillSuggestions();
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
  player.setLoopMode(state.loop);
  player.setBlinkRate(state.blinkHz);
  $('loop-mode').value = state.loop;
  $('sort').value = state.sort;
  $('blink-rate').value = String(state.blinkHz);
  controls.applyState(state);
  analysis.setAperture(state.ap);
  setMode(state.mode);
  syncDetectors();
  if (state.target) $('q').value = state.target;
  if (matchMedia('(max-width: 560px)').matches) $('display-panel').open = false;
  bindEvents();
  fillSuggestions();
  if (!state.embed) {
    loadFeatured();
    applyConfig();
  }
  if (state.ra !== null) buildAndShow();
  else if (state.target) search(state.target);
  else writeUrlState(state);
}

init();
