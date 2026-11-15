// Keyboard shortcuts for the viewer (the full list is in the #keys-dialog).

const TYPING = ['INPUT', 'SELECT', 'TEXTAREA'];

/**
 * @param {object} a  actions: active(), toggle(), step(d), first(), last(), go(i), zoom(f), fit(),
 *   tool(name), blink(), diff(), stars(), help(), leave(); optional letters() → false turns
 *   off every single-character shortcut (WCAG 2.1.4), leaving Space, arrows, Home and End.
 */
export function createKeyHandler(a) {
  return function onKey(e) {
    if (!a.active() || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    const isScrub = t.id === 'scrub';
    const typing = TYPING.includes(t.tagName) && !isScrub;
    const widget = ['tab', 'radio'].includes(t.getAttribute && t.getAttribute('role'));
    const k = e.key;
    if (k === ' ' || e.code === 'Space') {
      if ((typing || ['BUTTON', 'A', 'SUMMARY'].includes(t.tagName)) && !isScrub) return;
      e.preventDefault();
      a.leave();
      a.toggle();
      return;
    }
    if (typing) return;
    const lettersOn = typeof a.letters === 'function' ? a.letters() : true;
    if (k.length === 1 && !lettersOn) return;
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !widget) {
      e.preventDefault();
      a.leave();
      a.step(k === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const act = {
      Home: () => { a.leave(); a.first(); },
      End: () => { a.leave(); a.last(); },
      '+': () => a.zoom(1.5),
      '=': () => a.zoom(1.5),
      '-': () => a.zoom(1 / 1.5),
      _: () => a.zoom(1 / 1.5),
      0: () => a.fit(),
      a: () => a.tool('animate'),
      b: () => a.blink(),
      d: () => a.diff(),
      s: () => a.tool('deep'),
      r: () => a.tool('reference'),
      g: () => a.stars(),
      '?': () => a.help(),
    }[k.length === 1 ? k.toLowerCase() : k];
    if (act) {
      e.preventDefault();
      act();
      return;
    }
    if (/^[1-9]$/.test(k)) {
      e.preventDefault();
      a.leave();
      a.go(Number(k) - 1);
    }
  };
}
