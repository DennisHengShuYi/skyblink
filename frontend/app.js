// SkyBlink frontend entry point: state, search → build → view flow, frame loading,
// detector/fov choices, side panels, sharing, export and URL state. Viewer controls
// live in js/controls.js, spectrum + light curve in js/analysis.js, keys in js/keys.js.
import * as api from './js/api.js';
import { readUrlState, writeUrlState, shareUrl, clampFps } from './js/urlstate.js';
import { Player } from './js/player.js';
import { createCompare } from './js/compare.js';
import { createThenNow } from './js/thennow-ui.js';
import { createMeasure } from './js/measure-ui.js';
import { createSkyClock } from './js/skyclock-ui.js';
import { createPuzzleUi } from './js/puzzle-ui.js';
import { renderHomeExtras } from './js/home-extras.js';
import { startKiosk } from './js/kiosk.js';
import { createNavigator } from './js/navigate.js';
import { openLesson } from './js/lesson.js';
import { resolveLevel, plainTitle, CALM_FPS, CALM_BLINK_HZ } from './js/simple.js';
import { bindSimpleBar, storedValue, storeValue } from './js/simple-ui.js';
import { healthMap, healthLabel } from './js/health.js';
import { createControls } from './js/controls.js';
import { createAnalysis } from './js/analysis.js';
import { createKeyHandler } from './js/keys.js';
import { loadCube } from './js/cube.js';
import { rememberView, builtDetectors } from './js/spectrum-data.js';
import { orderFrames, timePositions, windowStarts } from './js/frames.js';
import { unproject } from './js/gaia.js';
import { suggestNames, addRecent, friendlyAnswer } from './js/search.js';
import { renderMoveCard, renderDistanceCard, renderDescribeCard } from './js/movecard.js';
import { showBuildPreview, createReadyBanner } from './js/deadends.js';
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
const LETTER_KEYS_KEY = 'skyblink.letterKeys';
const LEVEL_KEY = 'skyblink.level';
const CALM_KEY = 'skyblink.calm';
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let state = readUrlState();
// Calm motion (or the system's reduce-motion setting): no autoplay, slower playback and blink.
const calmNow = () => prefersReduced || Boolean(state.calm);
let view = null;
let frames = [];
let gen = 0;
let aladin = { widget: null, key: null };
let featuredList = [];
let restore = state.ra !== null || Boolean(state.target); // apply URL view settings once
let build = null; // {abort, timer}
let shownTarget = null; // target name of the view on screen (restored on cancel)
let background = null; // a live build the visitor walked away from: {snapshot}
let health = new Map(); // visit i → {level, reasons}: the picture health check
let afterView = null; // one-shot action once the next view is on screen (puzzle, birthday, remote)

