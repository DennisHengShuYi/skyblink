// Finds things that moved or changed brightness between survey-window stacks.
// Pure functions on float planes (P×P, row 0 = north); no DOM. Labels say
// "candidate", never "discovery" — see finds-ui.js for the wording.
import { project, propagate, totalPm } from './gaia.js';

const MAD_TO_SIGMA = 1.4826;
const APERTURE_R = 2; // (2r+1)² box for centroid and flux
const MOVE_MIN_PX = 0.7;
const MOVE_MIN_SNR = 5;
const MOVE_MIN_SIGMAS = 3.5; // fitted shift must exceed 3.5× its uncertainty
const FIT_MIN_SNR = 1.5; // weaker windows still help the motion fit, weighted by SNR²
const MAX_JUMP_PX = 2.5; // a window centroid further than this from the source is another object
const DETECT_EDGE_PX = 4; // cutout coverage gets patchy near the edge
const PSF_SIGMA_PX = 1.0; // centroid error ≈ PSF sigma / SNR
const GLOW_INNER_PX = 2;
const GLOW_OUTER_PX = 5;
const PLATEAU_FRACTION = 0.9; // glow pixels this close to the core level are clipped/filled too
const VAR_MIN_FRACTION = 0.25;
const VAR_MIN_SIGMA = 5;
const GAIA_MATCH_PX = 1.5;
const SATURATED_PM_ARCSEC = 0.5;
const MIN_SEPARATION_PX = 3;
const RECENTRE_RADIUS = 3;
const DAYS_PER_YEAR = 365.25;
const SATURATED_VAR_FACTOR = 100; // filled saturated cores carry ~1e4× the typical variance
const HALO_PX = 12; // glare around a saturated star makes fake movers and variables
const DUPLICATE_PX = 2;
const GAIA_PM_MISMATCH = 0.1; // ″/yr: a measured mover on a Gaia star slower than this is a coincidence

function median(values) {
  if (!values.length) return NaN;
  const s = Float64Array.from(values).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median and robust sigma (1.4826·MAD) of the finite values. NaN for an empty plane. */
export function robustStats(plane) {
  const vals = [];
  for (let i = 0; i < plane.length; i += 1) if (Number.isFinite(plane[i])) vals.push(plane[i]);
  const med = median(vals);
  if (!vals.length) return { median: NaN, sigma: NaN };
  return { median: med, sigma: MAD_TO_SIGMA * median(vals.map((v) => Math.abs(v - med))) };
}

function isPeak(plane, P, x, y) {
  const v = plane[y * P + x];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const n = plane[(y + dy) * P + (x + dx)];
      if (!Number.isFinite(n)) continue;
      // Ties (flat saturated tops) resolve to the first pixel in reading order.
      const earlier = dy < 0 || (dy === 0 && dx < 0);
      if (earlier ? n >= v : n > v) return false;
    }
  }
  return true;
}

/** Local maxima above median + nsigma·sigma, away from the edge, brightest first. */
export function findSources(deep, P, { nsigma = 6, edge = 2, maxSources = 40 } = {}) {
  const { median: med, sigma } = robustStats(deep);
  if (!(sigma > 0)) return [];
  const thr = med + nsigma * sigma;
  const found = [];
  for (let y = edge; y < P - edge; y += 1) {
    for (let x = edge; x < P - edge; x += 1) {
      const v = deep[y * P + x];
      if (Number.isFinite(v) && v > thr && isPeak(deep, P, x, y)) found.push({ x, y, snr: (v - med) / sigma });
    }
  }
  found.sort((a, b) => b.snr - a.snr);
  const kept = [];
  found.forEach((s) => {
    if (kept.length >= maxSources) return;
    if (kept.every((k) => Math.hypot(k.x - s.x, k.y - s.y) >= MIN_SEPARATION_PX)) kept.push(s);
  });
  return kept;
}

