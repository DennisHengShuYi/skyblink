// Canvas frame player. Frames render from the view's float cube once it arrives
// (shared stretch, colour map, levels, Catmull-Rom smoothing); until then from the
// PNGs. Zoom/pan/pinch, hover readout, crosshair, flags and Gaia overlays,
// play/pause/step with loop modes, A/B blink and still overrides (diff/deep/reference).
import { starGeometry, frameSpan, totalPm, filterStars, nearestStar } from './gaia.js';
import { planeFor } from './cube.js';
import {
  applyLevels, levelsLut, colormapLut, catmullRomUpscale, composeRGBA, planeToValues,
} from './render.js';
import { stackVariance, deepVariance } from './photometry.js';
import { nextIndex } from './frames.js';
import { FPS_MAX as PLAY_FPS_MAX } from './urlstate.js';
import { fitViewport, zoomAt, panBy, gridToScreen, screenToGrid } from './viewport.js';

const TARGET_PX = 720;
const MAX_CANVAS_PX = 1440;
const SWIPE_PX = 30;
const DRAG_PX = 4;
const STAR_HOVER_PX = 1.6; // grid pixels
const ARROW_MIN_MAS = 20;  // only stars moving at least this fast get a motion arrow
const FAST_PM = 0.5;       // ″/yr: highlighted and labelled
const SMOOTH_CACHE = 24;
const COLORS = { cross: 'rgba(255, 92, 92, 0.9)', star: 'rgba(92, 225, 255, 0.75)', arrow: '#ffd166', fast: '#ff9f1c', select: '#7CFC9A' };

export { levelsLut };
export const DEFAULT_DISPLAY = Object.freeze({ smooth: false, brightness: 1, contrast: 1, cmap: 'grey', stretch: 'asinh' });

