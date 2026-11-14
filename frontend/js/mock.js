// Offline stand-in for the backend, enabled with ?mock=1. Serves frontend/mock/*
// (manifest, PNGs, float16 cube) and fakes name resolution, /api/config and builds.
// Add &mockpoll=1 to exercise the dev-server polling flow instead of inline views.

const BANDS = {
  D1: [0.75, 1.09], D2: [1.10, 1.62], D3: [1.63, 2.41],
  D4: [2.42, 3.82], D5: [3.83, 4.41], D6: [4.42, 5.00],
};
const BUILD_MS = 4500;
const builds = new Map();

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function notFound(message) {
  const err = new Error(message);
  err.name = 'ApiError';
  err.status = 404;
  return err;
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Mock file missing: ${path}`);
  return res.json();
}

function sexToDeg(text, isRa) {
  const parts = text.replace(/[hdms:°'"]/gi, ' ').trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return NaN;
  const sign = text.trim().startsWith('-') ? -1 : 1;
  const v = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600;
  return sign * v * (isRa ? 15 : 1);
}

function parseCoords(q) {
  const dec = q.trim().match(/^(-?\d+(?:\.\d+)?)[\s,]+([+-]?\d+(?:\.\d+)?)$/);
  if (dec) return { ra: Number(dec[1]), dec: Number(dec[2]) };
  const sex = q.trim().match(/^(\S+(?:\s+\S+\s+\S+)?)\s+([+-]\S+(?:\s+\S+\s+\S+)?)$/);
  if (sex) {
    const ra = sexToDeg(sex[1], true);
    const d = sexToDeg(sex[2], false);
    if (Number.isFinite(ra) && Number.isFinite(d)) return { ra, dec: d };
  }
  return null;
}

export async function resolve(q) {
  await delay(250);
  const coords = parseCoords(q);
  if (coords) return { ...coords, name: q.trim(), source: 'parsed' };
  const list = await getJson('mock/featured.json');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = list.find((f) => norm(f.name).includes(norm(q)) || norm(q).includes(norm(f.slug)));
  if (!hit) throw notFound(`Could not resolve '${q}'.`);
  return { ra: hit.ra, dec: hit.dec, name: hit.name, source: 'sesame' };
}

export async function featured() {
  await delay(150);
  return getJson('mock/featured.json');
}

const LIVE_FOVS = [0.05, 0.1];
const INLINE_BUILD_MS = 3000;
const featuredKeys = new Set();
const pollMode = () => new URLSearchParams(location.search).get('mockpoll') === '1';

function httpError(message, status) {
  const err = new Error(message);
  err.name = 'ApiError';
  err.status = status;
  return err;
}

export async function config() {
  await delay(50);
  return { live_fovs: LIVE_FOVS, mode: 'vercel' };
}

const mockKey = ({ ra, dec, fov, det }) => `mock-${det}-${Number(ra).toFixed(4)}-${Number(dec).toFixed(4)}-${fov}`;

/**
 * Featured targets: `done` without a view (client then GETs /api/view). Live builds:
 * one long POST that returns the view inline (Vercel), or `?mockpoll=1` for the
 * queued → running → done polling flow of the local dev server.
 */
export async function startBuild({ ra, dec, fov, det }) {
  const key = mockKey({ ra, dec, fov, det });
  const known = (await getJson('mock/featured.json'))
    .some((f) => Math.abs(f.ra - ra) < 1e-4 && Math.abs(f.dec - dec) < 1e-4);
  if (known) {
    await delay(200);
    featuredKeys.add(key);
    return { key, status: 'done' };
  }
  if (!LIVE_FOVS.includes(fov)) throw httpError('Live builds support 0.05° and 0.1° fields only. Larger fields are available for featured targets.', 400);
  if (pollMode()) {
    if (!builds.has(key)) builds.set(key, Date.now());
    return { key, status: 'queued' };
  }
  await delay(INLINE_BUILD_MS);
  return { key, status: 'done', view: await inlineView(key) };
}

export async function buildStatus(key) {
  await delay(100);
  const started = builds.get(key);
  if (started === undefined) throw notFound('Unknown build.');
  const progress = Math.min(1, (Date.now() - started) / BUILD_MS);
  const total = 16;
  return {
    key,
    status: progress >= 1 ? 'done' : progress < 0.15 ? 'queued' : 'running',
    progress,
    message: progress >= 1 ? 'Done' : `Fetching ${Math.round(progress * total)}/${total} cutouts`,
    error: null,
  };
}

export async function view(key) {
  const v = await getJson('mock/view.json');
  const det = /^mock-(D[1-6])/.exec(key)?.[1] || v.det;
  const [um_min, um_max] = BANDS[det];
  const siblings = featuredKeys.has(key)
    ? Object.fromEntries(Object.keys(BANDS).filter((d) => d !== det).map((d) => [d, key.replace(/^mock-D\d/, `mock-${d}`)]))
    : undefined;
  return {
    ...v,
    key,
    det,
    band: { det, um_min, um_max },
    cube: { ...v.cube, url: `mock/cube.bin?det=${det}` },
    ...(siblings ? { siblings } : {}),
  };
}

// ---------- inline (Vercel-style) view: data-URI PNGs and a base64 cube ----------

async function toDataUri(path) {
  const blob = await (await fetch(path)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function inlineView(key) {
  const v = await view(key);
  const visits = await Promise.all(v.visits.map(async (x) => ({
    ...x, png: await toDataUri(x.png), flags_png: await toDataUri(x.flags_png),
  })));
  const stacks = await Promise.all(v.stacks.map(async (x) => ({ ...x, png: await toDataUri(x.png) })));
  const deep = { ...v.deep, png: await toDataUri(v.deep.png) };
  const b64 = bufferToBase64(await fetchBinary(v.cube.url));
  return { ...v, visits, stacks, deep, cube: { ...v.cube, url: null, b64 } };
}

// ---------- per-detector cubes: rescale the D6 mock cube to another band ----------

function f16ToF32(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24;
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

function f32ToF16(v) {
  if (Number.isNaN(v)) return 0x7e00;
  const sign = v < 0 || Object.is(v, -0) ? 0x8000 : 0;
  const a = Math.abs(v);
  if (a >= 65520) return sign | 0x7c00;
  if (a < 2 ** -24) return sign;
  if (a < 2 ** -14) return sign | Math.round(a / 2 ** -24);
  let exp = Math.floor(Math.log2(a));
  let frac = Math.round((a / 2 ** exp - 1) * 1024);
  if (frac === 1024) { frac = 0; exp += 1; }
  return sign | ((exp + 15) << 10) | frac;
}

const shape = (um) => 0.4 * Math.exp(-((um - 1.6) ** 2) / 1.2) + 0.05;

export async function fetchBinary(url) {
  const res = await fetch(url.split('?')[0]);
  if (!res.ok) throw new Error(`Mock file missing: ${url}`);
  const buffer = await res.arrayBuffer();
  const det = new URL(url, location.href).searchParams.get('det') || 'D6';
  if (det === 'D6') return buffer;
  const v = await getJson('mock/view.json');
  const P2 = v.cube.npix ** 2;
  const N = v.cube.n_visits;
  const [lo, hi] = BANDS[det];
  const factor = shape((lo + hi) / 2) / shape(4.71);
  const dv = new DataView(buffer.slice(0));
  const map = (planeStart, planeCount, fn) => {
    for (let i = planeStart * P2; i < (planeStart + planeCount) * P2; i += 1) {
      dv.setUint16(i * 2, f32ToF16(fn(f16ToF32(dv.getUint16(i * 2, true)))), true);
    }
  };
  map(0, N, (x) => x * factor);
  map(N, N, (x) => x * factor * factor);
  map(2 * N, N, (um) => lo + ((um - 4.42) / 0.58) * (hi - lo));
  map(3 * N, v.cube.n_stacks + 1, (x) => x * factor);
  return dv.buffer;
}