const player = new Player($('canvas'), {
  onFrame, onPlayState, onPixel: (p) => {
    if (measure.active) measure.tap(p);
    else if (puzzle.active) puzzle.tap(p);
    else analysis.pick(p);
  }, onHover: (...a) => controls.onHover(...a),
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
const setStageBadge = (text) => {
  $('stage-badge').hidden = !text;
  $('stage-badge').textContent = text || '';
};
const thenNow = createThenNow({ player, current, setBadge: setStageBadge, calm: () => calmNow() });
const measure = createMeasure({ player, current, getCube, setBadge: setStageBadge });
const compare = createCompare({ player, current, getCube, onChange: (s) => update(s), extraTools: { then: thenNow, measure } });
const skyClock = createSkyClock({ current: () => ({ view, frame: player.frame }) });
const puzzle = createPuzzleUi({ player, current, compare, open: (slug, det, opts) => openFeatured(slug, det, opts) });
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
  const kind = friendlyAnswer(query);
  if (kind) {
    const movers = featuredList.filter((f) => f.kind === kind.suggest);
    showError(kind.message, null, movers.map((f) => [f.name, () => pickFeatured(f)]));
    return;
  }
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


/** A walked-away build finished; the banner opens it on request. */
const readyBanner = createReadyBanner({
  onShow: async ({ view: v, snapshot }) => {
    restore = false;
    update({ ...snapshot, frame: 0, px: null, py: null });
    $('q').value = snapshot.target || '';
    $('fov').value = String(snapshot.fov);
    await showView(v, ++gen);
  },
});

async function buildAndShow() {
  const myGen = ++gen;
  const { ra, dec, fov, det } = state;
  const snapshot = { ra, dec, fov, det, target: state.target };
  showError(null);
  showStatus(`${LIVE_BUILD_MSG}…`);
  showBuildPreview(snapshot, {
    featured: featuredList, mock: api.MOCK,
    meanwhile: (f) => { background = { snapshot }; pickFeatured(f); },
  });
  const signal = startBuildTimer(true);
  try {
    // Hosted (Vercel): one long POST that may return the finished view inline.
    const started = await api.startBuild({ ra, dec, fov, det }, { signal });
    if (myGen !== gen) {
      // The visitor chose "Meanwhile, watch…": keep the finished build instead of wasting it.
      if (started.view && background && background.snapshot === snapshot) { background = null; readyBanner.park(started.view, snapshot); }
      return;
    }
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
    if (background && background.snapshot === snapshot) {
      background = null;
      if (err.status !== -1) toast(`Fetching ${snapshot.target || 'that patch'} in the background didn't work. Try it again later.`);
    }
    if (myGen !== gen || err.status === -1) return;
    restore = false;
    showError(friendly(err, 'building the view'), () => buildAndShow());
  }
}

/** Health of every single picture: from flags at once, refined with noise once the cube loads. */
const computeHealth = (v, cube = null) => { health = healthMap(v.visits || [], cube ? (k) => cube.img(k) : null); };

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
  computeHealth(v);
  $('home').hidden = true;
  $('viewer').hidden = false;
  $('view-title').textContent = state.target || `RA ${v.ra.toFixed(4)}°, Dec ${v.dec.toFixed(4)}°`;
  $('view-coords').textContent = `RA ${v.ra.toFixed(5)}° · Dec ${v.dec.toFixed(5)}° · ${v.det} (${BANDS[v.det] || ''} µm) · ${v.fov}° field · ${(v.visits || []).length} images in ${(v.windows || []).length} survey windows`;
  $('notes').replaceChildren(...(v.notes || []).map((n) => el('li', {}, n)));
  $('deep-info').textContent = `All ${v.deep?.n ?? ''} images added together: the deepest, least noisy view. Moving objects smear out.`;
  $('open-full').href = shareUrl(state, { embed: false });
  document.title = `${$('view-title').textContent} · SkyBlink`;
  syncDetectors();
  thenNow.sync(v);
  measure.sync(v);
  $('sb-then').hidden = document.querySelector('#tool-group [data-tool="then"]').hidden;
  $('sb-measure').hidden = document.querySelector('#tool-group [data-tool="measure"]').hidden;
  if (activeSideTab() === 'tab-year') skyClock.render();
  renderMoveCard(v, { player, featured: () => featuredList, pick: pickFeatured });
  renderDistanceCard(v, { player });
  renderDescribeCard(v, { player, getCube });
  controls.syncStarInputs();
  if (!restore && !samePosition) analysis.reset();
  if (activeSideTab() === 'tab-atlas') loadAtlas();
  await loadFrames(myGen, !restore && !afterView);
  // Same field, new band: re-measure the selected pixel in this band.
  if (samePosition && analysis.pixel && myGen === gen) analysis.pick(analysis.pixel, { reveal: false });
  if (afterView && myGen === gen) {
    const action = afterView;
    afterView = null;
    await action(v);
  }
}

async function loadFrames(myGen = gen, fresh = false, { visit = null } = {}) {
  let mode = state.mode;
  if (!framesOf(view, mode).length) {
    mode = mode === 'stack' ? 'visits' : 'stack';
    update({ mode });
    setMode(mode);
  }
  let list = mode === 'visits' ? orderFrames(framesOf(view, mode), state.sort) : framesOf(view, mode);
  if (mode === 'visits' && state.skip) {
    const kept = list.filter((f) => health.get(f.i)?.level !== 'poor');
    if (kept.length >= 2) {
      if (kept.length < list.length) toast(`Skipping ${list.length - kept.length} poor picture${list.length - kept.length === 1 ? '' : 's'}.`);
      list = kept;
    }
  }
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
  getCube(v).then((cube) => {
    if (view !== v) return;
    player.setCube(cube);
    computeHealth(v, cube);
    onFrame(player.index, player.frame);
  }).catch(() => {
    // Without the cube the PNG frames still play; differences/spectra explain the failure themselves.
  });
  if (restore) {
    restore = false;
    await applyRestoredState();
  } else if (!calmNow() && list.length > 1 && fresh) {
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
  else if (!calmNow() && frames.length > 1 && state.frame === 0) player.play();
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
  const title = level === 'simple'
    ? plainTitle(frame, state.mode, view, index, frames.length || 1)
    : frameTitle(frame, state.mode, view, index, frames.length || 1);
  const h = state.mode === 'visits' && Number.isInteger(frame.i) ? health.get(frame.i) : null;
  $('health-note').hidden = !h || h.level === 'ok';
  $('health-note').textContent = h && h.level !== 'ok' ? `This picture: ${h.level === 'poor' ? 'poor' : 'use with care'}. ${h.reasons.join('; ')}. It is kept on purpose, so you can judge it yourself.` : '';
  $('frame-label').textContent = `${title}${healthLabel(h)}`;
  $('scrub').value = String(index);
  $('scrub').setAttribute('aria-valuetext', title);
  setActiveTick($('ticks'), index);
  setActiveDot($('timestrip'), index);
  renderMeta($('meta'), { view, frame, mode: state.mode });
  $('canvas').setAttribute('aria-label', `SPHEREx ${view.det} image: ${title}.${player.overlays.stars ? ' Gaia star markers on.' : ''} Click a pixel for its spectrum; scroll or pinch to zoom.`);
  analysis.onFrame();
  skyClock.onFrame();
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
  if (id === 'tab-year') skyClock.render();
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

function chooseDetector(det, { confirmed = false } = {}) {
  if (det === state.det) return;
  if (!confirmed && state.ra !== null && view && !readyDetectors().has(det)) {
    // In-page question instead of a blocking browser dialog; the current view keeps playing.
    showError(`Band ${det} isn't ready for this patch yet. SkyBlink can fetch its pictures from NASA's archive, which usually takes 1–2 minutes.`, null, [
      [`Fetch ${det}`, () => { showError(null); chooseDetector(det, { confirmed: true }); }],
      [`Stay on ${state.det}`, () => showError(null)],
    ]);
    return;
  }
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

let letterKeys = true;

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
    player.setFps(calmNow() ? Math.min(CALM_FPS, fps) : fps);
    update({ fps });
  });
  $('loop-mode').addEventListener('change', (e) => {
    player.setLoopMode(e.target.value);
    update({ loop: e.target.value });
  });
  $('skip-poor').addEventListener('change', (e) => {
    update({ skip: e.target.checked, frame: 0 });
    if (view) loadFrames(gen, true);
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
  letterKeys = storedValue(LETTER_KEYS_KEY) !== '0';
  $('keys-letters').checked = letterKeys;
  $('keys-letters').addEventListener('change', (e) => {
    letterKeys = e.target.checked;
    storeValue(LETTER_KEYS_KEY, letterKeys ? '1' : '0');
  });
  document.addEventListener('keydown', createKeyHandler({
    active: () => Boolean(view) && !$('viewer').hidden && !$('keys-dialog').open,
    letters: () => letterKeys,
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

// ---------- simple view and calm motion ----------

let level = 'simple';

function applyLevel(next, { remember = false } = {}) {
  level = next;
  document.body.classList.toggle('simple', level === 'simple');
  $('level-toggle').textContent = level === 'simple' ? 'More tools' : 'Simple view';
  $('level-toggle').setAttribute('aria-pressed', String(level === 'full'));
  if (remember) storeValue(LEVEL_KEY, level);
  update({ level: state.level ? level : null });
  if (level === 'simple') {
    if (state.mode !== 'stack') {
      setMode('stack');
      changeMode('stack');
    }
    const tab = activeSideTab();
    if (tab && document.getElementById(tab)?.classList.contains('advanced')) selectSideTab('tab-info');
    if (['diff', 'deep', 'reference'].includes(compare.tool)) compare.reset();
  }
  if (view && player.frame) onFrame(player.index, player.frame);
}

function applyCalm(on, { remember = false } = {}) {
  state = { ...state, calm: on };
  $('calm').checked = on;
  if (remember) storeValue(CALM_KEY, on ? '1' : '0');
  writeUrlState(state);
  const fps = on ? Math.min(CALM_FPS, state.fps) : state.fps;
  player.setFps(fps);
  player.setBlinkRate(on ? CALM_BLINK_HZ : state.blinkHz);
  if (on && player.playing) player.pause();
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

const { openFeatured, openVisit } = createNavigator({
  featured: () => featuredList, pick: (f) => pickFeatured(f), afterView: (fn) => { afterView = fn; },
  jumpToVisit: (i) => jumpToVisit(i), pause: () => player.pause(),
});

function pickFeatured(f) {
  puzzle.stop();
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
  $('skip-poor').checked = state.skip;
  $('blink-rate').value = String(state.blinkHz);
  controls.applyState(state);
  analysis.setAperture(state.ap);
  setMode(state.mode);
  syncDetectors();
  if (state.target) $('q').value = state.target;
  if (matchMedia('(max-width: 560px)').matches) $('display-panel').open = false;
  bindEvents();
  $('level-toggle').addEventListener('click', () => applyLevel(level === 'simple' ? 'full' : 'simple', { remember: true }));
  $('calm').addEventListener('change', (e) => applyCalm(e.target.checked, { remember: true }));
  bindSimpleBar({ player, compare, frames: () => frames, shareLink: () => shareUrl(state, { embed: false }), leaveCompare });
  applyLevel(resolveLevel(state.level, storedValue(LEVEL_KEY)));
  if (state.calm || storedValue(CALM_KEY) === '1') applyCalm(true);
  fillSuggestions();
  if (!state.embed) {
    renderHomeExtras({ openVisit, startPuzzle: (p) => puzzle.start(p, (featuredList.find((x) => x.slug === p.slug) || {}).name || ''), printLesson: () => openLesson({ featured: featuredList, view: api.view }).catch((e) => toast(e.message)) });
    loadFeatured();
    applyConfig();
  }
  if (state.kiosk) {
    document.body.classList.add('kiosk', 'simple');
    applyCalm(true);
    startKiosk({
      featured: () => featuredList,
      show: (f) => { update({ mode: 'stack' }); setMode('stack'); pickFeatured(f); },
      caption: (text) => { $('kiosk-caption').hidden = !text; $('kiosk-caption').textContent = text || ''; },
      reset: () => { compare.reset(); analysis.reset(); player.setMarks([]); puzzle.stop(); try { localStorage.removeItem(RECENT_KEY); } catch { /* blocked */ } },
    });
    return;
  }
  if (state.ra !== null) buildAndShow();
  else if (state.target) search(state.target);
  else writeUrlState(state);
}

init();
