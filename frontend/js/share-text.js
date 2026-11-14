// Pure helpers for sharing (no DOM): safe file names and the share-card caption.
const MAX_SLUG = 40;

/** Lowercase a-z0-9 words joined by hyphens, accents folded, max 40 chars; "skyblink" if empty. */
export function slugify(title) {
  const s = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return s || 'skyblink';
}

/** One-line caption for the picture card. */
export function cardCaption({ title, kind }) {
  if (kind === 'motion') return `I watched ${title} move across the sky!`;
  if (kind === 'variable') return `I watched ${title} change brightness!`;
  return `I explored ${title} with NASA SPHEREx.`;
}
