import { useEffect, useState, createContext, useContext, useCallback, lazy, Suspense } from 'react';
import { ClipboardList, Camera, Workflow, CheckSquare, Images, Settings2, Sparkles, ChevronDown, CheckCircle2, AlertCircle, FlaskConical } from 'lucide-react';
import { api, session } from './api.js';
import { t } from './i18n.js';
import Tasks from './pages/Tasks.jsx';
import Upload from './pages/Upload.jsx';
// The infinite canvas (React Flow) is desktop-only and heavy: load it on demand so phones download less.
const CanvasPage = lazy(() => import('./pages/Canvas.jsx'));
import Review from './pages/Review.jsx';
import Library from './pages/Library.jsx';
import Settings from './pages/Settings.jsx';
export { Badge, Precheck } from './ui.jsx';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const NAV = [
  { id: 'tasks', label: t('nav.tasks'), icon: ClipboardList, roles: ['photographer', 'designer', 'reviewer', 'admin'] },
  { id: 'upload', label: t('nav.upload'), short: t('nav.upload.short'), icon: Camera, roles: ['photographer', 'admin'] },
  { id: 'canvas', label: t('nav.canvas'), short: t('nav.canvas.short'), icon: Workflow, roles: ['designer', 'admin'] },
  { id: 'review', label: t('nav.review'), icon: CheckSquare, roles: ['reviewer', 'admin'] },
  { id: 'library', label: t('nav.library'), icon: Images, roles: ['designer', 'reviewer', 'admin'] },
  { id: 'settings', label: t('nav.settings'), icon: Settings2, roles: ['admin'] },
];
const ROLE_INITIAL = { photographer: '摄', designer: '美', reviewer: '审', admin: '管' };

function useHash() {
  const [h, setH] = useState(location.hash.slice(2) || '');
  useEffect(() => {
    const f = () => setH(location.hash.slice(2));
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h.split('/');
}
export const go = (p) => {
  location.hash = '#/' + p;
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [role, setRole] = useState(session.role);
  const [toasts, setToasts] = useState([]);
  const [pending, setPending] = useState(0);
  const [page, arg] = useHash();
  const notify = useCallback((msg, bad = false) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-2), { id, msg, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  useEffect(() => {
    api('/api/meta')
      .then(setMeta)
      .catch((e) => notify(e.message, true));
  }, []);
  useEffect(() => {
    const f = () =>
      api('/api/tasks')
        .then((r) => setPending(r.reduce((a, t) => a + (t.pendingCount || 0), 0)))
        .catch(() => {});
    f();
    const t = setInterval(f, 8000);
    window.addEventListener('wb:changed', f);
    return () => {
      clearInterval(t);
      window.removeEventListener('wb:changed', f);
    };
  }, [page]);
  const nav = NAV.filter((n) => n.roles.includes(role));
  const current = page || (role === 'reviewer' ? 'review' : 'tasks');
  const changeRole = (r) => {
    session.role = r;
    setRole(r);
    if (!NAV.find((n) => n.id === current)?.roles.includes(r)) go(NAV.find((n) => n.roles.includes(r)).id);
  };
  if (!meta)
    return (
      <div className="boot" style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--text-3)' }}>
        {t('app.loading')}
      </div>
    );
  const P = { tasks: Tasks, upload: Upload, canvas: CanvasPage, review: Review, library: Library, settings: Settings }[current] || Tasks;
  const allowed = NAV.find((n) => n.id === current)?.roles.includes(role) ?? true;
  const roleLabel = meta.roles.find((r) => r.id === role)?.label;
  const RoleSelect = ({ cls }) => (
    <select className={cls} value={role} onChange={(e) => changeRole(e.target.value)} aria-label={t('role.switch')}>
      {meta.roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.label}
        </option>
      ))}
    </select>
  );
  const Logo = () => (
    <a className="logo" href="#/tasks">
      <span className="logo-mark">
        <Sparkles size={16} strokeWidth={2.2} />
      </span>
      <span className="logo-text">
        <b>{t('app.name')}</b>
        <small>{t('app.tagline')}</small>
      </span>
    </a>
  );
  return (
    <Ctx.Provider value={{ meta, role, notify }}>
      <div className="app">
        <aside className="sidebar">
          <Logo />
          <div className="side-label">{t('side.workspace')}</div>
          <nav className="side-nav">
            {nav.map((n) => (
              <a key={n.id} href={'#/' + n.id} className={current === n.id ? 'on' : ''}>
                <n.icon size={17} strokeWidth={1.9} />
                {n.label}
                {n.id === 'review' && pending > 0 && <span className="count">{pending}</span>}
              </a>
            ))}
          </nav>
          <div className="side-foot">
            <div className="role-card">
              <span className="avatar">{ROLE_INITIAL[role]}</span>
              <div className="grow">
                <div className="xs muted">{t('side.role')}</div>
                <RoleSelect />
              </div>
              <ChevronDown size={14} className="chev" />
            </div>
            <div className="env">
              <FlaskConical size={12} />
              {t('side.defaultModel')}：
              {{ grok: 'Grok 生图（外部导入）', mock: '模拟（Mock）', openai: 'OpenAI', fal: 'fal.ai', http: '通用 HTTP', comfyui: 'ComfyUI' }[
                meta?.defaultProvider
              ] || meta?.defaultProvider}
            </div>
          </div>
        </aside>
        <header className="mtop">
          <Logo />
          <label className="role-btn">
            <span className="avatar">{ROLE_INITIAL[role]}</span>
            <RoleSelect />
            <ChevronDown size={14} className="chev" />
          </label>
        </header>
        <div className={'main' + (current === 'canvas' ? ' wide' : '')}>
          <main className="content" key={current + (arg || '')}>
            {allowed ? (
              <Suspense
                fallback={
                  <div className="muted" style={{ padding: 24 }}>
                    {t('app.loading')}
                  </div>
                }
              >
                <P arg={arg} />
              </Suspense>
            ) : (
              <div className="card">
                <div className="empty">
                  <div className="empty-title">{t('role.forbidden', { role: roleLabel })}</div>
                  <div className="empty-desc">{t('role.forbidden.hint')}</div>
                </div>
              </div>
            )}
          </main>
        </div>
        <nav className="tabbar">
          {nav.map((n) => (
            <a key={n.id} href={'#/' + n.id} className={current === n.id ? 'on' : ''}>
              <n.icon size={21} strokeWidth={current === n.id ? 2.2 : 1.8} />
              {n.short || n.label}
              {n.id === 'review' && pending > 0 && <span className="count">{pending}</span>}
            </a>
          ))}
        </nav>
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={'toast ' + (t.bad ? 'bad' : 'ok')}>
              {t.bad ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              <span>{t.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}
