// Popular sights: no coordinates needed. Positions are ICRS; Proxima and Alpha Centauri
// are propagated with their proper motion to ~2025.9 so they sit at the crosshair.
export const SIGHTS = Object.freeze([
  { slug: 'orion', name: 'Orion Nebula', ra: 83.8221, dec: -5.3911, fov: 0.1, det: 'D3', teaser: 'A stellar nursery where new stars are being born.' },
  { slug: 'pleiades', name: 'Pleiades', ra: 56.75, dec: 24.1167, fov: 0.1, det: 'D1', teaser: 'The Seven Sisters: young blue stars in dusty haze.' },
  { slug: 'crab', name: 'Crab Nebula', ra: 83.6331, dec: 22.0145, fov: 0.1, det: 'D2', teaser: 'Wreckage of a star that exploded in the year 1054.' },
  { slug: 'andromeda', name: 'Andromeda Galaxy core', ra: 10.6847, dec: 41.269, fov: 0.1, det: 'D2', teaser: 'The heart of our nearest big neighbour galaxy.' },
  { slug: 'whirlpool', name: 'Whirlpool Galaxy', ra: 202.4696, dec: 47.1952, fov: 0.1, det: 'D2', teaser: 'A spiral galaxy pulling on a smaller companion.' },
  { slug: 'ring', name: 'Ring Nebula', ra: 283.3962, dec: 33.0291, fov: 0.1, det: 'D3', teaser: 'A dying star puffing off a glowing smoke ring.' },
  { slug: 'proxima', name: 'Proxima Centauri', ra: 217.3697, dec: -62.674, fov: 0.1, det: 'D2', teaser: 'The closest star to the Sun, 4.2 light-years away.' },
  { slug: 'alphacen', name: 'Alpha Centauri', ra: 219.8476, dec: -60.8307, fov: 0.1, det: 'D4', teaser: 'The bright Sun-like pair next door to us.' },
  { slug: 'galcentre', name: 'Galactic Centre', ra: 266.4168, dec: -29.0078, fov: 0.1, det: 'D4', teaser: 'Where our galaxy\'s giant black hole hides behind dust.' },
  { slug: 'betelgeuse', name: 'Betelgeuse', ra: 88.7929, dec: 7.4071, fov: 0.1, det: 'D5', teaser: 'A red supergiant that could one day explode.' },
]);
