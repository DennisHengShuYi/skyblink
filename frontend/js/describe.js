// Plain-language descriptions of a star for beginners. Pure functions, no DOM.
// Inputs are Gaia DR3 values (G mag, BP−RP colour, parallax in mas, proper motion in mas/yr).
import { totalPm } from './gaia.js';

const LY_PER_MAS = 3261.56; // light-years = 3261.56 / parallax(mas)
const MIN_PARALLAX_MAS = 0.2; // below this Gaia distances are too uncertain to quote
const MOON_WIDTH_ARCSEC = 1865;
const KM_S_PER_AU_YR = 4.74;
const MIN_PM_ARCSEC = 0.02;
const MIN_PARALLAX_SNR = 5; // parallax_over_error below this is too noisy to judge a star's size
const THIS_YEAR = 2026;
const LOOKBACK_MAX_LY = 500;

export const NOT_IN_GAIA = "Not in SkyBlink's Gaia star list for this field. With one view we can't tell what it is: it could be very cold, very faint or hidden behind dust.";
// Only for a spot that measurably moved: slow-moving, very red objects not seen by Gaia are often brown dwarfs.
export const NOT_IN_GAIA_MOVER = `${NOT_IN_GAIA} Brown dwarfs look like this.`;
const STILL_GAIA = 'Gaia lists a star here that is not moving, so this may be a different object right beside it, or glare. A candidate worth a closer look.';
const EMPTY_SNR = 5;

/**
 * Headline for a clicked spot with no catalogued star: an untracked mover, an unmeasurable
 * pixel (no data yet, or a Difference/Reference view), empty sky, or an uncatalogued source.
 */
export function objectHeadline({ mover, snr }) {
  if (mover) {
    return { title: `Moving object — about ${Number(mover.arcsecPerYr).toFixed(1)}″ a year`, body: mover.stillGaia ? STILL_GAIA : NOT_IN_GAIA_MOVER };
  }
  if (snr === null || !Number.isFinite(snr)) {
    return { title: "Can't measure here in this view", body: 'Switch back to the animation and click again to read this spot.' };
  }
  if (snr < EMPTY_SNR) return { title: 'Mostly empty sky', body: 'Nothing bright enough to stand out here. Try clicking one of the dots.' };
  return { title: "Something not in SkyBlink's Gaia list", body: NOT_IN_GAIA };
}

const usable = (plx) => Number.isFinite(plx) && plx > 0;

/** Rough star type from colour and (when parallax allows) absolute brightness. Null without colour. */
export function starType({ gmag, bp_rp: colour, parallax, parallax_over_error: parallaxSnr }) {
  if (!Number.isFinite(colour)) return null;
  // A parallax that is mostly noise would put a distant dwarf among the giants: use colour alone.
  const reliable = !(Number.isFinite(parallaxSnr) && parallaxSnr < MIN_PARALLAX_SNR);
  const absG = reliable && usable(parallax) && Number.isFinite(gmag) ? gmag + 5 * Math.log10(parallax / 100) : null;
  const t = (label, blurb) => ({ label, blurb });
  if (colour < 0.3) return t('Hot blue star', 'Much hotter than the Sun, glowing blue-white.');
  if (absG !== null && absG > 10 && colour < 1.0) return t('White dwarf', 'The small, hot leftover core of a star like the Sun.');
  if (absG !== null && absG < 2 && colour >= 1.0) return t('Red giant', 'An old star that has swollen to many times the Sun\'s size.');
  if (colour >= 1.8) return t('Red dwarf: a small, cool star', 'The most common kind of star — smaller, cooler and dimmer than the Sun.');
  if (colour >= 0.6 && colour < 1.0) return t('Sun-like star', 'A star similar in colour and temperature to our Sun.');
  if (colour >= 1.0 && colour < 1.8) return t('Orange (K-type) star', 'A star a little cooler and smaller than the Sun.');
  return t('White or yellow-white star', 'A star somewhat hotter than the Sun.');
}

function roundLy(ly) {
  if (ly < 10) return ly.toFixed(1);
  const digits = Math.floor(Math.log10(ly)) + 1;
  const factor = 10 ** (digits - 2);
  return (Math.round(ly / factor) * factor).toLocaleString('en-US');
}

/** "About N light-years away." (+ when its light left, for nearby stars). Null if unknowable. */
export function distanceText(parallaxMas) {
  if (!Number.isFinite(parallaxMas) || parallaxMas < MIN_PARALLAX_MAS) return null;
  const ly = LY_PER_MAS / parallaxMas;
  let text = `About ${roundLy(ly)} light-years away.`;
  if (ly < LOOKBACK_MAX_LY) text += ` The light you see left it around ${THIS_YEAR - Math.round(ly)}.`;
  return text;
}

/** How fast it moves across the sky, with a Moon comparison and (if distance known) km/s. */
export function speedText(star) {
  const pm = totalPm(star);
  if (!(pm >= MIN_PM_ARCSEC)) return null;
  const years = Math.round(MOON_WIDTH_ARCSEC / pm).toLocaleString('en-US');
  let text = `Moves ${pm.toFixed(2)}″ a year across the sky — it would cross the full Moon's width in about ${years} years.`;
  if (Number.isFinite(star.parallax) && star.parallax >= MIN_PARALLAX_MAS) {
    const kms = Math.round((KM_S_PER_AU_YR * pm) / (star.parallax / 1000));
    text = `Travels about ${kms.toLocaleString('en-US')} km/s sideways. ${text}`;
  }
  return text;
}

function medianFlux(points) {
  const v = points.map((p) => p.flux).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Spectrum shape in words: compares short (< 1.6 µm) with long (> 3.5 µm) wavelengths. */
export function spectrumWords(points) {
  const finite = (points || []).filter((p) => Number.isFinite(p.flux) && Number.isFinite(p.um));
  const short = medianFlux(finite.filter((p) => p.um < 1.6));
  const long = medianFlux(finite.filter((p) => p.um > 3.5));
  if (short === null || long === null) return null;
  if (short > 0 && long / short > 2) return 'Much brighter at long infrared wavelengths — a sign it is cool (or dusty).';
  if (long > 0 && short / long > 2) return 'Brighter at short wavelengths — a sign it is hot.';
  if (short <= 0 && long > 0) return 'Much brighter at long infrared wavelengths — a sign it is cool (or dusty).';
  return 'Similar brightness across infrared colours.';
}

/** Label for the card's opt-in button that downloads the other bands; null when there are none. */
export function readColoursLabel(count, megabytesEach) {
  if (!(count >= 1)) return null;
  const mb = Math.max(1, Math.round(count * (Number(megabytesEach) || 0)));
  return `Read its infrared colours (about ${mb} MB)`;
}
