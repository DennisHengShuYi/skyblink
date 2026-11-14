// Aladin Lite v3 side panel, loaded lazily from the CDS CDN the first time the
// "Sky atlas" tab is opened so it never slows the first paint.

// Official CDS URL first; a pinned jsDelivr copy of the same v3 build as fallback
// (the CDS "latest" path returned 404 during testing on 2026-11-15).
// The CDS file is a classic script that defines window.A; the npm build is an ES
// module whose default export is the same `A` object.
const CDS_URL = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
const NPM_URL = 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js';
export const SURVEYS = {
  '2mass': { id: 'P/2MASS/color', label: '2MASS (near-infrared)' },
  allwise: { id: 'P/allWISE/color', label: 'AllWISE (mid-infrared)' },
};
const CATALOGS = [
  { vizier: 'I/355/gaiadr3', name: 'Gaia DR3', color: '#5ce1ff', shape: 'circle' },
  { vizier: 'II/328/allwise', name: 'AllWISE', color: '#ff9f6b', shape: 'square' },
];

let scriptPromise = null;

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (window.A && window.A.init ? resolve(window.A) : reject(new Error('Aladin missing')));
    s.onerror = () => {
      s.remove();
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(s);
  });
}

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = (async () => {
    const loaders = [() => injectScript(CDS_URL), async () => (await import(NPM_URL)).default];
    for (const load of loaders) {
      try {
        const A = await load();
        await A.init;
        return A;
      } catch {
        // Try the next mirror.
      }
    }
    throw new Error('Could not load Aladin Lite from the CDS server.');
  })();
  scriptPromise.catch(() => { scriptPromise = null; });
  return scriptPromise;
}

/**
 * Show the target in `container`. Recreates the widget for each new target so
 * catalogue layers always match the current field.
 */
export async function showAladin(container, { ra, dec, fov }, survey = '2mass') {
  const A = await loadScript();
  container.replaceChildren();
  const aladin = A.aladin(container, {
    survey: SURVEYS[survey]?.id || SURVEYS['2mass'].id,
    fov,
    target: `${ra} ${dec}`,
    cooFrame: 'ICRS',
    showReticle: true,
    showCooGrid: false,
    showFullscreenControl: true,
    showLayersControl: true,
  });
  const radius = (fov / 2) * Math.SQRT2;
  CATALOGS.forEach((c) => {
    const cat = A.catalogFromVizieR(c.vizier, `${ra} ${dec}`, radius, {
      name: c.name, color: c.color, shape: c.shape, sourceSize: 10, onClick: 'showTable',
    });
    aladin.addCatalog(cat);
  });
  return aladin;
}

/**
 * Draw the SPHEREx field outline (`corners`: [[ra, dec] × 4]) on the atlas.
 * Best effort: older Aladin builds without overlays simply skip it.
 */
export function drawFootprint(aladin, corners) {
  const A = window.A;
  if (!aladin || !A || typeof A.graphicOverlay !== 'function') return;
  try {
    const overlay = A.graphicOverlay({ name: 'SPHEREx field', color: '#ff5c5c', lineWidth: 2 });
    aladin.addOverlay(overlay);
    overlay.add(A.polygon(corners));
  } catch {
    // The atlas still works without the outline.
  }
}

const selection = new WeakMap();

/** Mark the pixel picked in the player (green) so the atlas shows what you clicked. */
export function markSelection(aladin, ra, dec) {
  const A = window.A;
  if (!aladin || !A || typeof A.catalog !== 'function') return;
  try {
    let cat = selection.get(aladin);
    if (!cat) {
      cat = A.catalog({ name: 'Selected pixel', sourceSize: 16, color: '#7CFC9A', shape: 'cross' });
      aladin.addCatalog(cat);
      selection.set(aladin, cat);
    }
    cat.removeAll();
    cat.addSources([A.source(ra, dec, { name: 'Selected pixel' })]);
  } catch {
    // Selection marker is a nicety; ignore failures.
  }
}

export function setSurvey(aladin, survey) {
  const id = SURVEYS[survey]?.id;
  if (!aladin || !id) return;
  if (typeof aladin.setBaseImageLayer === 'function') aladin.setBaseImageLayer(id);
  else if (typeof aladin.setImageSurvey === 'function') aladin.setImageSurvey(id);
}