export function loadImage(src, { crossOrigin = null } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${src}`));
    img.src = src;
  });
}

/** Frame → cube plane reference (`v<i>` for a visit, `s<window>` for a stack). */
export const frameRef = (f) => (Number.isInteger(f.i) ? `v${f.i}` : `s${f.window}`);
// Overrides that show the deep stack: 'deep' itself, and 'split' (deep stack on the right of a
// curtain, an older survey picture on the left). Their deep PNG is o.deepImg || o.img.
const deepish = (o) => Boolean(o) && (o.kind === 'deep' || o.kind === 'split');
const deepImgOf = (o) => (o.kind === 'split' ? o.deepImg : o.img);

export class Player {
  constructor(canvas, cb = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = { onFrame() {}, onPixel() {}, onPlayState() {}, onHover() {}, onViewport() {}, onSwipe: (d) => this.step(d), ...cb };
    this.view = null;
    this.frames = [];
    this.images = [];
    this.cube = null;
    this.flagImages = new Map();
    this.index = 0;
    this.dir = 1;
    this.fps = 2;
    this.loopMode = 'loop';
    this.blinkHz = 1;
    this.playing = false;
    this.blinkPair = null;
    this.override = null;
    this.overlays = { flags: false, stars: false, exaggeration: 10, gmax: 21, minPm: 0, cross: 'cross' };
    this.decorators = []; // extra overlays drawn after the stars: fn(ctx, player)
    this.frameImages = null; // optional replacement images per frame (false-colour view)
    this.display = { ...DEFAULT_DISPLAY };
    this.selected = null;
    this.marks = [];
    this.hoverStar = null;
    this.loadToken = 0;
    this.timer = null;
    this.cache = new Map();
    this.greyCache = new Map();
    this.varCache = new Map();
    this.vp = { cx: 0, cy: 0, z: 1 };
    this.bindPointer();
  }

  get P() {
    return this.view ? this.view.grid.npix : 1;
  }

  /** Show frame `startIndex` as soon as it loads; the rest keep loading in the background. */
  async load(view, frames, { startIndex = 0, onProgress = () => {} } = {}) {
    const token = ++this.loadToken;
    this.pause();
    this.stopBlink();
    const sameView = this.view && view && this.view.key === view.key;
    let done = 0;
    onProgress(0, frames.length);
    const images = new Array(frames.length).fill(null);
    const start = Math.min(Math.max(0, startIndex), frames.length - 1);
    const loads = frames.map((f, i) => loadImage(f.png).then((img) => {
      done += 1;
      if (token !== this.loadToken) return;
      images[i] = img;
      onProgress(done, frames.length);
      if (i === this.index && this.images === images) this.render();
    }));
    await loads[start];
    if (token !== this.loadToken) return false;
    this.view = view;
    if (!sameView) {
      this.cube = null;
      this.varCache = new Map();
      this.vp = fitViewport(view.grid.npix);
      this.selected = null;
    }
    this.marks = [];
    this.frames = frames;
    this.images = images;
    this.flagImages = new Map();
    this.span = frameSpan(frames);
    this.override = null;
    this.clearCaches();
    this.resize();
    this.setIndex(start);
    if (this.overlays.flags) this.loadFlags();
    Promise.allSettled(loads).then(() => {
      if (token === this.loadToken && loads.length !== done) onProgress(done, frames.length);
    });
    return true;
  }

  /** Switch to float-cube rendering (exact shared stretch, colour maps, values under the cursor). */
  setCube(cube) {
    this.cube = cube;
    this.varCache = new Map();
    this.clearCaches();
    this.render();
  }

  clearCaches() {
    this.cache = new Map();
    this.smoothKeys = [];
    this.greyCache = new Map();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const zoom = Math.max(1, Math.floor(Math.min(MAX_CANVAS_PX, TARGET_PX * dpr) / this.P));
    this.canvas.width = this.P * zoom;
    this.canvas.height = this.P * zoom;
  }

  get frame() {
    return this.frames[this.index];
  }

  get loaded() {
    return Boolean(this.images[this.index]);
  }

  setIndex(i) {
    if (!this.frames.length) return;
    const n = this.frames.length;
    this.index = ((i % n) + n) % n;
    this.render();
    this.cb.onFrame(this.index, this.frame);
  }

  step(delta) {
    this.pause();
    this.stopBlink();
    this.setIndex(this.index + delta);
  }

  setFps(fps) {
    this.fps = Math.min(PLAY_FPS_MAX, Math.max(0.1, Number(fps) || 2)); // flash-safety cap, see urlstate.js
    if (this.playing) this.schedule();
  }

  setLoopMode(mode) {
    this.loopMode = mode;
    this.dir = 1;
  }

  play() {
    if (this.frames.length < 2) return;
    this.stopBlink();
    if (this.loopMode === 'once' && this.index === this.frames.length - 1) this.setIndex(0);
    this.playing = true;
    this.schedule();
    this.cb.onPlayState(true);
  }

  pause() {
    clearTimeout(this.timer);
    if (this.playing) {
      this.playing = false;
      if (this.display.smooth) this.render(); // full-quality smoothing on the still frame
      this.cb.onPlayState(false);
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.playing) return;
      const next = nextIndex(this.index, this.frames.length, this.loopMode, this.dir);
      this.dir = next.dir;
      this.setIndex(next.index);
      if (next.stop) this.pause();
      else this.schedule();
    }, 1000 / this.fps);
  }

  setBlinkRate(hz) {
    this.blinkHz = Math.min(2, Math.max(0.5, hz)); // ≤ 2 changes/s: well under the 3/s WCAG limit
    if (this.blinkPair) this.startBlink(...this.blinkPair);
  }

  startBlink(a, b) {
    this.pause();
    this.stopBlink();
    this.clearOverride();
    this.blinkPair = [a, b];
    this.setIndex(a);
    this.blinkTimer = setInterval(() => {
      const [x, y] = this.blinkPair;
      this.setIndex(this.index === x ? y : x);
    }, 1000 / this.blinkHz);
  }

  stopBlink() {
    clearInterval(this.blinkTimer);
    this.blinkPair = null;
  }

  /**
   * Show a still instead of the frames: {kind: 'diff', rgba} (P×P colours),
   * {kind: 'deep', img} (rendered from the cube when available) or {kind: 'reference', img}.
   */
  setOverride(override) {
    this.pause();
    this.stopBlink();
    this.override = override;
    this.render();
  }

  clearOverride() {
    if (!this.override) return;
    this.override = null;
    this.render();
  }

  setDisplay(changes) {
    this.display = { ...this.display, ...changes };
    this.clearCaches();
    this.render();
  }

  setOverlay(name, value) {
    this.overlays = { ...this.overlays, [name]: value };
    if (name === 'flags' && value) this.loadFlags();
    this.render();
  }

  async loadFlags() {
    const token = this.loadToken;
    await Promise.all(this.frames.map(async (f) => {
      if (!f.flags_png || this.flagImages.has(f.flags_png)) return;
      try {
        const img = await loadImage(f.flags_png);
        if (token === this.loadToken) this.flagImages.set(f.flags_png, img);
      } catch {
        // A missing flags overlay is not fatal; the frame is simply drawn without it.
      }
    }));
    if (token === this.loadToken) this.render();
  }

  // ---------- zoom and pan ----------

  setViewport(vp) {
    this.vp = vp;
    this.render();
    this.cb.onViewport(vp);
  }

  zoomBy(factor, gx = this.vp.cx, gy = this.vp.cy) {
    if (!this.view) return;
    this.setViewport(zoomAt(this.vp, factor, gx, gy, this.P));
  }

  resetZoom() {
    if (this.view) this.setViewport(fitViewport(this.P));
  }

  // ---------- pixel data ----------

  /** Float plane for the current frame (or the deep stack override), or null before the cube loads. */
  currentPlane() {
    if (!this.cube || !this.view) return null;
    if (deepish(this.override)) return planeFor(this.cube, this.view, 'deep');
    if (this.override) return null;
    return planeFor(this.cube, this.view, frameRef(this.frame));
  }

  currentVariance() {
    if (!this.cube) return null;
    const deep = deepish(this.override);
    const f = this.frame;
    const key = deep ? 'deep' : frameRef(f);
    if (!this.varCache.has(key)) {
      let v;
      if (deep) v = deepVariance(this.cube);
      else if (Number.isInteger(f.i)) v = this.cube.variance((this.view.visits || []).findIndex((x) => x.i === f.i));
      else v = stackVariance(this.cube, this.view, f.window);
      this.varCache.set(key, v);
    }
    return this.varCache.get(key);
  }

  /** {value, sigma} in MJy/sr at grid pixel (x, y) of what is on screen, or null. */
  valueAt(x, y) {
    const plane = this.currentPlane();
    if (!plane) return null;
    const k = y * this.P + x;
    const v = this.currentVariance();
    const sigma = v && v[k] > 0 ? Math.sqrt(v[k]) : NaN;
    return { value: plane[k], sigma };
  }

  // ---------- rendering ----------

  /** 0..1 display values for the current frame: from the cube, else from the PNG's grey levels. */
  frameValues() {
    const { stretch, brightness, contrast } = this.display;
    const plane = this.currentPlane();
    if (plane) return planeToValues(plane, this.view.stretch || { lo: 0, hi: 1 }, stretch, brightness, contrast);
    const img = deepish(this.override) ? deepImgOf(this.override) : this.images[this.index];
    if (!img) return null;
    const grey = this.pngGrey(img);
    if (!grey) return null;
    return grey.map((g) => applyLevels(g, brightness, contrast));
  }

  pngGrey(img) {
    if (this.greyCache.has(img)) return this.greyCache.get(img);
    const P = this.P;
    const c = document.createElement('canvas');
    c.width = P;
    c.height = P;
    const sctx = c.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, P, P);
    let grey = null;
    try {
      const px = sctx.getImageData(0, 0, P, P).data;
      grey = new Float32Array(P * P);
      for (let k = 0; k < grey.length; k += 1) grey[k] = px[k * 4] / 255;
    } catch {
      grey = null; // cross-origin: drawn as-is
    }
    this.greyCache.set(img, grey);
    return grey;
  }

  /** Draw extra overlays (finds rings, tour pulse) after the built-in ones. */
  addDecorator(fn) {
    this.decorators = [...this.decorators, fn];
  }

  /** Replace the frame images (e.g. colour frames, one per frame) or restore with null. */
  useImages(images) {
    this.frameImages = images;
    this.render();
  }

  /** Composed image (canvas) for the current frame under the current display settings. */
  composed() {
    const o = this.override;
    if (!o && this.frameImages) return this.frameImages[this.index] || null;
    if (o?.kind === 'reference') return o.img;
    if (o?.kind === 'diff') return this.rgbaCanvas(o.rgba, this.P);
    const smooth = this.display.smooth && !this.playing; // Catmull-Rom only on still frames
    const key = `${deepish(o) ? 'deep' : this.index}|${this.cube ? 'c' : 'p'}|${smooth ? 's' : 'n'}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const values = this.frameValues();
    if (!values) {
      const img = deepish(o) ? deepImgOf(o) : this.images[this.index];
      return img || null;
    }
    const lut = colormapLut(this.display.cmap);
    const P = this.P;
    let out;
    if (smooth) {
      const n = Math.min(this.canvas.width, P * 12);
      out = this.rgbaCanvas(composeRGBA(catmullRomUpscale(values, P, n), lut), n);
      this.smoothKeys.push(key);
      if (this.smoothKeys.length > SMOOTH_CACHE) this.cache.delete(this.smoothKeys.shift());
    } else {
      out = this.rgbaCanvas(composeRGBA(values, lut), P);
    }
    this.cache.set(key, out);
    return out;
  }

  rgbaCanvas(rgba, n) {
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    c.getContext('2d').putImageData(new ImageData(rgba, n, n), 0, 0);
    return c;
  }

  render() {
    if (!this.view || !this.frames.length) return;
    const { ctx } = this;
    const size = this.canvas.width;
    const P = this.P;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const tl = gridToScreen(this.vp, P, size, 0, 0);
    const span = size * this.vp.z;
    const base = this.composed();
    if (base) {
      // Reference images are photos at display resolution: always smooth them.
      // Reference photos always; smoothed views use the browser's filter for diffs and during playback.
      ctx.imageSmoothingEnabled = this.override?.kind === 'reference' || (this.display.smooth && (this.override?.kind === 'diff' || this.playing));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base, tl.x, tl.y, span, span);
      if (this.override?.kind === 'split') this.drawSplit(tl, span);
    } else {
      ctx.fillStyle = 'rgba(232, 236, 248, 0.7)';
      ctx.font = `${Math.round(size / 40)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Loading this frame…', size / 2, size / 2);
      ctx.textAlign = 'start';
    }
    ctx.imageSmoothingEnabled = false;
    const flags = this.frame?.flags_png && this.flagImages.get(this.frame.flags_png);
    if (this.overlays.flags && !this.override && flags) ctx.drawImage(flags, tl.x, tl.y, span, span);
    if (this.overlays.stars) this.drawStars();
    this.decorators.forEach((draw) => draw(ctx, this));
    if (this.selected) this.drawSelection();
    this.drawCrosshair();
    if (this.marks.length) this.drawMarks();
  }

  /** Curtain: the older picture (o.img) left of `o.at` (0..1 of the field), the deep stack right. */
  drawSplit(tl, span) {
    const { ctx } = this;
    const o = this.override;
    const cut = tl.x + span * Math.min(1, Math.max(0, o.at));
    ctx.save();
    ctx.beginPath();
    ctx.rect(tl.x, tl.y, cut - tl.x, span);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(o.img, tl.x, tl.y, span, span);
    ctx.restore();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2 * this.unit;
    ctx.beginPath();
    ctx.moveTo(cut, Math.max(0, tl.y));
    ctx.lineTo(cut, Math.min(this.canvas.height, tl.y + span));
    ctx.stroke();
  }

  /**
   * Annotation marks in grid coordinates (pixel centre = integer + 0.5 like everything else):
   * {kind: 'ring', x, y, r (grid px), color, label?, dashed?} or
   * {kind: 'arrow', x0, y0, x1, y1, color, label?}. Used by Then & Now, Measure it and the puzzle.
   */
  setMarks(marks) {
    this.marks = Array.isArray(marks) ? marks : [];
    this.render();
  }

  drawMarks() {
    const { ctx } = this;
    const u = this.unit;
    const px = this.pixelSize;
    ctx.font = `${Math.round(13 * u)}px system-ui, sans-serif`;
    this.marks.forEach((m) => {
      ctx.strokeStyle = m.color || '#7CFC9A';
      ctx.fillStyle = m.color || '#7CFC9A';
      ctx.lineWidth = (m.width || 2) * u;
      ctx.setLineDash(m.dashed ? [5 * u, 4 * u] : []);
      if (m.kind === 'arrow') {
        const a = this.toScreen(m.x0 + 0.5, m.y0 + 0.5);
        const b = this.toScreen(m.x1 + 0.5, m.y1 + 0.5);
        drawArrow(ctx, a.x, a.y, b.x, b.y, Math.max(7 * u, px * 0.8));
        if (m.label) ctx.fillText(m.label, b.x + 6 * u, b.y - 6 * u);
      } else {
        const c = this.toScreen(m.x + 0.5, m.y + 0.5);
        const r = Math.max(7 * u, (m.r || 1.5) * px);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
        ctx.stroke();
        if (m.label) ctx.fillText(m.label, c.x + r + 4 * u, c.y - r * 0.4);
      }
    });
    ctx.setLineDash([]);
  }

  /** Screen position of a grid coordinate (pixel centres are at +0.5). */
  toScreen(gx, gy) {
    return gridToScreen(this.vp, this.P, this.canvas.width, gx, gy);
  }

  /** Canvas pixels per grid pixel at the current zoom. */
  get pixelSize() {
    return (this.canvas.width / this.P) * this.vp.z;
  }

  get unit() {
    return this.canvas.width / TARGET_PX;
  }

  drawCrosshair() {
    const style = this.overlays.cross;
    if (style === 'off') return;
    const { ctx } = this;
    const c = this.toScreen(this.P / 2, this.P / 2);
    const px = this.pixelSize;
    const u = this.unit;
    ctx.strokeStyle = COLORS.cross;
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    if (style === 'corners') {
      const r = Math.max(8 * u, px * 2.5);
      const arm = Math.max(5 * u, px * 0.9);
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        ctx.moveTo(c.x + sx * r, c.y + sy * (r - arm));
        ctx.lineTo(c.x + sx * r, c.y + sy * r);
        ctx.lineTo(c.x + sx * (r - arm), c.y + sy * r);
      });
    } else {
      const gap = Math.max(8 * u, px * 3); // clears a star's core and its Gaia marker
      const len = Math.max(14 * u, px * 3);
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
        ctx.moveTo(c.x + dx * gap, c.y + dy * gap);
        ctx.lineTo(c.x + dx * (gap + len), c.y + dy * (gap + len));
      });
    }
    ctx.stroke();
  }

  starGeo() {
    if (!this.view) return [];
    const mjd = this.frame && Number.isFinite(this.frame.mjd) ? this.frame.mjd : this.span.start;
    const stars = filterStars(Array.isArray(this.view.stars) ? this.view.stars : [], this.overlays);
    return starGeometry({ ...this.view, stars }, mjd, this.span, this.overlays.exaggeration);
  }

  drawStars() {
    const { ctx } = this;
    const u = this.unit;
    const px = this.pixelSize;
    const gap = Math.max(4 * u, px * 1.4);  // ticks start outside the star's core...
    const tick = Math.max(4 * u, px * 0.9); // ...so the marker never covers what it marks
    this.starGeo().forEach(({ star, now, arrow }) => {
      const pm = totalPm(star);
      const fast = pm >= FAST_PM;
      const hover = this.hoverStar && this.hoverStar.star === star;
      if (pm * 1000 >= ARROW_MIN_MAS) {
        ctx.lineWidth = (fast ? 2 : 1.25) * u;
        ctx.strokeStyle = COLORS.arrow;
        const a = this.toScreen(arrow.x0 + 0.5, arrow.y0 + 0.5);
        const b = this.toScreen(arrow.x1 + 0.5, arrow.y1 + 0.5);
        drawArrow(ctx, a.x, a.y, b.x, b.y, Math.max(5 * u, px * 0.8));
      }
      const s = this.toScreen(now.x + 0.5, now.y + 0.5);
      ctx.strokeStyle = fast ? COLORS.fast : hover ? '#ffffff' : COLORS.star;
      ctx.lineWidth = (fast || hover ? 2 : 1.25) * u;
      ctx.beginPath();
      ctx.moveTo(s.x - gap - tick, s.y);
      ctx.lineTo(s.x - gap, s.y);
      ctx.moveTo(s.x, s.y - gap - tick);
      ctx.lineTo(s.x, s.y - gap);
      ctx.stroke();
      if (fast) {
        ctx.fillStyle = COLORS.fast;
        ctx.font = `${Math.round(12 * u)}px system-ui, sans-serif`;
        ctx.fillText(`${pm.toFixed(2)}″/yr`, s.x + gap, s.y - gap);
      }
    });
  }

  drawSelection() {
    const { ctx } = this;
    const { x, y, r = 0 } = this.selected;
    const a = this.toScreen(x - r, y - r);
    const w = (2 * r + 1) * this.pixelSize;
    ctx.strokeStyle = COLORS.select;
    ctx.lineWidth = 2 * this.unit;
    ctx.strokeRect(a.x - 1, a.y - 1, w + 2, w + 2);
  }

  select(pixel) {
    this.selected = pixel;
    this.render();
  }

  // ---------- pointer: click, swipe, drag-pan, pinch, wheel, hover ----------

  gridAt(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = ((evt.clientX - rect.left) / rect.width) * this.canvas.width;
    const sy = ((evt.clientY - rect.top) / rect.height) * this.canvas.width;
    return screenToGrid(this.vp, this.P, this.canvas.width, sx, sy);
  }

  /** Map a pointer event to grid pixel (col, row), or null outside the grid. */
  pixelAt(evt) {
    const g = this.gridAt(evt);
    const x = Math.floor(g.x);
    const y = Math.floor(g.y);
    if (x < 0 || y < 0 || x >= this.P || y >= this.P) return null;
    return { x, y };
  }

  hover(evt) {
    if (!this.view) return;
    const pixel = evt ? this.pixelAt(evt) : null;
    let star = null;
    if (pixel && this.overlays.stars) {
      const g = this.gridAt(evt);
      star = nearestStar(this.starGeo(), g.x - 0.5, g.y - 0.5, STAR_HOVER_PX);
    }
    if ((star && star.star) !== (this.hoverStar && this.hoverStar.star)) {
      this.hoverStar = star;
      this.render();
    }
    this.cb.onHover(pixel, star, evt);
  }

  bindPointer() {
    const pointers = new Map();
    let start = null;
    let pinch = null;
    let dragged = false;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY, vp: this.vp };
        dragged = false;
      } else if (pointers.size === 2 && this.view) {
        const [p, q] = [...pointers.values()];
        const mid = { clientX: (p.x + q.x) / 2, clientY: (p.y + q.y) / 2 };
        pinch = { d: Math.hypot(p.x - q.x, p.y - q.y), vp: this.vp, g: this.gridAt(mid) };
        start = null;
      }
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        this.setViewport(zoomAt(pinch.vp, d / pinch.d, pinch.g.x, pinch.g.y, this.P));
        return;
      }
      if (start && this.view && this.vp.z > 1) {
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dragged || Math.hypot(dx, dy) > DRAG_PX) {
          dragged = true;
          const rect = c.getBoundingClientRect();
          const perGrid = (rect.width / this.P) * this.vp.z;
          this.setViewport(panBy(start.vp, dx / perGrid, dy / perGrid, this.P));
          return;
        }
      }
      if (e.pointerType === 'mouse' || !start) this.hover(e);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        start = null;
        return;
      }
      if (!start || !this.view || e.type === 'pointercancel') {
        start = null;
        return;
      }
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (dragged) return;
      if (this.vp.z === 1 && Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        this.cb.onSwipe(dx < 0 ? 1 : -1);
        return;
      }
      const pixel = this.pixelAt(e);
      if (pixel) this.cb.onPixel(pixel);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hover(null);
    });
    c.addEventListener('wheel', (e) => {
      if (!this.view) return;
      e.preventDefault();
      const g = this.gridAt(e);
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), g.x, g.y);
    }, { passive: false });
    c.addEventListener('dblclick', () => this.resetZoom());
  }
}

function drawArrow(ctx, x0, y0, x1, y1, head) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const h = Math.min(head, len * 0.5);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * Math.cos(ang - 0.45), y1 - h * Math.sin(ang - 0.45));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - h * Math.cos(ang + 0.45), y1 - h * Math.sin(ang + 0.45));
  ctx.stroke();
}
