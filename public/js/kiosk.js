// Museum mode (?kiosk=1, brainstorm idea I25 without the tour dependency): a self-running
// show of the featured targets with big captions. A touch hands control to the visitor;
// after IDLE_MS without a touch a 10-second warning shows, then the show resumes from a
// clean state. Calm by default: stacks only, slow playback, no flashing tools.

export const SLIDE_MS = 20000;
export const IDLE_MS = 75000;
export const WARN_MS = 10000;

/** Next slide index in the rotation. */
export const nextSlide = (i, n) => (n ? (i + 1) % n : 0);

/**
 * @param {object} ctx
 * @param {() => object[]} ctx.featured
 * @param {(f: object) => void} ctx.show      open a featured target (stack mode)
 * @param {(text: string|null) => void} ctx.caption
 * @param {() => void} ctx.reset             clear selection, tools, recents
 */
export function startKiosk({ featured, show, caption, reset }) {
  let i = -1;
  let slideTimer = null;
  let idleTimer = null;
  let warnTimer = null;
  let attended = false;
  let wakeLock = null;

  const lock = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null; // not supported or refused: the screen may sleep
    }
  };

  function advance() {
    const list = featured();
    if (!list.length) return;
    i = nextSlide(i, list.length);
    const f = list[i];
    show(f);
    caption(`${f.name}: ${f.caption || ''}`);
  }

  function loop() {
    attended = false;
    clearInterval(slideTimer);
    advance();
    slideTimer = setInterval(advance, SLIDE_MS);
  }

  function onTouch() {
    clearTimeout(idleTimer);
    clearTimeout(warnTimer);
    caption(null);
    if (!attended) {
      attended = true;
      clearInterval(slideTimer);
    }
    idleTimer = setTimeout(() => {
      caption('Still there? The sky show starts again in 10 seconds. Touch the screen to keep exploring.');
      warnTimer = setTimeout(() => {
        reset();
        loop();
      }, WARN_MS);
    }, IDLE_MS);
  }

  ['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, onTouch, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lock(); });
  lock();
  // Wait for the featured list, then start.
  const wait = setInterval(() => {
    if (featured().length) {
      clearInterval(wait);
      loop();
    }
  }, 300);
  return { stop: () => { clearInterval(slideTimer); clearTimeout(idleTimer); clearTimeout(warnTimer); wakeLock?.release?.(); } };
}
