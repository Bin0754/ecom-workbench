// API helpers: role headers; uploads use XHR for progress and automatic retries. Server errors are translated with tx().
import { t, tx } from './i18n.js';
export const session = {
  get role() {
    return localStorage.getItem('wb.role') || 'photographer';
  },
  set role(v) {
    localStorage.setItem('wb.role', v);
  },
  get user() {
    return localStorage.getItem('wb.user') || '';
  },
  set user(v) {
    localStorage.setItem('wb.user', v);
  },
};
const headers = () => ({ 'x-role': session.role, 'x-user': encodeURIComponent(session.user || session.role) });

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...headers(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
    throw new Error(t('api.login'));
  }
  if (!res.ok) throw new Error(tx(data.error) || t('api.failed', { status: res.status }));
  return data;
}

// POST a file as the raw request body (used by the external-import channel).
export async function uploadRaw(url, file) {
  const res = await fetch(url, { method: 'POST', headers: { ...headers(), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(tx(data.error) || t('api.uploadFailed', { status: res.status }));
  return data;
}

export function uploadXHR(url, form, { method = 'POST', onProgress, retries = 3 } = {}) {
  const attempt = (n) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      Object.entries(headers()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let d = {};
        try {
          d = JSON.parse(xhr.responseText);
        } catch {}
        xhr.status < 300
          ? resolve(d)
          : reject(Object.assign(new Error(tx(d.error) || t('api.uploadFailed', { status: xhr.status })), { fatal: xhr.status < 500 }));
      };
      xhr.onerror = () => reject(new Error(t('api.network')));
      xhr.ontimeout = () => reject(new Error(t('api.timeout')));
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(form);
    });
  const go = async (n) => {
    try {
      return await attempt(n);
    } catch (e) {
      if (e.fatal || n >= retries) throw e;
      onProgress?.(0, t('api.retry', { sec: n * 2, n: n + 1 }));
      await new Promise((r) => setTimeout(r, n * 2000));
      return go(n + 1);
    }
  };
  return go(1);
}

// Client-side compression: long edge to maxEdge, JPEG quality q, EXIF orientation applied
export async function compressImage(file, maxEdge = 2000, q = 0.85) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
  return { blob, width: c.width, height: c.height };
}

export const fmtBytes = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
