// Pure maths for the "SPHEREx year" tab: where Earth (and so SPHEREx) was on each picture
// date, why the pictures come in bunches, when SPHEREx should look again, and the Planet X
// parallax lab (how far a body jumps between two of this patch's own survey dates).
// Low-precision Sun formulas (Astronomical Almanac): ~0.01°, plenty for a diagram.

const DEG = Math.PI / 180;
const OBLIQUITY = 23.439 * DEG;
const DAYS_PER_YEAR = 365.25;
export const ARCSEC_PER_RAD = 206264.806;
export const AU_PER_PC = 206264.806;
export const MOON_ARCSEC = 1865; // the Moon's average width
export const NEXT_LOOK_SLACK_DAYS = 21;

const mjdToJd2000 = (mjd) => mjd + 2400000.5 - 2451545.0;

/** Sun's ecliptic longitude (rad) and Earth–Sun distance (AU) at an MJD. */
export function sunPosition(mjd) {
  const d = mjdToJd2000(mjd);
  const g = (357.528 + 0.9856003 * d) * DEG;
  const L = (280.46 + 0.9856474 * d) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const r = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  return { lambda: ((lambda % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), r };
}

/** Earth's heliocentric ecliptic longitude (rad), 0..2π: the angle drawn on the year clock. */
export function earthLongitude(mjd) {
  return (sunPosition(mjd).lambda + Math.PI) % (2 * Math.PI);
}

/** Earth's position relative to the Sun in equatorial x, y, z (AU). */
export function earthVector(mjd) {
  const { lambda, r } = sunPosition(mjd);
  const xe = -r * Math.cos(lambda);
  const ye = -r * Math.sin(lambda);
  return [xe, ye * Math.cos(OBLIQUITY), ye * Math.sin(OBLIQUITY)];
}

/** Unit vector toward RA/Dec (degrees). */
function direction(ra, dec) {
  const a = ra * DEG;
  const d = dec * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

/** Part of Earth's move between two dates seen side-on from the target (AU). */
export function sideOnBaseline(ra, dec, mjdA, mjdB) {
  const a = earthVector(mjdA);
  const b = earthVector(mjdB);
  const base = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = direction(ra, dec);
  const along = base[0] * n[0] + base[1] * n[1] + base[2] * n[2];
  const perp = base.map((v, i) => v - along * n[i]);
  return { total: Math.hypot(...base), sideOn: Math.hypot(...perp) };
}

/** Parallax jump (arcsec) of something `distanceAu` away between two dates. */
export function parallaxJump(ra, dec, mjdA, mjdB, distanceAu) {
  return (sideOnBaseline(ra, dec, mjdA, mjdB).sideOn / distanceAu) * ARCSEC_PER_RAD;
}

/** Picture dates grouped into survey windows: [{label, start, end, n}] from the manifest. */
export function seasons(view) {
  return (view.windows || []).map((w) => ({ label: w.label, start: w.mjd_start, end: w.mjd_end, n: w.n }));
}

/**
 * Next expected look at this patch in this band: each past window repeats a year later
 * (same Earth position). The first repeat after the latest picture, ± 3 weeks.
 */
export function nextLook(view, todayMjd) {
  const ws = seasons(view);
  if (!ws.length) return null;
  const last = Math.max(...ws.map((w) => w.end));
  const after = Math.max(last, todayMjd ?? last) + 14;
  let best = Infinity;
  ws.forEach((w) => {
    const mid = (w.start + w.end) / 2;
    const k = Math.max(1, Math.ceil((after - mid) / DAYS_PER_YEAR));
    best = Math.min(best, mid + k * DAYS_PER_YEAR);
  });
  return { mjd: best, from: best - NEXT_LOOK_SLACK_DAYS, to: best + NEXT_LOOK_SLACK_DAYS };
}

export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000);
export const dateToMjd = (date) => date.getTime() / 86400000 + 40587;

export function monthYear(mjd) {
  return mjdToDate(mjd).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** One sentence on why the pictures bunch, from the windows' spread over the year. */
export function bunchingText(view) {
  const ws = seasons(view);
  if (!ws.length) return '';
  const longs = ws.map((w) => earthLongitude((w.start + w.end) / 2));
  const spread = (w) => (w.end - w.start);
  const longest = Math.max(...ws.map(spread));
  const n = (view.visits || []).length;
  const total = Number.isFinite(view.total_found) ? view.total_found : n;
  const months = Math.round(((Math.max(...ws.map((w) => w.end)) - Math.min(...ws.map((w) => w.start))) / DAYS_PER_YEAR) * 12);
  const opposite = longs.length > 1 && longs.some((a) => longs.some((b) => Math.abs(Math.cos(a - b) + 1) < 0.3));
  const why = opposite
    ? 'SPHEREx always looks out sideways from the Sun, so it can only see this patch when Earth is on one of two sides of its orbit: about every six months.'
    : 'SPHEREx always looks out sideways from the Sun, so it sees this patch from only part of Earth\'s orbit.';
  return `${why} Each visit lasts up to ${Math.max(1, Math.round(longest))} days. This band holds ${n} usable pictures${total > n ? ` (of ${total} found)` : ''} in ${ws.length} visits over ${months} months.`;
}

/** An all-day .ics reminder for the next-look window. */
export function nextLookIcs(name, det, look, nowMjd) {
  const ymd = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10).replace(/-/g, '');
  const stamp = `${mjdToDate(nowMjd).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const esc = (t) => String(t).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, ' ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SkyBlink//Next look//EN', 'BEGIN:VEVENT',
    `UID:skyblink-${esc(name).replace(/[^A-Za-z0-9]/g, '')}-${det}-${ymd(look.mjd)}@skyblink`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(look.from)}`,
    `DTEND;VALUE=DATE:${ymd(look.to + 1)}`,
    `SUMMARY:${esc(`SPHEREx should look at ${name} again (${det})`)}`,
    `DESCRIPTION:${esc('An estimate: same time of year as earlier visits, give or take 3 weeks, if the mission continues. New pictures reach the archive some weeks later.')}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}
