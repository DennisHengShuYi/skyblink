// Wiring for the simple view's big buttons, plus small storage helpers shared by the
// newcomer features (every access wrapped: private windows can block storage).
import { $, toast, copyText } from './ui.js';

export function storedValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {{select: Function}} ctx.compare
 * @param {() => object[]} ctx.frames
 * @param {() => string} ctx.shareLink
 * @param {() => void} ctx.leaveCompare
 */
export function bindSimpleBar({ player, compare, frames, shareLink, leaveCompare }) {
  const pair = (prefix) => {
    const n = frames().length;
    if (n < 2) {
      toast('There is only one picture here, so nothing to compare yet.');
      return false;
    }
    $(`${prefix}-a`).value = '0';
    $(`${prefix}-b`).value = String(n - 1);
    return true;
  };
  $('sb-play').addEventListener('click', () => { leaveCompare(); player.toggle(); });
  $('sb-changed').addEventListener('click', () => {
    if (!pair('diff')) return;
    compare.select('diff', { run: true });
    toast('Blue = where something was brighter first, red = brighter later. A moving star leaves a blue and red pair.');
  });
  $('sb-blink').addEventListener('click', () => {
    if (pair('blink')) compare.select('blink', { run: true });
  });
  $('sb-then').addEventListener('click', () => compare.select('then'));
  $('sb-measure').addEventListener('click', () => compare.select('measure'));
  $('sb-share').addEventListener('click', async () => {
    toast((await copyText(shareLink())) ? 'Link copied: paste it anywhere to share this view.' : 'Copy failed: copy the address bar instead.');
  });
}
