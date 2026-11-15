// Plain-language wording for a detected find (see detect.js). Pure, no DOM.
// Copy rule: say "candidate", never "discovery".

const FAST_ARCSEC_PER_YR = 1;
const REVEAL_FROM = new Set(['tab-info', 'tab-finds', undefined, null]);

/** Tab to switch to after an image click: Finds, unless the user is reading Spectrum/Light curve/Atlas. */
export function revealTabFor(activeTabId) {
  return REVEAL_FROM.has(activeTabId) ? 'tab-finds' : null;
}

function dateOf(view, stackIndex) {
  const s = (view?.stacks || [])[stackIndex];
  return s?.date || s?.label || `survey ${stackIndex + 1}`;
}

/** {title, body} for one find. */
export function describeFind(find, view) {
  if (find.kind === 'moving') {
    const speed = Number.isFinite(find.arcsecPerYr) ? find.arcsecPerYr.toFixed(1) : '?';
    if (find.stillGaia) {
      return {
        title: "Moved, but the Gaia star here doesn't",
        body: `Shifting about ${speed}″ a year, yet the Gaia star at this spot is not moving. It may be a different object right beside it, or glare. A candidate worth a closer look.`,
      };
    }
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
  const from = dateOf(view, find.from);
  const to = dateOf(view, find.to);
  if (find.colourMismatch) {
    return {
      title: `Looks different between ${from} and ${to}`,
      body: 'The two pictures cover slightly different infrared colours, so this may be the colour and not the star. A candidate worth a second look.',
    };
  }
  const pct = Math.round(Math.abs(find.fluxChange) * 100);
  const dir = find.fluxChange >= 0 ? 'brighter' : 'fainter';
  return {
    title: `Got ${pct}% ${dir}`,
    body: `between ${from} and ${to} — likely a variable star.`,
  };
}

/** Message under the Finds tab when the list is empty. */
export function emptyFindsText(view) {
  if ((view?.stacks || []).length < 2) {
    return 'Only one look at this spot so far, so nothing can have changed yet. More looks arrive as SPHEREx keeps scanning.';
  }
  return 'Nothing obviously moved or changed brightness here.';
}
