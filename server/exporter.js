// Amazon export naming + manifest helpers (pure functions, unit-tested).
// Gallery images: <ASIN>.<SLOT>.jpg (MAIN, PT01..PT08). A+ modules: APLUS/<ASIN>.<TEMPLATE>_<W>x<H>.jpg

/** @param {string} id ASIN (or SKU fallback) @param {{slot:string, template_id:string, tw:number, th:number}} o */
export function amazonName(id, o) {
  return o.slot === 'APLUS' ? `APLUS/${id}.${o.template_id}_${o.tw}x${o.th}.jpg` : `${id}.${o.slot}.jpg`;
}

/** RFC 4180 CSV cell. */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells) => cells.map(csvCell).join(',');

/** SKU becomes a folder/file name, so keep it to a safe charset. */
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ASIN_RE = /^[A-Z0-9]{10}$/;
