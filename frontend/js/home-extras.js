// Home-page extras for newcomers: today's sky puzzle, Birthday Sky, and "see infrared
// with your TV remote" (the phone camera sees the remote's invisible flash).
import { findBirthday, birthdayText } from './birthday.js';
import { puzzleOfDay, puzzleDay } from './puzzle.js';
import { readStreak } from './puzzle-ui.js';
import { $, el, toast } from './ui.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REMOTE_UM = 0.94;

let calendarPromise = null;
function loadCalendar() {
  if (!calendarPromise) {
    calendarPromise = fetch('calendar.json').then((r) => {
      if (!r.ok) throw new Error(`calendar ${r.status}`);
      return r.json();
    });
    calendarPromise.catch(() => { calendarPromise = null; });
  }
  return calendarPromise;
}

function card(title, ...children) {
  return el('section', { class: 'card extra-card' }, el('h3', {}, title), ...children);
}

function button(label, fn, cls = 'btn btn-primary') {
  const b = el('button', { type: 'button', class: cls }, label);
  b.addEventListener('click', fn);
  return b;
}

// ---------- TV remote ----------

function createIrDialog({ openVisit }) {
  const dialog = $('ir-dialog');
  const video = $('ir-video');
  let stream = null;

  function stopCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  async function startCamera() {
    $('ir-camera-msg').textContent = '';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      await video.play();
    } catch {
      $('ir-camera-msg').textContent = "The camera isn't available here (no permission, or no camera). You can still try it with your phone's camera app: point the remote at the front (selfie) camera and press a button.";
    }
  }

  $('ir-start').addEventListener('click', startCamera);
  $('ir-seen').addEventListener('click', () => {
    $('ir-after').hidden = false;
    $('ir-after').scrollIntoView({ block: 'nearest' });
  });
  $('ir-sky').addEventListener('click', () => {
    stopCamera();
    dialog.close();
    openVisit('barnard', 'D1', REMOTE_UM);
  });
  $('ir-longest').addEventListener('click', () => {
    stopCamera();
    dialog.close();
    openVisit('wise0855', 'D6', null);
  });
  dialog.addEventListener('close', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  return () => {
    $('ir-after').hidden = true;
    $('ir-camera-msg').textContent = '';
    dialog.showModal();
  };
}

// ---------- Birthday Sky ----------

function birthdayCard({ openVisit }) {
  const month = el('select', { id: 'bd-month', 'aria-label': 'Birthday month' },
    ...MONTHS.map((m, i) => el('option', { value: String(i + 1) }, m)));
  const day = el('select', { id: 'bd-day', 'aria-label': 'Birthday day' },
    ...Array.from({ length: 31 }, (_, i) => el('option', { value: String(i + 1) }, String(i + 1))));
  const out = el('p', { class: 'bd-out', 'aria-live': 'polite' });
  const open = el('div', { class: 'chips' });
  const go = button('What did SPHEREx see?', async () => {
    open.replaceChildren();
    try {
      const cal = await loadCalendar();
      const hit = findBirthday(cal, Number(month.value), Number(day.value));
      if (!hit) {
        out.textContent = 'That date doesn\'t exist. Pick another day.';
        return;
      }
      out.textContent = birthdayText(hit);
      open.append(button(`Open that picture of ${hit.view.name}`, () => openVisit(hit.view.slug, hit.view.det, null, hit.visit.i), 'btn btn-ghost'));
    } catch {
      out.textContent = "The picture calendar didn't load. Please try again.";
    }
  }, 'btn btn-ghost');
  return card('Birthday Sky',
    el('p', {}, 'Pick your birthday (no year needed, and it stays on your device). SkyBlink finds the picture SPHEREx took on that day, or the nearest one.'),
    el('div', { class: 'bd-row' }, day, month, go), out, open);
}

// ---------- puzzle ----------

function puzzleCard({ startPuzzle }) {
  const today = puzzleOfDay(new Date());
  const streak = readStreak();
  const live = streak && streak.last >= puzzleDay(new Date()) - 1 ? streak.count : 0;
  return card(`Today's sky puzzle #${today.number}`,
    el('p', {}, 'Something in one patch of SPHEREx\'s sky moved or changed. Can you spot it? Hints if you need them.'),
    ...(live ? [el('p', { class: 'hint' }, `Your streak: ${live} day${live === 1 ? '' : 's'}.`)] : []),
    button('Play today\'s puzzle', () => startPuzzle(today)));
}

/**
 * @param {object} ctx
 * @param {(slug: string, det: string, um: number|null, visit?: number) => void} ctx.openVisit
 * @param {(puzzle: object) => void} ctx.startPuzzle
 * @param {() => void} ctx.printLesson
 */
export function renderHomeExtras({ openVisit, startPuzzle, printLesson }) {
  const box = $('home-extras');
  if (!box) return;
  const openIr = createIrDialog({ openVisit });
  box.replaceChildren(
    puzzleCard({ startPuzzle }),
    birthdayCard({ openVisit }),
    card('See infrared with your TV remote',
      el('p', {}, 'SPHEREx sees infrared light, which our eyes can\'t. Your TV remote flashes infrared every time you press a button, and many phone cameras can see it.'),
      button('Try it', () => {
        if (!navigator.mediaDevices?.getUserMedia) toast('This browser has no camera access; the steps still work with your phone\'s camera app.');
        openIr();
      }, 'btn btn-ghost')),
    card('For teachers: How fast is a star?',
      el('p', {}, 'A printable 30-minute worksheet: watch, measure and check a star’s speed with real SPHEREx pictures, with an answer key computed from the same data.'),
      button('Print the lesson', printLesson, 'btn btn-ghost')),
  );
}
