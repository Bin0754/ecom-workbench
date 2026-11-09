// UI language for the web app (Chinese / English). Dictionaries live in shared/i18n/{zh,en}.js (shared with the server).
// Language order: ?lang=en|zh in the URL → saved choice (localStorage wb.lang) → browser language → English.
// The choice is also stored in the wb_lang cookie so the server-rendered login page matches.
import { DICTS, LANG_NAMES, t as translate, localize, pickLang } from '../../shared/i18n/index.js';

function detect() {
  try {
    const q = pickLang([new URLSearchParams(location.search).get('lang')]);
    if (q) localStorage.setItem('wb.lang', q);
    return q || pickLang([localStorage.getItem('wb.lang')]) || pickLang(navigator.languages || [navigator.language]) || 'en';
  } catch {
    return 'en';
  }
}
export const lang = detect();
export const LANGS = Object.keys(DICTS).map((id) => ({ id, label: LANG_NAMES[id] || id }));

/** UI string by key, e.g. t('nav.tasks') or t('role.forbidden', { role }). */
export const t = (key, vars) => translate(lang, key, vars);
/** Translate Chinese text that came from the server (errors, statuses, template names, precheck…); other text is returned as is. */
export const tx = (text) => localize(lang, text);

export function setLang(l) {
  try {
    localStorage.setItem('wb.lang', l);
  } catch {}
  const u = new URL(location.href);
  u.searchParams.delete('lang');
  location.replace(u.toString());
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  document.cookie = `wb_lang=${lang}; path=/; max-age=31536000; SameSite=Lax`;
  document.title = translate(lang, 'app.name');
}
