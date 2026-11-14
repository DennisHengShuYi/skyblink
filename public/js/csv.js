// CSV text for downloads (spectrum, light curve). RFC 4180 quoting.

function cell(v) {
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  return [columns, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
