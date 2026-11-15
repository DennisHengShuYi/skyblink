// Share the view: animated GIF of the frames (as drawn on screen) and a 1200×630
// picture card. Downloads go through exporter.js; GIF encoding uses gifenc (pinned CDN).
import { downloadBlob } from './exporter.js';
import { slugify, cardCaption } from './share-text.js';

const GIFENC_URL = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
const GIF_SIZE = 480;
const CARD_W = 1200;
const CARD_H = 630;
const CREDIT = 'SkyBlink · NASA SPHEREx';

function footer(ctx, w, h, text) {
  ctx.fillStyle = 'rgba(5, 8, 20, 0.75)';
  ctx.fillRect(0, h - 26, w, 26);
  ctx.fillStyle = '#e8ecf8';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(text, 10, h - 8);
}

/** Visit every frame on the player (as rendered: display settings and overlays), then restore. */
async function eachFrame(player, draw) {
  const wasPlaying = player.playing;
  const start = player.index;
  player.pause();
  try {
    for (let i = 0; i < player.frames.length; i += 1) {
      player.setIndex(i);
      await new Promise((r) => requestAnimationFrame(r));
      draw(player.canvas, player.frames[i], i);
    }
  } finally {
    player.setIndex(start);
    if (wasPlaying) player.play();
  }
}

/** Animated GIF Blob of the current frames. Rejects with a friendly message if gifenc can't load. */
export async function makeGif(player, { fps = 2, title = 'SkyBlink' } = {}) {
  let lib;
  try {
    lib = await import(GIFENC_URL);
  } catch {
    throw new Error("The GIF maker couldn't be downloaded. Check your connection, or use Save image instead.");
  }
  const { GIFEncoder, quantize, applyPalette } = lib;
  const gif = GIFEncoder();
  const c = document.createElement('canvas');
  c.width = GIF_SIZE;
  c.height = GIF_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const delay = Math.round(1000 / Math.max(0.5, fps));
  await eachFrame(player, (canvas, frame) => {
    ctx.drawImage(canvas, 0, 0, GIF_SIZE, GIF_SIZE);
    footer(ctx, GIF_SIZE, GIF_SIZE, `${title} · ${frame?.date || ''} · ${CREDIT}`);
    const { data } = ctx.getImageData(0, 0, GIF_SIZE, GIF_SIZE);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), GIF_SIZE, GIF_SIZE, { palette, delay });
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/** 1200×630 PNG card: title, first and last frames, caption and link. */
export async function makeCard(player, { title, kind, url }) {
  const c = document.createElement('canvas');
  c.width = CARD_W;
  c.height = CARD_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#070b1d';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const shots = [];
  const last = player.frames.length - 1;
  await eachFrame(player, (canvas, frame, i) => {
    if (i !== 0 && i !== last) return;
    const s = document.createElement('canvas');
    s.width = 400;
    s.height = 400;
    s.getContext('2d').drawImage(canvas, 0, 0, 400, 400);
    shots.push({ s, date: frame?.date || '' });
  });
  shots.forEach(({ s, date }, k) => {
    const x = 60 + k * 440;
    ctx.drawImage(s, x, 140, 400, 400);
    ctx.fillStyle = '#9fb0d0';
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(date, x, 570);
  });
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(title, 60, 80);
  ctx.fillStyle = '#5ce1ff';
  ctx.font = '26px system-ui, sans-serif';
  ctx.fillText(cardCaption({ title, kind }), 60, 120);
  ctx.fillStyle = '#e8ecf8';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(CREDIT, 960, 600);
  ctx.fillStyle = '#9fb0d0';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(url.length > 90 ? `${url.slice(0, 87)}…` : url, 60, 610);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Card failed.'))), 'image/png'));
}

/** System share sheet with the file when supported (phones), otherwise download it. */
export async function shareOrDownload(blob, filename, { title, url }) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text: url });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export const fileName = (title, ext) => `${slugify(title)}.${ext}`;
