// Small DOM helpers and renderers: tabs, radio groups, toast, clipboard, gallery,
// frame labels, timeline ticks and the provenance panel.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  children.flat().forEach((c) => {
    if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  });
  return node;
}

let toastTimer = null;
export function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { class: 'sr-only', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

/** ARIA tablist with arrow-key navigation. */
export function setupTabs(tablist, onSelect = () => {}) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const select = (tab, focus = false) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    onSelect(tab.id);
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const shown = tabs.filter((t) => !t.hidden);
      const k = shown.indexOf(tab);
      select(shown[(k + d + shown.length) % shown.length], true);
    });
  });
  return (id) => select(tabs.find((t) => t.id === id) || tabs[0]);
}

/** role=radiogroup of buttons keyed by a data attribute. Returns a setter. */
export function setupRadioGroup(group, attr, onChange) {
  const items = [...group.querySelectorAll('[role="radio"]')];
  const set = (value, notify = false) => {
    items.forEach((b) => {
      const on = b.dataset[attr] === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (notify) onChange(value);
  };
  items.forEach((b, i) => {
    b.addEventListener('click', () => set(b.dataset[attr], true));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      const next = items[(i + d + items.length) % items.length];
      next.focus();
      set(next.dataset[attr], true);
    });
  });
  return set;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Featured cards with a thumbnail. `media.thumb(f)` → image URL (or null);
 * `media.frames(f)` → Promise<URL[]> of survey-window frames, cycled on hover/focus.
 */
export function renderGallery(list, items, onPick, media = {}) {
  list.replaceChildren();
  if (!items.length) {
    list.append(el('li', { class: 'hint' }, 'No featured targets yet. Search for any star above.'));
    return;
  }
  items.forEach((f) => {
    const kind = f.kind === 'variable' ? 'Changes brightness' : 'Moves';
    const thumbSrc = media.thumb ? media.thumb(f) : null;
    const thumb = thumbSrc ? el('img', { class: 'feature-thumb', src: thumbSrc, alt: '', loading: 'lazy', width: 96, height: 96 }) : null;
    const btn = el('button', { type: 'button', class: 'feature' },
      thumb,
      el('span', { class: 'feature-body' },
        el('span', { class: `kind kind-${f.kind === 'variable' ? 'variable' : 'motion'}` }, kind),
        el('span', { class: 'feature-name' }, f.name),
        el('span', { class: 'feature-caption' }, f.caption || ''),
        el('span', { class: 'feature-meta' }, `${f.det || ''} · ${f.fov || ''}° field`)));
    btn.addEventListener('click', () => onPick(f));
    if (thumb && media.frames && !reducedMotion()) {
      let timer = null;
      let urls = null;
      const start = async () => {
        if (timer) return;
        try {
          urls = urls || await media.frames(f);
        } catch {
          urls = [];
        }
        if (urls.length < 2 || timer) return;
        let k = 0;
        timer = setInterval(() => { k = (k + 1) % urls.length; thumb.src = urls[k]; }, 700);
      };
      const stop = () => { clearInterval(timer); timer = null; thumb.src = thumbSrc; };
      btn.addEventListener('pointerenter', start);
      btn.addEventListener('focus', start);
      btn.addEventListener('pointerleave', stop);
      btn.addEventListener('blur', stop);
    }
    list.append(el('li', { class: 'card feature-card' }, btn));
  });
}

export function formatDate(frame, mode) {
  if (!frame) return '';
  const d = String(frame.date || '');
  if (mode === 'visits' && d.includes('T')) {
    const [day, time] = d.split('T');
    return `${day} ${time.slice(0, 5)} UTC`;
  }
  return d;
}

export function frameTitle(frame, mode, view, index, total) {
  if (!frame) return '';
  const pos = `${index + 1}/${total}`;
  if (mode === 'visits') {
    const um = Number.isFinite(frame.um) ? ` · ${frame.um.toFixed(3)} µm` : '';
    return `${formatDate(frame, mode)}${um} · image ${pos}`;
  }
  const win = (view.windows || []).find((w) => w.id === frame.window);
  const label = win ? `Survey window ${win.label}` : formatDate(frame, mode);
  return `${label} · ${frame.n ?? '?'} images stacked · ${pos}`;
}

export function frameOption(frame, mode, i) {
  if (mode === 'visits') return `#${i + 1} · ${formatDate(frame, mode)}`;
  return `#${i + 1} · ${frame.date || ''} (${frame.n ?? '?'} images)`;
}

/** Timeline tick marks: positioned by index to line up with the range thumb. */
export function renderTicks(container, frames, onPick) {
  container.replaceChildren();
  const n = frames.length;
  frames.forEach((f, i) => {
    const t = el('span', { class: 'tick', title: f.date || '' });
    t.style.left = n > 1 ? `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${i / (n - 1)})` : '50%';
    t.addEventListener('click', () => onPick(i));
    container.append(t);
  });
}

export function setActiveTick(container, index) {
  [...container.children].forEach((t, i) => t.classList.toggle('active', i === index));
}

/**
 * Date strip: one dot per frame at its real time (survey gaps show as gaps), labelled at the
 * start of each survey window. `positions` from frames.timePositions, `starts` from windowStarts.
 */
export function renderTimeStrip(container, frames, positions, starts, onPick) {
  container.replaceChildren();
  frames.forEach((f, i) => {
    const dot = el('button', {
      type: 'button', class: 'tdot', tabindex: '-1', 'aria-hidden': 'true', title: String(f.date || ''),
    });
    dot.style.left = `${positions[i] * 100}%`;
    dot.addEventListener('click', () => onPick(i));
    container.append(dot);
  });
  starts.forEach(({ index, label }) => {
    const t = el('span', { class: 'tlabel', 'aria-hidden': 'true' }, label);
    const pos = positions[index];
    t.style.left = `${pos * 100}%`;
    if (pos < 0.08) t.style.transform = 'none';             // keep edge labels inside the strip
    else if (pos > 0.92) t.style.transform = 'translateX(-100%)';
    container.append(t);
  });
}

export function setActiveDot(container, index) {
  [...container.querySelectorAll('.tdot')].forEach((t, i) => t.classList.toggle('active', i === index));
}

function row(dl, label, value) {
  dl.append(el('dt', {}, label), el('dd', {}, value));
}

const fmtNum = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

export function renderMeta(dl, { view, frame, mode }) {
  dl.replaceChildren();
  if (!frame) return;
  if (mode === 'visits') {
    row(dl, 'Date and time', formatDate(frame, mode) || '—');
    row(dl, 'MJD', fmtNum(frame.mjd, 4));
    row(dl, 'Observation ID', el('code', {}, frame.obs_id || '—'));
    row(dl, 'Data release', frame.collection || '—');
    row(dl, 'Wavelength', `${fmtNum(frame.um, 3)} µm${Number.isFinite(frame.um_bw) ? ` (±${(frame.um_bw / 2).toFixed(3)})` : ''}`);
    row(dl, 'Source file', frame.file
      ? el('a', { href: frame.file, target: '_blank', rel: 'noopener' }, 'Download FITS ↗')
      : '—');
    const frac = Number.isFinite(frame.flag_frac) ? `${(frame.flag_frac * 100).toFixed(1)}% of pixels` : '—';
    row(dl, 'Flagged pixels', frac);
    const counts = Object.entries(frame.flag_counts || {});
    row(dl, 'Flag counts', counts.length
      ? el('ul', { class: 'flag-list' }, counts.map(([k, v]) => el('li', {}, el('code', {}, k), ` ${v}`)))
      : 'none');
  } else {
    const win = (view.windows || []).find((w) => w.id === frame.window);
    row(dl, 'Survey window', win ? win.label : String(frame.window));
    row(dl, 'Mean date', `${frame.date || '—'} (MJD ${fmtNum(frame.mjd, 2)})`);
    row(dl, 'Images stacked', String(frame.n ?? '—'));
    row(dl, 'Mean wavelength', `${fmtNum(frame.um_mean, 3)} µm`);
    const visits = (view.visits || []).filter((v) => v.window === frame.window);
    if (visits.length) {
      row(dl, 'Source images', el('ul', { class: 'flag-list' }, visits.map((v) => el('li', {},
        v.file ? el('a', { href: v.file, target: '_blank', rel: 'noopener' }, v.obs_id || `image ${v.i}`) : (v.obs_id || `image ${v.i}`)))));
    }
    dl.append(el('p', { class: 'hint meta-note' }, 'Switch to "Every image" to see per-image flags and provenance.'));
  }
  row(dl, 'Band', `${view.band?.det || view.det} · ${fmtNum(view.band?.um_min, 2)}–${fmtNum(view.band?.um_max, 2)} µm`);
  row(dl, 'Pixel scale', `${view.grid?.scale_arcsec ?? '?'}″ per pixel, ${view.grid?.npix ?? '?'} × ${view.grid?.npix ?? '?'} px`);
  if (view.stretch) row(dl, 'Brightness scale', `${view.stretch.kind}, ${fmtNum(view.stretch.lo, 3)} to ${fmtNum(view.stretch.hi, 3)} ${view.stretch.unit || ''}`);
}
