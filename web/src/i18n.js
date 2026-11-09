// Minimal i18n hook. Default language is Chinese (zh). Switch with ?lang=en in the URL (remembered in localStorage
// as wb.lang) or localStorage.setItem('wb.lang', 'en'). Only the app shell is translated so far — add keys here and
// replace literals with t('key') to translate more screens (PRs welcome).
const DICT = {
  zh: {
    'app.name': '商品图工作台',
    'app.tagline': 'Amazon · 护肤',
    'app.loading': '加载中…',
    'side.workspace': '工作区',
    'side.role': '当前角色',
    'side.defaultModel': '默认模型',
    'nav.tasks': '任务单',
    'nav.upload': '拍摄上传',
    'nav.upload.short': '上传',
    'nav.canvas': '出图画布',
    'nav.canvas.short': '画布',
    'nav.review': '审核',
    'nav.library': '素材库',
    'nav.settings': '设置',
    'role.switch': '切换角色',
    'role.forbidden': '「{role}」角色不能使用此页面',
    'role.forbidden.hint': '请在右上角切换角色。',
  },
  en: {
    'app.name': 'Product Image Workbench',
    'app.tagline': 'Amazon · Skincare',
    'app.loading': 'Loading…',
    'side.workspace': 'Workspace',
    'side.role': 'Current role',
    'side.defaultModel': 'Default model',
    'nav.tasks': 'Shoot tasks',
    'nav.upload': 'Shoot & upload',
    'nav.upload.short': 'Upload',
    'nav.canvas': 'Canvas',
    'nav.canvas.short': 'Canvas',
    'nav.review': 'Review',
    'nav.library': 'Library',
    'nav.settings': 'Settings',
    'role.switch': 'Switch role',
    'role.forbidden': 'The "{role}" role cannot use this page',
    'role.forbidden.hint': 'Switch role in the top-right corner.',
  },
};

function detect() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && DICT[q]) localStorage.setItem('wb.lang', q);
    const s = localStorage.getItem('wb.lang');
    if (s && DICT[s]) return s;
  } catch {
    /* SSR / privacy mode */
  }
  return 'zh';
}
export const lang = detect();
export function t(key, vars = {}) {
  const s = DICT[lang]?.[key] ?? DICT.zh[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
if (typeof document !== 'undefined') document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