/** Background-subtracted centroid and flux in a (2r+1)² box at (round(x), round(y)). */
export function measure(plane, P, x, y, r = APERTURE_R) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ring = [];
  const rr = r + 2;
  for (let dy = -rr; dy <= rr; dy += 1) {
    for (let dx = -rr; dx <= rr; dx += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
      const px = x0 + dx;
      const py = y0 + dy;
      if (px < 0 || py < 0 || px >= P || py >= P) continue;
      const v = plane[py * P + px];
      if (Number.isFinite(v)) ring.push(v);
    }
  }
  const bg = ring.length ? median(ring) : 0;
  let flux = 0;
  let wsum = 0;
  let sx = 0;
  let sy = 0;
  let masked = 0;
  const n = (2 * r + 1) ** 2;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const px = x0 + dx;
      const py = y0 + dy;
      const v = px >= 0 && py >= 0 && px < P && py < P ? plane[py * P + px] : NaN;
      if (!Number.isFinite(v)) {
        masked += 1;
        continue;
      }
      const s = v - bg;
      flux += s;
      const w = Math.max(s, 0);
      wsum += w;
      sx += w * px;
      sy += w * py;
    }
  }
  if (masked > n / 2 || wsum <= 0) return { cx: x0, cy: y0, flux: NaN, ok: false };
  return { cx: sx / wsum, cy: sy / wsum, flux, ok: true };
}

/**
 * Brightness of a saturated star from its outer glow: background-subtracted flux in an
 * annulus (2–5 px) around the core, skipping pixels at the clipped/filled plateau level.
 */
export function measureGlow(plane, P, x, y) {
  const ring = [];
  const glow = [];
  const reach = Math.ceil(GLOW_OUTER_PX) + 3;
  let core = -Infinity;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const v = plane[(Math.round(y) + dy) * P + Math.round(x) + dx];
      if (Number.isFinite(v)) core = Math.max(core, v);
    }
  }
  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= P || py >= P) continue;
      const v = plane[py * P + px];
      if (!Number.isFinite(v)) continue;
      const d = Math.hypot(px - x, py - y);
      if (d >= GLOW_INNER_PX && d <= GLOW_OUTER_PX) {
        if (v < PLATEAU_FRACTION * core) glow.push(v);
      }
      else if (d >= GLOW_OUTER_PX + 1.5 && d <= GLOW_OUTER_PX + 3) ring.push(v);
    }
  }
  if (glow.length < 8) return { cx: x, cy: y, flux: NaN, ok: false, n: glow.length };
  const bg = ring.length ? median(ring) : 0;
  return { cx: x, cy: y, flux: glow.reduce((a, v) => a + (v - bg), 0), ok: true, n: glow.length };
}

/** Re-centre on this stack's own peak (a mover is off the deep position) and measure. */
function measureNear(plane, P, x, y) {
  let best = { v: -Infinity, x: Math.round(x), y: Math.round(y) };
  for (let dy = -RECENTRE_RADIUS; dy <= RECENTRE_RADIUS; dy += 1) {
    for (let dx = -RECENTRE_RADIUS; dx <= RECENTRE_RADIUS; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px < 0 || py < 0 || px >= P || py >= P) continue;
      const v = plane[py * P + px];
      if (Number.isFinite(v) && v > best.v) best = { v, x: px, y: py };
    }
  }
  const recentred = measure(plane, P, best.x, best.y);
  // In a very noisy window the brightest nearby pixel can be a noise spike: measure in place.
  if (recentred.ok && Math.hypot(recentred.cx - x, recentred.cy - y) <= MAX_JUMP_PX) return recentred;
  return measure(plane, P, x, y);
}

/**
 * Saturated pixels from the per-image variance planes: the pipeline fills NaN saturated
 * cores and gives them a huge variance. A pixel counts if that happens in ≥ half the images.
 */
export function saturationMask(variancePlanes, P) {
  const mask = new Uint8Array(P * P);
  if (!variancePlanes || !variancePlanes.length) return mask;
  const counts = new Uint16Array(P * P);
  variancePlanes.forEach((v) => {
    const { median: typical } = robustStats(v);
    if (!(typical > 0)) return;
    for (let i = 0; i < v.length; i += 1) if (v[i] > SATURATED_VAR_FACTOR * typical) counts[i] += 1;
  });
  for (let i = 0; i < mask.length; i += 1) mask[i] = counts[i] * 2 >= variancePlanes.length ? 1 : 0;
  return mask;
}

