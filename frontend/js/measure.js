// "Measure it yourself": tap a star in two survey windows, snap each tap to the star's
// light-weighted centre, and turn the shift into arcseconds a year with an honest error bar.
//
// Honesty rules (brainstorm idea I09, checked on the featured cubes):
// - only vetted target/band/window pairs; same-season pairs so Earth's yearly wobble
//   (parallax) cancels;
// - a line-up floor of ~0.2 px in the error bar (pixel noise alone looks falsely exact);
// - saturated stars fake motion, so they are refused;
// - it is "a classroom measurement", compared with Gaia's (or the published) value.

export const SNAP_RADIUS = 3;     // grid px searched around a tap for the brightest pixel
export const BOX = 2;             // centroid box half-width (5×5)
export const FLOOR_PX = 0.14;     // per-position line-up error; two positions ≈ 0.2 px
const DAYS_PER_YEAR = 365.25;
const AU_KM_PER_S_PER_ARCSEC_PER_YEAR_PER_PC = 4.74;

// Vetted pairs: same season, unsaturated, checked against Gaia on the cubes.
export const MEASURE_PAIRS = Object.freeze({
  '768d33c99b4c-D2': { a: 0, b: 2, name: "Barnard's Star", distancePc: 1.83, reference: { pm: 10.39, by: 'Gaia DR3' } },
  '85387de0fcfc-D6': { a: 0, b: 2, name: 'Epsilon Indi B', distancePc: 3.69, reference: { pm: 4.68, by: 'Gaia DR3' } },
  'e01445dc3f16-D5': { a: 0, b: 3, name: 'WISE 0855', distancePc: 2.28, reference: { pm: 8.15, by: 'published (Luhman & Esplin 2016)' } },
});

function median(values) {
  const v = values.filter(Number.isFinite).sort((p, q) => p - q);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Snap a tap at grid (x, y) to the nearest star: brightest finite pixel within SNAP_RADIUS,
 * then the background-subtracted, light-weighted centre of the 5×5 box around it.
 * variance (optional) gives the centre's statistical error. Null if nothing usable.
 */
export function snapToStar(plane, P, x, y, variance = null) {
  let best = -1;
  let bestV = -Infinity;
  const r = SNAP_RADIUS;
  for (let yy = Math.max(0, Math.round(y) - r); yy <= Math.min(P - 1, Math.round(y) + r); yy += 1) {
    for (let xx = Math.max(0, Math.round(x) - r); xx <= Math.min(P - 1, Math.round(x) + r); xx += 1) {
      if (Math.hypot(xx - x, yy - y) > r + 0.5) continue;
      const v = plane[yy * P + xx];
      if (Number.isFinite(v) && v > bestV) {
        bestV = v;
        best = yy * P + xx;
      }
    }
  }
  if (best < 0) return null;
  const cx = best % P;
  const cy = Math.floor(best / P);
  // Background: median of the ring just outside the box.
  const ring = [];
  for (let yy = cy - BOX - 1; yy <= cy + BOX + 1; yy += 1) {
    for (let xx = cx - BOX - 1; xx <= cx + BOX + 1; xx += 1) {
      if (Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) !== BOX + 1) continue;
      if (xx >= 0 && yy >= 0 && xx < P && yy < P) ring.push(plane[yy * P + xx]);
    }
  }
  const bg = median(ring);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let masked = 0;
  const cells = [];
  for (let yy = cy - BOX; yy <= cy + BOX; yy += 1) {
    for (let xx = cx - BOX; xx <= cx + BOX; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= P || yy >= P) continue;
      const v = plane[yy * P + xx];
      if (!Number.isFinite(v)) {
        masked += 1;
        continue;
      }
      const w = Math.max(0, v - (Number.isFinite(bg) ? bg : 0));
      sw += w;
      sx += w * xx;
      sy += w * yy;
      cells.push([xx, yy, w]);
    }
  }
  if (sw <= 0) return null;
  const mx = sx / sw;
  const my = sy / sw;
  let statErr = 0;
  if (variance) {
    let ex = 0;
    let ey = 0;
    cells.forEach(([xx, yy]) => {
      const s2 = variance[yy * P + xx];
      if (Number.isFinite(s2) && s2 > 0) {
        ex += (xx - mx) ** 2 * s2;
        ey += (yy - my) ** 2 * s2;
      }
    });
    statErr = Math.sqrt((ex + ey) / 2) / sw;
  }
  return { x: mx, y: my, peak: bestV, masked, err: Math.hypot(statErr, FLOOR_PX) };
}

/**
 * Shift between two snapped positions taken at mjdA and mjdB, in px and arcsec/yr.
 * {dxPx, dyPx, px, years, arcsecPerYear, errArcsecPerYear}
 */
export function motionBetween(a, b, mjdA, mjdB, scaleArcsec) {
  const years = (mjdB - mjdA) / DAYS_PER_YEAR;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const px = Math.hypot(dx, dy);
  const errPx = Math.hypot(a.err || FLOOR_PX, b.err || FLOOR_PX);
  return {
    dxPx: dx, dyPx: dy, px, years,
    arcsecPerYear: (px * scaleArcsec) / years,
    errArcsecPerYear: (errPx * scaleArcsec) / Math.abs(years),
  };
}

/** Sideways speed in km/s for an angular speed (″/yr) at a distance in parsecs. */
export function kmPerSecond(arcsecPerYear, distancePc) {
  return AU_KM_PER_S_PER_ARCSEC_PER_YEAR_PER_PC * arcsecPerYear * distancePc;
}

/** Plain-language result lines. */
export function resultText(m, pair) {
  const lo = m.arcsecPerYear - m.errArcsecPerYear;
  const hi = m.arcsecPerYear + m.errArcsecPerYear;
  const agrees = pair.reference.pm >= lo - 1e-9 && pair.reference.pm <= hi + 1e-9;
  const kms = kmPerSecond(m.arcsecPerYear, pair.distancePc);
  const klSingapore = 316 / kms; // km between Kuala Lumpur and Singapore, as the crow flies
  return {
    sums: `${m.px.toFixed(2)} pixels × 6.15″ per pixel ÷ ${m.years.toFixed(2)} years = ${m.arcsecPerYear.toFixed(1)}″ a year (± ${m.errArcsecPerYear.toFixed(1)}).`,
    verdict: agrees
      ? `${pair.reference.by} says ${pair.reference.pm}″ a year. You agree within your error bar.`
      : `${pair.reference.by} says ${pair.reference.pm}″ a year. You're outside your error bar: try tapping again, nearer the middle of the star.`,
    speed: `At its distance that is about ${Math.round(kms)} km/s sideways: Kuala Lumpur to Singapore in ${klSingapore < 10 ? klSingapore.toFixed(1) : Math.round(klSingapore)} seconds.`,
    agrees,
  };
}
