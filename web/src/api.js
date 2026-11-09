// 前端 API 封装：带角色头；上传用 XHR 以便显示进度并自动重试
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
    throw new Error('请先登录');
  }
  if (!res.ok) throw new Error(data.error || `请求失败 ${res.status}`);
  return data;
}

// POST a file as the raw request body (used by the external-import channel).
export async function uploadRaw(url, file) {
  const res = await fetch(url, { method: 'POST', headers: { ...headers(), 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `上传失败 ${res.status}`);
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
        xhr.status < 300 ? resolve(d) : reject(Object.assign(new Error(d.error || `上传失败 ${xhr.status}`), { fatal: xhr.status < 500 }));
      };
      xhr.onerror = () => reject(new Error('网络中断'));
      xhr.ontimeout = () => reject(new Error('上传超时'));
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(form);
    });
  const go = async (n) => {
    try {
      return await attempt(n);
    } catch (e) {
      if (e.fatal || n >= retries) throw e;
      onProgress?.(0, `网络不稳，${n * 2} 秒后第 ${n + 1} 次重试…`);
      await new Promise((r) => setTimeout(r, n * 2000));
      return go(n + 1);
    }
  };
  return go(1);
}

// 客户端压缩：长边缩到 maxEdge，JPEG 质量 q；按 EXIF 方向转正
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
export const STATUS = {
  generating: ['生成中', 'blue'],
  failed: ['生成失败', 'red'],
  draft: ['草稿', 'gray'],
  pending: ['待审核', 'amber'],
  rejected: ['已打回', 'red'],
  approved: ['已通过', 'green'],
  void: ['已作废', 'gray'],
};
export const LEVEL = { pass: ['通过', 'green'], warn: ['注意', 'amber'], fail: ['不合规', 'red'] };
