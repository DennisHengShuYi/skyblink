// Downloads: the current canvas as PNG, a recorded loop of the animation as video
// (MediaRecorder: WebM, or MP4 where that is what the browser records), and CSV text.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text, filename, type = 'text/csv') {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Safe file stem from a target name: letters, digits and dashes. */
export function fileStem(name) {
  return String(name || 'skyblink').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'skyblink';
}

/** PNG of what is on screen. Rejects if the canvas holds a cross-origin image. */
export function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be saved.'))), 'image/png');
    } catch {
      reject(new Error("This view includes an image from another site, so the browser won't let it be saved. Switch back to a SPHEREx frame."));
    }
  });
}

const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export function videoSupported(canvas) {
  return typeof MediaRecorder === 'function' && typeof canvas.captureStream === 'function'
    && VIDEO_TYPES.some((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * Record `cycles` passes over every frame at the player's speed.
 * Resolves {blob, ext}. `step(i)` shows frame i; `frameCount` frames per cycle.
 */
export function recordFrames(canvas, { frameCount, fps, step, cycles = 2 }) {
  const type = VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  const stream = canvas.captureStream(Math.max(1, Math.ceil(fps)));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4e6 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  return new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error('Recording failed.'));
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve({ blob: new Blob(chunks, { type: type.split(';')[0] }), ext: type.includes('mp4') ? 'mp4' : 'webm' });
    };
    const total = frameCount * cycles;
    let k = 0;
    step(0);
    rec.start();
    const timer = setInterval(() => {
      k += 1;
      if (k >= total) {
        clearInterval(timer);
        rec.stop();
        return;
      }
      step(k % frameCount);
    }, 1000 / fps);
  });
}
