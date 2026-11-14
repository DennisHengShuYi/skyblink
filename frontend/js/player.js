// Canvas frame player: crisp integer-scaled pixels, crosshair, optional flags and
// Gaia overlays, play/pause/step, A/B blink and a still-image override (diff/deep).
import { starGeometry, frameSpan, totalPm } from './gaia.js';

const TARGET_PX = 720;
const BLINK_INTERVAL_MS = 1000; // 1 change per second: well under the WCAG 3-flashes/s limit
const SWIPE_PX = 30;
const COLORS = { cross: 'rgba(255, 92, 92, 0.9)', star: '#5ce1ff', arrow: '#ffd166', fast: '#ff9f1c' };

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image ${src}`));
    img.src = src;
  });
}

export class Player {
  constructor(canvas, { onFrame = () => {}, onPixel = () => {}, onPlayState = () => {} } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = { onFrame, onPixel, onPlayState };
    this.view = null;
    this.frames = [];
    this.images = [];
    this.flagImages = new Map();
    this.index = 0;
    this.fps = 2;
    this.playing = false;
    this.blinkPair = null;
    this.override = null;
    this.overlays = { flags: false, stars: false, exaggeration: 10 };
    this.selected = null;
    this.loadToken = 0;
    this.timer = null;
    this.bindPointer();
  }

  /** Preload every frame PNG, then show frame 0. `frames`: [{png, flags_png?, mjd}] */
  async load(view, frames, onProgress = () => {}) {
    const token = ++this.loadToken;
    this.pause();
    this.stopBlink();
    let done = 0;
    onProgress(0, frames.length);
    const images = await Promise.all(frames.map((f) => loadImage(f.png).then((img) => {
      done += 1;
      if (token === this.loadToken) onProgress(done, frames.length);
      return img;
    })));
    if (token !== this.loadToken) return false;
    this.view = view;
    this.frames = frames;
    this.images = images;
    this.flagImages = new Map();
    this.span = frameSpan(frames);
    this.override = null;
    this.selected = null;
    this.resize();
    this.setIndex(Math.min(this.index, frames.length - 1));
    if (this.overlays.flags) this.loadFlags();
    return true;
  }

  resize() {
    const npix = this.view.grid.npix;
    this.zoom = Math.max(1, Math.floor(TARGET_PX / npix));
    this.canvas.width = npix * this.zoom;
    this.canvas.height = npix * this.zoom;
  }

  get frame() {
    return this.frames[this.index];
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
    this.fps = fps;
    if (this.playing) this.schedule();
  }

  play() {
    if (this.frames.length < 2) return;
    this.stopBlink();
    this.playing = true;
    this.schedule();
    this.cb.onPlayState(true);
  }

  pause() {
    clearTimeout(this.timer);
    if (this.playing) {
      this.playing = false;
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
      this.setIndex(this.index + 1);
      this.schedule();
    }, 1000 / this.fps);
  }

  startBlink(a, b) {
    this.pause();
    this.clearOverride();
    this.blinkPair = [a, b];
    this.setIndex(a);
    this.blinkTimer = setInterval(() => {
      const [x, y] = this.blinkPair;
      this.setIndex(this.index === x ? y : x);
    }, BLINK_INTERVAL_MS);
  }

  stopBlink() {
    clearInterval(this.blinkTimer);
    this.blinkPair = null;
  }

  /** Show a still image (difference or deep stack) instead of the frames. */
  setOverride(img, kind) {
    this.pause();
    this.stopBlink();
    this.override = { img, kind };
    this.render();
  }

  clearOverride() {
    if (!this.override) return;
    this.override = null;
    this.render();
  }

  setOverlay(name, value) {
    this.overlays = { ...this.overlays, [name]: value };
    if (name === 'flags' && value) this.loadFlags();
    this.render();
  }

  async loadFlags() {
    const token = this.loadToken;
    await Promise.all(this.frames.map(async (f, i) => {
      if (!f.flags_png || this.flagImages.has(i)) return;
      try {
        const img = await loadImage(f.flags_png);
        if (token === this.loadToken) this.flagImages.set(i, img);
      } catch {
        // A missing flags overlay is not fatal; the frame is simply drawn without it.
      }
    }));
    if (token === this.loadToken) this.render();
  }

  render() {
    if (!this.view || !this.images.length) return;
    const { ctx, zoom } = this;
    const size = this.canvas.width;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    const base = this.override ? this.override.img : this.images[this.index];
    ctx.drawImage(base, 0, 0, size, size);
    const flags = this.flagImages.get(this.index);
    if (this.overlays.flags && !this.override && flags) ctx.drawImage(flags, 0, 0, size, size);
    if (this.overlays.stars) this.drawStars();
    if (this.selected) this.drawSelection();
    this.drawCrosshair(size, zoom);
  }

  drawCrosshair(size, zoom) {
    const { ctx } = this;
    const c = size / 2;
    const gap = Math.max(6, zoom * 1.5);
    const len = Math.max(14, zoom * 4);
    ctx.strokeStyle = COLORS.cross;
    ctx.lineWidth = 2;
    ctx.beginPath();
    [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dx, dy]) => {
      ctx.moveTo(c + dx * gap, c + dy * gap);
      ctx.lineTo(c + dx * (gap + len), c + dy * (gap + len));
    });
    ctx.stroke();
  }

  drawStars() {
    const { ctx, zoom } = this;
    const mjd = this.frame && Number.isFinite(this.frame.mjd) ? this.frame.mjd : this.span.start;
    const geo = starGeometry(this.view, mjd, this.span, this.overlays.exaggeration);
    const px = (v) => (v + 0.5) * zoom;
    const r = Math.max(5, zoom * 1.6);
    geo.forEach(({ star, now, arrow }) => {
      const fast = totalPm(star) >= 0.5;
      ctx.lineWidth = fast ? 2 : 1.25;
      ctx.strokeStyle = COLORS.arrow;
      drawArrow(ctx, px(arrow.x0), px(arrow.y0), px(arrow.x1), px(arrow.y1), Math.max(5, zoom));
      ctx.strokeStyle = fast ? COLORS.fast : COLORS.star;
      ctx.beginPath();
      ctx.arc(px(now.x), px(now.y), r, 0, Math.PI * 2);
      ctx.stroke();
      if (fast) {
        ctx.fillStyle = COLORS.fast;
        ctx.font = `${Math.max(11, zoom)}px system-ui, sans-serif`;
        ctx.fillText(`${totalPm(star).toFixed(2)}″/yr`, px(now.x) + r + 3, px(now.y) - r);
      }
    });
  }

  drawSelection() {
    const { ctx, zoom } = this;
    ctx.strokeStyle = '#7CFC9A';
    ctx.lineWidth = 2;
    ctx.strokeRect(this.selected.x * zoom - 1, this.selected.y * zoom - 1, zoom + 2, zoom + 2);
  }

  select(pixel) {
    this.selected = pixel;
    this.render();
  }

  /** Map a pointer event to grid pixel (col, row). */
  pixelAt(evt) {
    const rect = this.canvas.getBoundingClientRect();
    const npix = this.view.grid.npix;
    const x = Math.floor(((evt.clientX - rect.left) / rect.width) * npix);
    const y = Math.floor(((evt.clientY - rect.top) / rect.height) * npix);
    if (x < 0 || y < 0 || x >= npix || y >= npix) return null;
    return { x, y };
  }

  bindPointer() {
    let start = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY };
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!start || !this.view) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
        this.step(dx < 0 ? 1 : -1);
        return;
      }
      const pixel = this.pixelAt(e);
      if (pixel) this.cb.onPixel(pixel);
    });
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
