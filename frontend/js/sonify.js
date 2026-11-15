// "Listen to the sky": brightness over time or a spectrum as a short note sequence.
// Web Audio only, no library. Sound starts only from a click; play() never throws.

const MIN_HZ = 220;
const MAX_HZ = 880;
const MAX_SPECTRUM_NOTES = 24;
const STEADY_SPREAD = 0.1;
const TREND = 0.3;

/** Values → notes: log pitch, linear in value from minHz (lowest) to maxHz (highest). */
export function toNotes(values, { minHz = MIN_HZ, maxHz = MAX_HZ, step = 0.28, dur = 0.24 } = {}) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const notes = [];
  values.forEach((v) => {
    if (!Number.isFinite(v)) return;
    const f = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    notes.push({ freq: minHz * (maxHz / minHz) ** f, start: notes.length * step, dur });
  });
  return notes;
}

/** "rises", "falls", "stays steady" or "wobbles up and down". */
export function describeSound(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return 'stays steady';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if ((hi - lo) / Math.max(Math.abs(mean), 1e-12) < STEADY_SPREAD) return 'stays steady';
  const trend = (v[v.length - 1] - v[0]) / (hi - lo);
  const steps = v.slice(1).map((x, i) => x - v[i]);
  const reversals = steps.slice(1).filter((s, i) => Math.sign(s) !== Math.sign(steps[i]) && s && steps[i]).length;
  if (trend > TREND && reversals === 0) return 'rises';
  if (trend < -TREND && reversals === 0) return 'falls';
  return 'wobbles up and down';
}

/** Mean of the 3×3 patch at (x, y) in every survey-window stack (NaN ignored). */
export function lightcurve(cube, view, x, y) {
  const out = [];
  for (let w = 0; w < cube.W; w += 1) {
    const plane = cube.stack(w);
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= cube.P || py >= cube.P) continue;
        const v = plane[py * cube.P + px];
        if (Number.isFinite(v)) {
          sum += v;
          n += 1;
        }
      }
    }
    out.push(n ? sum / n : NaN);
  }
  return out;
}

/** Spectrum flux ordered by wavelength, averaged down to at most 24 values. */
export function spectrumSeries(points) {
  const sorted = (points || []).filter((p) => Number.isFinite(p.flux) && Number.isFinite(p.um))
    .sort((a, b) => a.um - b.um);
  if (sorted.length <= MAX_SPECTRUM_NOTES) return sorted.map((p) => p.flux);
  const out = [];
  for (let b = 0; b < MAX_SPECTRUM_NOTES; b += 1) {
    const chunk = sorted.slice(Math.floor((b * sorted.length) / MAX_SPECTRUM_NOTES),
      Math.floor(((b + 1) * sorted.length) / MAX_SPECTRUM_NOTES));
    out.push(chunk.reduce((a, p) => a + p.flux, 0) / chunk.length);
  }
  return out;
}

/**
 * What a Hear button should do: `current` is {owner} for the sound now playing (or null),
 * `owner` identifies the button that was pressed (buttons can share one caption element).
 */
export function soundAction(current, owner) {
  if (!current) return 'start';
  return current.owner === owner ? 'toggle-off' : 'switch';
}

/** Play notes. Returns {stop()} or null if audio is unavailable or blocked. Never throws. */
export function play(notes) {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx || !notes.length) return null;
  try {
    const ctx = new Ctx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.05;
    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      gain.gain.setValueAtTime(0, t0 + n.start);
      gain.gain.linearRampToValueAtTime(0.18, t0 + n.start + 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + n.start + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.start);
      osc.stop(t0 + n.start + n.dur + 0.02);
    });
    const end = notes[notes.length - 1];
    const timer = setTimeout(() => ctx.close().catch(() => {}), (end.start + end.dur + 0.3) * 1000);
    return {
      stop() {
        clearTimeout(timer);
        ctx.close().catch(() => {});
      },
      durationMs: (end.start + end.dur) * 1000,
    };
  } catch {
    return null;
  }
}
