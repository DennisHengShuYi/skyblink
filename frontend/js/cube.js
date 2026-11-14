// Float data cube from the manifest (`view.cube`): little-endian float16 planes of
// P×P (row 0 = north, col 0 = east), in the order img[N], var[N], um[N],
// stack[W], deep[1]. NaN = masked. Decoded with a lookup table (no Float16Array).
import { fetchBinary } from './api.js';

let f16Table = null;

/** 65536-entry float16 → float32 lookup table. */
function table() {
  if (f16Table) return f16Table;
  f16Table = new Float32Array(65536);
  for (let h = 0; h < 65536; h += 1) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    let v;
    if (exp === 0) v = frac * 2 ** -24;
    else if (exp === 31) v = frac ? NaN : Infinity;
    else v = (1 + frac / 1024) * 2 ** (exp - 15);
    f16Table[h] = sign * v;
  }
  return f16Table;
}

function base64ToBuffer(b64) {
  const clean = b64.replace(/^data:[^,]*,/, '');
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function decode(buffer) {
  const lut = table();
  const dv = new DataView(buffer);
  const n = Math.floor(buffer.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = lut[dv.getUint16(i * 2, true)];
  return out;
}

class Cube {
  constructor(meta, data) {
    this.P = meta.npix;
    this.N = meta.n_visits;
    this.W = meta.n_stacks;
    this.data = data;
    this.size = this.P * this.P;
    const expected = (3 * this.N + this.W + 1) * this.size;
    if (data.length < expected) throw new Error(`Cube is too short (${data.length} of ${expected} values).`);
  }

  plane(offsetPlanes) {
    const start = offsetPlanes * this.size;
    return this.data.subarray(start, start + this.size);
  }

  img(i) { return this.plane(i); }

  variance(i) { return this.plane(this.N + i); }

  um(i) { return this.plane(2 * this.N + i); }

  stack(w) { return this.plane(3 * this.N + w); }

  deep() { return this.plane(3 * this.N + this.W); }
}

const cache = new Map();

/** Load (once per view key) and decode the view's cube. Rejects if the view has none. */
export function loadCube(view) {
  if (cache.has(view.key)) return cache.get(view.key);
  const meta = view.cube;
  const promise = (async () => {
    if (!meta || (!meta.b64 && !meta.url)) throw new Error('This view has no pixel data for comparisons.');
    if (meta.dtype && meta.dtype !== 'float16') throw new Error(`Unsupported cube type ${meta.dtype}.`);
    const buffer = meta.b64 ? base64ToBuffer(meta.b64) : await fetchBinary(meta.url);
    return new Cube(meta, decode(buffer));
  })();
  cache.set(view.key, promise);
  promise.catch(() => cache.delete(view.key));
  return promise;
}

/** Plane for a frame ref: `s<window>`, `v<i>` or `deep`. */
export function planeFor(cube, view, ref) {
  if (ref === 'deep') return cube.deep();
  const n = Number(ref.slice(1));
  if (ref[0] === 's') {
    const idx = (view.stacks || []).findIndex((s) => s.window === n);
    return cube.stack(idx >= 0 ? idx : n);
  }
  const idx = (view.visits || []).findIndex((v) => v.i === n);
  return cube.img(idx >= 0 ? idx : n);
}

function median(values) {
  if (!values.length) return NaN;
  const s = Float32Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** b − a rendered as a P×P canvas (red = brighter in b, blue = brighter in a). */
export function differenceCanvas(a, b, P) {
  const d = new Float32Array(a.length);
  const finite = [];
  for (let i = 0; i < d.length; i += 1) {
    d[i] = b[i] - a[i];
    if (Number.isFinite(d[i])) finite.push(d[i]);
  }
  const med = median(finite);
  const sigma = 1.4826 * median(finite.map((v) => Math.abs(v - med)));
  const s = 12 * sigma > 0 ? 12 * sigma : 1;
  const norm = Math.asinh(5);
  const canvas = document.createElement('canvas');
  canvas.width = P;
  canvas.height = P;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(P, P);
  const px = img.data;
  for (let i = 0; i < d.length; i += 1) {
    const o = i * 4;
    px[o + 3] = 255;
    if (!Number.isFinite(d[i])) {
      px[o] = 60; px[o + 1] = 60; px[o + 2] = 60;
      continue;
    }
    const v = Math.max(-1, Math.min(1, d[i] / s));
    let mag = Math.asinh(Math.abs(v) / 0.2) / norm;
    if (Math.abs(v) * 12 < 2.5) mag *= 0.35;
    px[o] = 20 + (v > 0 ? mag * 235 : 0);
    px[o + 1] = 20 + mag * 40;
    px[o + 2] = 20 + (v < 0 ? mag * 235 : 0);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Spectrum points at grid pixel (x, y) from every visit of one view's cube. */
export function pixelPoints(cube, view, x, y) {
  if (x < 0 || y < 0 || x >= cube.P || y >= cube.P) return [];
  const k = y * cube.P + x;
  const det = view.det || view.band?.det;
  const visits = view.visits || [];
  const points = [];
  for (let i = 0; i < cube.N; i += 1) {
    const flux = cube.img(i)[k];
    const um = cube.um(i)[k];
    if (!Number.isFinite(flux) || !Number.isFinite(um)) continue;
    const variance = cube.variance(i)[k];
    points.push({
      um,
      flux,
      err: Number.isFinite(variance) && variance >= 0 ? Math.sqrt(variance) : null,
      mjd: visits[i]?.mjd,
      window: visits[i]?.window,
      det,
    });
  }
  return points;
}
