// Planets Hiding in a Pixel (brainstorm idea G02, MVP): known planet hosts in the picture,
// with plain facts and how big one SPHEREx pixel is at the star's distance (from its own
// Gaia parallax), so visitors see that a whole planetary system fits inside one pixel.
// Facts are deliberately cautious: minimum masses ("at least"), sizes "probably".

export const HOSTS = Object.freeze({
  // Gaia DR3 source_id → facts
  '4472832130942575872': {
    name: "Barnard's Star",
    planets: 4,
    found: 'in 2024 and 2025, by the tiny wobble they give their star (ESPRESSO and MAROON-X telescopes on the ground)',
    orbits: 'each circles the star in 2 to 7 days, far closer than Mercury is to the Sun',
    size: 'Each is at least a fifth to a third of Earth\'s mass, so probably smaller than Earth. None is in the zone where water could stay liquid.',
  },
});

/** Hosts in the view's star list (by Gaia id), with the pixel size in AU at their distance. */
export function hostsIn(view) {
  return (view.stars || []).filter((s) => HOSTS[s.source_id]).map((s) => {
    const plx = Number(s.parallax); // mas
    const pixelAu = plx > 0 ? (view.grid.scale_arcsec * 1000) / plx : null;
    return { star: s, facts: HOSTS[s.source_id], pixelAu };
  });
}

/** One paragraph for a host. */
export function hostText(h) {
  const f = h.facts;
  const pixel = h.pixelAu ? ` At its distance one SPHEREx pixel is about ${h.pixelAu.toFixed(0)} times the Earth–Sun distance across, so the whole planetary system hides inside a single pixel.` : '';
  return `${f.name} has at least ${f.planets} known planets, found ${f.found}; ${f.orbits}. ${f.size}${pixel}`;
}
