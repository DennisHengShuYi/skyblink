// Birthday Sky: which featured patch SPHEREx photographed on (or nearest to) your birthday.
// Uses only the static calendar.json (featured picture dates): no archive calls, and the
// birthday never leaves the browser.

const DAY_MS = 86400000;
const REF_YEAR = 2026; // a non-leap year for day-of-year arithmetic

export const mjdToDate = (mjd) => new Date((mjd - 40587) * DAY_MS);

/** Day of year (0..364) for a month (1–12) and day; 29 Feb counts as 28 Feb. */
export function dayOfYear(month, day) {
  const d = month === 2 && day === 29 ? 28 : day;
  return Math.round((Date.UTC(REF_YEAR, month - 1, d) - Date.UTC(REF_YEAR, 0, 1)) / DAY_MS);
}

/** Valid month/day pair (29 Feb allowed). */
export function validBirthday(month, day) {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

/**
 * Closest picture to the birthday's calendar day (any year), most recent first on ties.
 * Returns {view, visit: {mjd, i, um}, date, offsetDays} — offsetDays > 0: after the birthday.
 */
export function findBirthday(calendar, month, day) {
  if (!validBirthday(month, day) || !calendar?.views?.length) return null;
  const target = dayOfYear(month, day);
  let best = null;
  calendar.views.forEach((view) => {
    view.visits.forEach(([mjd, i, um]) => {
      const d = mjdToDate(mjd);
      const doy = dayOfYear(d.getUTCMonth() + 1, d.getUTCDate());
      let off = doy - target;
      if (off > 182) off -= 365;
      if (off < -182) off += 365;
      const better = !best || Math.abs(off) < Math.abs(best.offsetDays)
        || (Math.abs(off) === Math.abs(best.offsetDays) && mjd > best.visit.mjd);
      if (better) best = { view, visit: { mjd, i, um }, date: d, offsetDays: off };
    });
  });
  return best;
}

/** "On 31 August 2025 (your birthday!) SPHEREx photographed Barnard's Star." */
export function birthdayText(hit) {
  const when = hit.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const off = hit.offsetDays === 0
    ? 'your birthday!'
    : `${Math.abs(hit.offsetDays)} day${Math.abs(hit.offsetDays) === 1 ? '' : 's'} ${hit.offsetDays > 0 ? 'after' : 'before'} your birthday`;
  return `On ${when} (${off}) SPHEREx photographed ${hit.view.name}, in infrared colour ${hit.visit.um.toFixed(2)} µm.`;
}
