// Opening featured views from the newcomer features (puzzle, Birthday Sky, TV remote):
// a band, an optional neutral title, and a one-shot action once the view is on screen.
import { toast } from './ui.js';

/** Visit index nearest a wavelength (µm). */
export const nearestVisit = (visits, um) => visits.reduce((best, x) => (Math.abs(x.um - um) < Math.abs(best.um - um) ? x : best)).i;

/**
 * @param {object} ctx
 * @param {() => object[]} ctx.featured
 * @param {(f: object) => void} ctx.pick              open a featured target
 * @param {(fn: Function|null) => void} ctx.afterView  set the one-shot action
 * @param {(i: number) => Promise<void>} ctx.jumpToVisit
 * @param {() => void} ctx.pause
 */
export function createNavigator({ featured, pick, afterView, jumpToVisit, pause }) {
  function openFeatured(slug, det, { title = null, then = null } = {}) {
    const f = featured().find((x) => x.slug === slug);
    if (!f) {
      toast('That featured view is unavailable right now.');
      return;
    }
    afterView(then);
    pick({ ...f, det, name: title || f.name });
  }

  function openVisit(slug, det, um, visit = null) {
    openFeatured(slug, det, {
      then: async (v) => {
        const visits = v.visits || [];
        const i = visit ?? (Number.isFinite(um) && visits.length ? nearestVisit(visits, um) : null);
        if (i === null) return;
        pause();
        await jumpToVisit(i);
        const shown = visits.find((x) => x.i === i);
        if (shown) toast(`This picture was taken on ${String(shown.date).slice(0, 10)} at ${shown.um.toFixed(3)} µm.`);
      },
    });
  }

  return { openFeatured, openVisit };
}
