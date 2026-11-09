// Shared i18n core used by the web app and the server (login page).
// - t(lang, key, vars): look up a UI string by key; {name} placeholders are filled from vars.
// - localize(lang, text): translate a Chinese string that came from the server (errors, precheck results, template
//   names, statuses…) by matching it against the `srv.*` entries of the zh dictionary, including {placeholders}.
//   Unknown text is returned unchanged, so user content (product names, copy) is never altered.
// To add a language: copy en.js, translate the values, and register it in DICTS below.
import zh from './zh.js';
import en from './en.js';

export const DICTS = { zh, en };
export const LANGS = Object.keys(DICTS);
export const LANG_NAMES = { zh: '中文', en: 'English' };

const VAR = /(?<!\{)\{(\w+)\}(?!\})/g;
const fill = (s, vars) => s.replace(VAR, (m, k) => ((vars[k] ?? vars[k] === 0) ? String(vars[k]) : m));

export function t(lang, key, vars = {}) {
  const s = DICTS[lang]?.[key] ?? zh[key] ?? key;
  return fill(s, vars);
}

export function pickLang(candidates = []) {
  for (const c of candidates) {
    const l = String(c || '')
      .toLowerCase()
      .split(/[-_]/)[0];
    if (DICTS[l]) return l;
  }
  return null;
}

// ---- reverse lookup for server-produced Chinese text ----
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let exact, patterns;
function build() {
  exact = new Map();
  patterns = [];
  for (const [key, s] of Object.entries(zh)) {
    if (!key.startsWith('srv.')) continue;
    const names = [];
    let src = '',
      last = 0;
    for (const m of s.matchAll(VAR)) {
      src += esc(s.slice(last, m.index)) + '([\\s\\S]+?)';
      names.push(m[1]);
      last = m.index + m[0].length;
    }
    if (!names.length) {
      if (!exact.has(s)) exact.set(s, key);
    } else patterns.push({ key, names, re: new RegExp('^' + src + esc(s.slice(last)) + '$'), lit: s.length - names.length * 4 });
  }
  patterns.sort((a, b) => b.lit - a.lit);
}

export function localize(lang, text, depth = 0) {
  if (lang === 'zh' || typeof text !== 'string' || !text || !DICTS[lang]) return text;
  if (!exact) build();
  const k = exact.get(text);
  if (k) return DICTS[lang][k] ?? text;
  if (depth > 2 || !/[\u4e00-\u9fff]/.test(text)) return text;
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const vars = Object.fromEntries(p.names.map((n, i) => [n, localize(lang, m[i + 1], depth + 1)]));
    return fill(DICTS[lang][p.key] ?? text, vars);
  }
  // Lists joined with "/" or "、" (e.g. role names in a permission error)
  if (/[、/]/.test(text) && depth < 2) {
    const sep = text.includes('、') ? '、' : '/';
    const parts = text.split(sep);
    if (parts.length > 1 && parts.every((x) => exact.has(x))) return parts.map((x) => localize(lang, x, depth + 1)).join(sep === '、' ? ', ' : '/');
  }
  return text;
}
