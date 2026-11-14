// Gathers pixel-spectrum points across detectors, client-side, from data cubes:
// the current view, its `siblings` (other detectors' pre-built views), and any
// other detectors the user built this session at the same ra/dec/fov.
import * as api from './api.js';
import { loadCube } from './cube.js';
import { pixelSeries } from './photometry.js';

const sessionViews = new Map(); // positionKey → Map(det → view)
const siblingViews = new Map(); // view key → Promise<view>

const positionKey = (v) => `${Number(v.ra).toFixed(5)},${Number(v.dec).toFixed(5)},${v.fov}`;
const detOf = (v) => v.det || v.band?.det;

/** Remember a view built in this session so later spectra can include its detector. */
export function rememberView(view) {
  const pos = positionKey(view);
  const byDet = new Map(sessionViews.get(pos) || []);
  byDet.set(detOf(view), view);
  sessionViews.set(pos, byDet);
}

function siblingView(key) {
  if (!siblingViews.has(key)) {
    const p = api.view(key);
    siblingViews.set(key, p);
    p.catch(() => siblingViews.delete(key));
  }
  return siblingViews.get(key);
}

/** One view per detector: current first, then session builds, then (if asked) siblings. */
function sources(view, withSiblings) {
  const current = detOf(view);
  const out = [{ det: current, view: Promise.resolve(view) }];
  const seen = new Set([current]);
  const session = sessionViews.get(positionKey(view)) || new Map();
  session.forEach((v, det) => {
    if (seen.has(det)) return;
    seen.add(det);
    out.push({ det, view: Promise.resolve(v) });
  });
  Object.entries(withSiblings ? view.siblings || {} : {}).forEach(([det, key]) => {
    if (seen.has(det) || !key) return;
    seen.add(det);
    out.push({ det, view: siblingView(key) });
  });
  return out;
}

/** Pre-built other-detector views not yet in this session (each costs one cube download). */
export function extraBands(view) {
  const have = new Set([detOf(view), ...(sessionViews.get(positionKey(view)) || new Map()).keys()]);
  return Object.keys(view.siblings || {}).filter((d) => !have.has(d));
}

/** Approximate download size of one cube of this view, in MB. */
export function cubeMegabytes(view) {
  const c = view.cube || {};
  const P = c.npix || view.grid?.npix || 0;
  return ((3 * (c.n_visits || 0) + (c.n_stacks || 0) + 1) * P * P * 2) / 1e6;
}

/**
 * Points at grid pixel (x, y), aperture radius r, from the current detector, other
 * detectors built this session and, with `allBands`, the pre-built siblings.
 * Returns {points, failed: [det...]}. Rejects only if the current view's cube fails.
 */
export async function gatherSpectrum(view, x, y, { r = 0, allBands = false } = {}) {
  const list = sources(view, allBands);
  const results = await Promise.allSettled(list.map(async ({ det, view: vp }) => {
    const v = await vp;
    const cube = await loadCube(v);
    return { det, points: pixelSeries(cube, v, x, y, r) };
  }));
  if (results[0].status === 'rejected') throw results[0].reason;
  const points = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') points.push(...r.value.points);
    else failed.push(list[i].det);
  });
  return { points: points.sort((a, b) => a.um - b.um), failed: failed.filter(Boolean) };
}

/** Detectors that open instantly at this view's position: itself, pre-built siblings, session builds. */
export function builtDetectors(view) {
  return new Set([detOf(view), ...Object.keys(view.siblings || {}), ...(sessionViews.get(positionKey(view)) || new Map()).keys()]);
}
