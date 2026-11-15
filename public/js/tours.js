// Guided tours for the featured targets. Plain data plus a validator; tour.js runs them.
// Frame indices refer to survey-window stacks (stacked mode), 0 = first.

export const ACTIONS = Object.freeze(['frame', 'play', 'pause', 'mode', 'diff', 'blink', 'pulse', 'tab', 'gaia', 'colour']);

export const TOURS = Object.freeze({
  wise0855: [
    { text: 'This is WISE 0855, the coldest brown dwarf known — about as cold as the North Pole. It sits at the red crosshair.', action: { type: 'pulse' } },
    { text: 'Watch it step to the right as SPHEREx looks again six months later, then a year later.', action: { type: 'play' } },
    { text: "Here's the Difference: blue is where it was, red is where it went. Stars that don't move cancel out.", action: { type: 'diff', a: 0, b: 2 } },
    { text: 'It is invisible in ordinary light but glows at the longest infrared wavelengths — the signature of a very cold object.', action: { type: 'tab', tab: 'spec' } },
    { text: 'You just measured a star crossing the sky: about 8 arcseconds a year, because it is only 7.4 light-years away.', action: { type: 'tab', tab: 'finds' } },
  ],
  barnard: [
    { text: "Barnard's Star moves faster across our sky than any other star. It's the bright blob at the crosshair.", action: { type: 'pulse' } },
    { text: "It's so bright that SPHEREx's detector saturates, but watch the whole blob creep upward (north).", action: { type: 'play' } },
    { text: 'The Difference shows it clearly: a blue patch where it was, a red patch where it moved to.', action: { type: 'diff', a: 0, b: 2 } },
    { text: 'Turn on Gaia stars: the European Gaia mission predicted exactly where it would be.', action: { type: 'gaia', on: true } },
    { text: 'At 10 arcseconds a year it would cross the width of the full Moon in under 200 years.', action: { type: 'tab', tab: 'finds' } },
  ],
  epsindib: [
    { text: 'Epsilon Indi B is a pair of brown dwarfs orbiting a nearby star, 12 light-years away.', action: { type: 'pulse' } },
    { text: 'Step through the surveys and watch the pair shift as they travel through space.', action: { type: 'play' } },
    { text: 'Brown dwarfs are far redder than ordinary stars. The colour view makes them stand out.', action: { type: 'colour' } },
    { text: 'Their spectrum rises toward long infrared wavelengths — they are cool, failed stars.', action: { type: 'tab', tab: 'spec' } },
  ],
  rwaur: [
    { text: 'RW Aurigae is a young star still wrapped in the disk of dust where planets form.', action: { type: 'pulse' } },
    { text: "It doesn't move, but clumps of dust sometimes block its light. Watch its brightness.", action: { type: 'play' } },
    { text: 'Blink the first and last surveys to compare how bright it looks.', action: { type: 'blink', a: 0, b: 2 } },
    { text: 'The Finds tab measures the change for you — read it there.', action: { type: 'tab', tab: 'finds' } },
  ],
  rdra: [
    { text: 'R Draconis is a pulsating red giant: it swells and shrinks over about 8 months.', action: { type: 'pulse' } },
    { text: 'SPHEREx caught it at different moments of that cycle. Watch the glow change.', action: { type: 'play' } },
    { text: 'Blink two surveys: its outer glow is clearly brighter in one of them.', action: { type: 'blink', a: 1, b: 2 } },
    { text: 'Its spectrum dips where water vapour in its cool outer layers absorbs light.', action: { type: 'tab', tab: 'spec' } },
    { text: 'The Finds tab estimates how much its brightness changed between the surveys.', action: { type: 'tab', tab: 'finds' } },
  ],
});

const FRAME_ARGS = { frame: ['index'], diff: ['a', 'b'], blink: ['a', 'b'] };

/** Problems with a tour (empty list = valid). */
export function validateTour(steps) {
  const errors = [];
  (steps || []).forEach((step, i) => {
    if (!step || typeof step.text !== 'string' || !step.text.trim()) errors.push(`step ${i + 1}: missing text`);
    const a = step?.action;
    if (!a) return;
    if (!ACTIONS.includes(a.type)) {
      errors.push(`step ${i + 1}: unknown action "${a.type}"`);
      return;
    }
    (FRAME_ARGS[a.type] || []).forEach((k) => {
      if (!Number.isInteger(a[k]) || a[k] < 0) errors.push(`step ${i + 1}: ${k} must be a whole frame number`);
    });
  });
  return errors;
}