function maskedNear(mask, P, x, y, radius) {
  if (!mask) return false;
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const px = Math.round(x) + dx;
      const py = Math.round(y) + dy;
      if (px >= 0 && py >= 0 && px < P && py < P && mask[py * P + px] && Math.hypot(dx, dy) <= radius) return true;
    }
  }
  return false;
}

/** Flat top: ≥ 3 pixels of the 3×3 block within 1% of the peak (clipped or filled core). */
function isSaturated(deep, P, x, y) {
  const peak = deep[y * P + x];
  let flat = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const v = deep[(y + dy) * P + (x + dx)];
      if (Number.isFinite(v) && Math.abs(v - peak) <= 0.01 * Math.abs(peak)) flat += 1;
    }
  }
  return flat >= 3;
}

function gaiaMatch(view, x, y, mjd) {
  let best = null;
  let bestD = GAIA_MATCH_PX;
  (Array.isArray(view.stars) ? view.stars : []).forEach((star) => {
    const p = propagate(star, mjd);
    const q = project(p.ra, p.dec, view);
    if (!q) return;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d <= bestD) {
      best = star;
      bestD = d;
    }
  });
  return best;
}

/**
 * Weighted straight-line fit of centroid against time (weights SNR², centroid error ≈ PSF/SNR).
 * Returns the shift over the fitted span and its uncertainty, plus the best blink pair.
 */
function fitMotion(ms, noise, mjds, x0, y0) {
  const pts = [];
  ms.forEach((m, i) => {
    const snr = m.flux / noise[i];
    if (!m.ok || !(snr >= FIT_MIN_SNR) || !Number.isFinite(mjds[i])) return;
    if (Math.hypot(m.cx - x0, m.cy - y0) > MAX_JUMP_PX) return;
    pts.push({ i, t: mjds[i], x: m.cx, y: m.cy, w: (snr / PSF_SIGMA_PX) ** 2, snr });
  });
  const strong = pts.filter((q) => q.snr >= MOVE_MIN_SNR);
  if (strong.length < 2) return null;
  const W = pts.reduce((a, q) => a + q.w, 0);
  const tm = pts.reduce((a, q) => a + q.w * q.t, 0) / W;
  const stt = pts.reduce((a, q) => a + q.w * (q.t - tm) ** 2, 0);
  if (!(stt > 0)) return null;
  const vx = pts.reduce((a, q) => a + q.w * (q.t - tm) * q.x, 0) / stt;
  const vy = pts.reduce((a, q) => a + q.w * (q.t - tm) * q.y, 0) / stt;
  const sigmaV = 1 / Math.sqrt(stt); // per-axis slope error (px/day)
  // Judge the shift over the whole survey baseline: at this speed, that is how far it moved
  // between the first and last windows, even when the first window was too noisy to measure.
  const allT = mjds.filter(Number.isFinite);
  const span = Math.max(...allT) - Math.min(...allT);
  const speed = Math.hypot(vx, vy);
  const byTime = [...strong].sort((a, b) => a.t - b.t);
  return {
    shift: speed * span, err: sigmaV * span, pxPerDay: speed,
    from: byTime[0].i, to: byTime[byTime.length - 1].i,
  };
}

function bestChange(ms, noise) {
  let best = null;
  for (let i = 0; i < ms.length; i += 1) {
    for (let j = i + 1; j < ms.length; j += 1) {
      const a = ms[i];
      const b = ms[j];
      if (!a.ok || !b.ok || !(a.flux > 0) || !(b.flux > 0)) continue;
      const delta = b.flux - a.flux;
      const sig = Math.abs(delta) / Math.hypot(noise[i], noise[j]); // significance in this pair's own noise
      if (!best || sig > best.sig) best = { delta, sig, from: i, to: j, a: a.flux, b: b.flux };
    }
  }
  return best;
}

