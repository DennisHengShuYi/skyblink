// Plain-language wording for a detected find (see detect.js). Pure, no DOM.
// Copy rule: say "candidate", never "discovery".

const FAST_ARCSEC_PER_YR = 1;

function dateOf(view, stackIndex) {
  const s = (view?.stacks || [])[stackIndex];
  return s?.date || s?.label || `survey ${stackIndex + 1}`;
}

/** {title, body} for one find. */
export function describeFind(find, view) {
  if (find.kind === 'moving') {
    const speed = Number.isFinite(find.arcsecPerYr) ? find.arcsecPerYr.toFixed(1) : '?';
    if (find.gaia) {
      const fast = find.arcsecPerYr >= FAST_ARCSEC_PER_YR ? ' — one of the fastest in the sky.' : '.';
      return {
        title: `Known star, moving ${speed}″ a year`,
        body: `Gaia knows this star and agrees it moves${fast}`,
      };
    }
    return {
      title: "Moved — not in Gaia's catalogue",
      body: `Shifting about ${speed}″ a year. Very red or very faint in visible light. A candidate worth a closer look.`,
    };
  }
  const pct = Math.round(Math.abs(find.fluxChange) * 100);
  const dir = find.fluxChange >= 0 ? 'brighter' : 'fainter';
  const glow = find.saturated ? ' Too bright to measure directly, so this is estimated from its outer glow.' : '';
  return {
    title: `Got ${pct}% ${dir}`,
    body: `between ${dateOf(view, find.from)} and ${dateOf(view, find.to)} — likely a variable star.${glow}`,
  };
}
