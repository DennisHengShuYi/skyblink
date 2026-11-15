// Spot the Change in the viewer: the puzzle banner, hints, tap check and reveal.
import { answerTrack, checkTap, quarterOf, shareLine, nextStreak, puzzleDay } from './puzzle.js';
import { $, el, toast, copyText } from './ui.js';

const STREAK_KEY = 'skyblink.puzzleStreak';

export function readStreak() {
  try {
    const s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null');
    return s && Number.isInteger(s.last) && Number.isInteger(s.count) ? s : null;
  } catch {
    return null;
  }
}

function saveStreak(s) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the streak lasts for this page only.
  }
}

/**
 * @param {object} ctx
 * @param {import('./player.js').Player} ctx.player
 * @param {() => {view: object, frames: object[]}} ctx.current
 * @param {{select: Function, reset: Function}} ctx.compare
 * @param {(slug: string, det: string, opts: object) => void} ctx.open  open a featured view
 */
export function createPuzzleUi({ player, current, compare, open }) {
  let game = null; // {puzzle, track, hints, done, name}

  function panel(lines, buttons = []) {
    $('puzzle-panel').replaceChildren(...lines, el('div', { class: 'chips' }, ...buttons));
    $('puzzle-panel').hidden = false;
  }

  function button(label, fn, cls = 'btn btn-ghost') {
    const b = el('button', { type: 'button', class: cls }, label);
    b.addEventListener('click', fn);
    return b;
  }

  function hideSpoilers(on) {
    ['move-card', 'distance-card', 'describe-card'].forEach((id) => { $(id).hidden = on || !$(id).childElementCount; });
    document.body.classList.toggle('puzzling', on);
    player.setOverlay('cross', on ? 'off' : 'cross');
  }

  function render() {
    if (!game) return;
    const hintSteps = [
      ['Hint: blink first ↔ last', () => {
        const n = current().frames.length;
        $('blink-a').value = '0';
        $('blink-b').value = String(n - 1);
        compare.select('blink', { run: true });
      }],
      ['Hint: show the difference', () => {
        const n = current().frames.length;
        $('diff-a').value = '0';
        $('diff-b').value = String(n - 1);
        compare.select('diff', { run: true });
      }],
      ['Hint: which quarter?', () => toast(`Look in the ${quarterOf(game.track, current().view.grid.npix)} of the picture.`)],
    ];
    const next = hintSteps[game.hints];
    const buttons = [];
    if (next) buttons.push(button(next[0], () => { game.hints += 1; next[1](); render(); }));
    buttons.push(button('Show me the answer', () => finish(false)));
    panel([
      el('h3', {}, `Sky puzzle #${game.puzzle.number}`),
      el('p', {}, 'Something in these SPHEREx pictures moved or changed brightness. Play or step through them, then tap it.'),
      el('p', { class: 'hint' }, `Hints used: ${game.hints}. Bright stars can wobble a little because the telescope's blur changes: look for a real step or a real fade.`),
    ], buttons);
  }

  function finish(solved) {
    const day = puzzleDay(new Date());
    const streak = nextStreak(readStreak(), day, solved);
    saveStreak(streak);
    game.done = true;
    compare.reset();
    hideSpoilers(false);
    $('view-title').textContent = game.name;
    player.setMarks(game.track.map((p, i) => ({ kind: 'ring', x: p.x, y: p.y, r: 2, color: solved ? '#7CFC9A' : '#ffd166', label: i === 0 ? (solved ? 'you found it' : 'here') : '' })));
    const line = shareLine(game.puzzle.number, game.hints, solved);
    panel([
      el('h3', {}, solved ? 'You found it!' : 'Here it is'),
      el('p', {}, game.puzzle.reveal),
      el('p', { class: 'hint' }, streak.count ? `Puzzle streak: ${streak.count} day${streak.count === 1 ? '' : 's'}. A new puzzle comes at midnight UTC.` : 'A new puzzle comes at midnight UTC.'),
    ], [
      button('Copy my result (no spoilers)', async () => toast((await copyText(line)) ? 'Copied: paste it to challenge a friend.' : 'Copy failed.')),
      button('Close', () => { $('puzzle-panel').hidden = true; player.setMarks([]); }),
    ]);
  }

  return {
    get active() { return Boolean(game) && !game.done; },
    start(puzzle, name) {
      game = null;
      open(puzzle.slug, puzzle.det, {
        title: `Sky puzzle #${puzzle.number}`,
        then: (view) => {
          game = { puzzle, track: answerTrack(view, puzzle), hints: 0, done: false, name };
          hideSpoilers(true);
          render();
        },
      });
    },
    tap(p) {
      if (!game || game.done) return;
      if (checkTap(game.track, p)) finish(true);
      else toast('Not there. Keep looking, or take a hint.');
    },
    stop() {
      if (game && !game.done) hideSpoilers(false);
      game = null;
      $('puzzle-panel').hidden = true;
    },
  };
}
