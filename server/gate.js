// Access gate: one shared password (env WB_ACCESS_PASSWORD). On success an HttpOnly, SameSite=Lax cookie is issued.
// The cookie value is an HMAC derived from the password, so changing the password logs everyone out.
// Password comparison is constant-time; failed logins are rate-limited per client IP (10 per 10 minutes).
// When no password is configured the gate is off (only for a trusted machine / LAN).
import crypto from 'node:crypto';
import { config, log } from './config.js';

const COOKIE = 'wb_session';
const MAX_AGE = 30 * 24 * 3600;
const tokenFor = (pw) => crypto.createHmac('sha256', pw).update('ecom-workbench-session-v1').digest('hex');
const dec = (v) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
const parseCookies = (h = '') =>
  Object.fromEntries(
    h
      .split(';')
      .map((s) => s.trim().split('='))
      .filter((p) => p[0])
      .map(([k, ...v]) => [k, dec(v.join('='))]),
  );
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/');

const WINDOW_MS = 10 * 60e3,
  MAX_FAILS = 10;
const attempts = new Map(); // ip -> [timestamps of failed logins]
function limited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(ip, a);
  if (attempts.size > 10000) for (const [k, v] of attempts) if (!v.length || now - v[v.length - 1] > WINDOW_MS) attempts.delete(k); // bound memory
  return a.length >= MAX_FAILS;
}
export const _test = { tokenFor, safeEq, safeNext, parseCookies };

const page = (err = '', next = '/') => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#F7F5F2">
<title>登录 · 商品图工作台</title><style>
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{font-family:'Inter Variable',Inter,'PingFang SC','Noto Sans SC','Noto Sans CJK SC','Microsoft YaHei',system-ui,sans-serif;background:#F7F5F2;color:#1C1917;-webkit-font-smoothing:antialiased;
display:flex;align-items:center;justify-content:center;padding:24px 20px calc(24px + env(safe-area-inset-bottom));
background-image:radial-gradient(ellipse 80% 50% at 50% -10%,#F3E3E7 0%,rgba(247,245,242,0) 70%)}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #E8E3DC;border-radius:20px;padding:32px 24px 24px;box-shadow:0 1px 2px rgba(28,25,23,.04),0 12px 32px rgba(28,25,23,.08)}
.logo{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,#B25A6F,#8A3F51);display:grid;place-items:center;box-shadow:0 6px 16px rgba(158,74,94,.3);margin-bottom:20px}
h1{font-size:22px;font-weight:700;letter-spacing:-.01em}.sub{color:#78716C;font-size:14px;margin-top:6px;line-height:1.5}
form{margin-top:24px}label{display:block;font-size:13px;font-weight:600;color:#44403C;margin-bottom:8px}
input{width:100%;height:50px;border:1px solid #E0D9D0;border-radius:12px;padding:0 14px;font-size:17px;font-family:inherit;background:#FCFBF9;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:#9E4A5E;box-shadow:0 0 0 4px rgba(158,74,94,.12);background:#fff}
button{margin-top:16px;width:100%;height:50px;border:0;border-radius:12px;background:#9E4A5E;color:#fff;font-size:16px;font-weight:650;font-family:inherit;cursor:pointer;box-shadow:0 6px 16px rgba(158,74,94,.28)}
button:active{background:#8A3F51}.err{margin-top:14px;padding:10px 12px;border-radius:10px;background:#FDECEC;color:#B42318;font-size:13.5px;border:1px solid #F6CACA}
.foot{margin-top:20px;font-size:12px;color:#A8A29E;text-align:center;line-height:1.6}
</style></head><body><main class="card">
<div class="logo"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 14.06 4 20M14.06 9.94 20 4M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4"/></svg></div>
<h1>商品图工作台</h1><p class="sub">Amazon · 护肤 ｜ 内部测试版，请输入访问密码</p>
<form method="post" action="/login"><input type="hidden" name="next" value="${String(next).replace(/"/g, '&quot;')}">
<label for="pw">访问密码</label><input id="pw" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" autofocus required>
${err ? `<div class="err">${err}</div>` : ''}<button type="submit">进入工作台</button></form>
<p class="foot">登录后 30 天内免登录 · 密码由管理员提供</p></main></body></html>`;

export function installGate(app, express, pw = config.accessPassword) {
  if (!pw) {
    log.warn('[gate] WB_ACCESS_PASSWORD is not set: the access gate is OFF. Only run like this on a trusted machine/LAN.');
    return false;
  }
  if (pw.length < 8) log.warn('[gate] WB_ACCESS_PASSWORD is shorter than 8 characters; use a longer one for anything reachable from the internet.');
  const token = tokenFor(pw);
  const authed = (req) => safeEq(parseCookies(req.headers.cookie)[COOKIE] || '', token);
  const setCookie = (req, res, val, age) =>
    res.setHeader('Set-Cookie', `${COOKIE}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${req.secure || config.cookieSecure ? '; Secure' : ''}`);

  app.get('/login', (req, res) => (authed(req) ? res.redirect(safeNext(req.query.next)) : res.type('html').send(page('', safeNext(req.query.next)))));
  const login = (req, res, asJson) => {
    const ip = req.ip;
    if (limited(ip))
      return asJson
        ? res.status(429).json({ error: '尝试次数过多，请 10 分钟后再试' })
        : res.status(429).type('html').send(page('尝试次数过多，请 10 分钟后再试'));
    if (!safeEq(req.body?.password || '', pw)) {
      attempts.get(ip).push(Date.now());
      return asJson
        ? res.status(401).json({ error: '密码不正确' })
        : res
            .status(401)
            .type('html')
            .send(page('密码不正确，请重试', safeNext(req.body?.next)));
    }
    attempts.delete(ip);
    setCookie(req, res, token, MAX_AGE);
    return asJson ? res.json({ ok: true }) : res.redirect(303, safeNext(req.body?.next));
  };
  app.post('/login', express.urlencoded({ extended: false }), (req, res) => login(req, res, false));
  app.post('/api/login', express.json(), (req, res) => login(req, res, true));
  app.all('/logout', (req, res) => {
    setCookie(req, res, '', 0);
    res.redirect('/login');
  });

  app.use((req, res, next) => {
    if (authed(req) || req.path === '/api/health') return next(); // health check stays public (no data in it)
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '未登录', login: '/login' });
    if (req.method === 'GET' && !/^\/(files|thumb|assets)\//.test(req.path)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).send('未登录');
  });
  return true;
}
