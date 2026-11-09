// Shared helpers for model adapters.

/** Read a value at a dot/bracket path, e.g. "data[0].b64_json" or "images.0.url". */
export function getPath(obj, p) {
  if (!p) return obj;
  return String(p)
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Turn a model result value into image bytes. Accepts raw base64, a data: URI, or an http(s) URL.
 * @returns {Promise<Buffer>}
 */
export async function toImageBuffer(v, { fetchImpl = fetch } = {}) {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v !== 'string' || !v) throw new Error('结果字段为空 (empty image field in response)');
  if (v.startsWith('data:')) return Buffer.from(v.slice(v.indexOf(',') + 1), 'base64');
  if (/^https?:\/\//i.test(v)) {
    const r = await fetchImpl(v);
    if (!r.ok) throw new Error(`下载结果图失败 HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  return Buffer.from(v, 'base64');
}

/** fetch with timeout + readable errors. */
export async function fetchJson(url, opts = {}, timeoutSec = 180) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  let res;
  try {
    res = await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `请求超时（${timeoutSec}s）：${url}` : `请求失败：${e.message}`);
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${(json?.error?.message || json?.error || json?.detail || text || res.statusText).toString().slice(0, 300)}`);
    e.status = res.status;
    throw e;
  }
  return json ?? text;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