/**
 * Finds across survey-window stacks. `stackPlanes` follow `view.stacks` (same order).
 * `opts.saturated` (from saturationMask) marks saturated cores; finds in their halo are dropped.
 * Returns [] with fewer than two stacks.
 */
export function detectFinds(view, stackPlanes, deep, P, { saturated: satMask = null } = {}) {
  if (!stackPlanes || stackPlanes.length < 2) return [];
  const sigmas = stackPlanes.map((p) => robustStats(p).sigma);
  if (!sigmas.some((s) => s > 0)) return [];
  const boxNoise = sigmas.map((s) => (s > 0 ? s : Infinity) * (2 * APERTURE_R + 1)); // per window
  const mjds = (view.stacks || []).map((s) => Number(s.mjd));
  const meanMjd = mjds.length ? mjds.reduce((a, b) => a + b, 0) / mjds.length : NaN;
  const scale = Number(view.grid?.scale_arcsec) || 6.15;
  const finds = [];

  findSources(deep, P, { edge: DETECT_EDGE_PX }).forEach((src) => {
    const ms = stackPlanes.map((plane) => measureNear(plane, P, src.x, src.y));
    const saturated = isSaturated(deep, P, src.x, src.y) || maskedNear(satMask, P, src.x, src.y, 1.5);
    // Weighted centre, not the peak pixel: a flat saturated top's first pixel is off-centre.
    const centre = measure(deep, P, src.x, src.y, APERTURE_R + 1);
    const x = centre.ok ? centre.cx : src.x;
    const y = centre.ok ? centre.cy : src.y;
    if (!saturated && maskedNear(satMask, P, x, y, HALO_PX)) return; // bright-star glare
    let gaia = Number.isFinite(meanMjd) ? gaiaMatch(view, x, y, meanMjd) : null;

    const motion = fitMotion(ms, boxNoise, mjds, x, y);
    const fastGaia = gaia && totalPm(gaia) >= SATURATED_PM_ARCSEC;
    const significant = motion && motion.shift >= MOVE_MIN_PX && motion.shift >= MOVE_MIN_SIGMAS * motion.err;
    const moving = significant && (!saturated || fastGaia);
    if (moving && gaia && totalPm(gaia) < GAIA_PM_MISMATCH) gaia = null; // coincidence with a still star
    const base = { x, y, snr: src.snr, saturated, gaia };
    if (moving) {
      finds.push({
        ...base, kind: 'moving', shiftPx: motion.shift, fluxChange: 0, from: motion.from, to: motion.to,
        arcsecPerYr: motion.pxPerDay * DAYS_PER_YEAR * scale,
      });
      return;
    }
    // Saturated cores are clipped/filled: judge their brightness by the outer glow instead.
    const glow = saturated ? stackPlanes.map((plane) => measureGlow(plane, P, x, y)) : null;
    const glowNoise = glow ? sigmas.map((sg, i) => (sg > 0 ? sg : Infinity) * Math.sqrt(glow[i].n || 1)) : null;
    const change = saturated ? bestChange(glow, glowNoise) : bestChange(ms, boxNoise);
    if (!change) return;
    const fraction = Math.abs(change.delta) / Math.min(change.a, change.b);
    if (fraction >= VAR_MIN_FRACTION && change.sig >= VAR_MIN_SIGMA) {
      finds.push({
        ...base, kind: 'variable', shiftPx: 0, arcsecPerYr: 0,
        fluxChange: change.delta / change.a, from: change.from, to: change.to,
      });
    }
  });

  finds.sort((a, b) => (a.kind === b.kind ? b.snr - a.snr : a.kind === 'moving' ? -1 : 1));
  const unique = [];
  finds.forEach((f) => {
    if (unique.every((u) => Math.hypot(u.x - f.x, u.y - f.y) >= DUPLICATE_PX)) unique.push(f);
  });
  return unique.map((f, i) => ({ ...f, id: i + 1 }));
}
