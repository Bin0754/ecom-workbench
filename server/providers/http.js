// Generic HTTP adapter: plug any synchronous "prompt (+ image) in → image out" HTTP API in from the Settings page,
// without writing code. Config fields:
//   endpoint      full URL, e.g. https://api.example.com/v1/images/edits
//   method        POST (default) / PUT
//   keyEnv        NAME of the env var that holds the API key. Must start with WB_HTTP_ (e.g. WB_HTTP_API_KEY) so the
//                 web UI can never point another adapter's key (OPENAI_API_KEY, FAL_KEY…) at an arbitrary URL.
//   authHeader    header template, e.g. "Authorization: Bearer {{key}}" (empty = no auth header)
//   bodyTemplate  JSON template. A string that is exactly "{{var}}" is replaced by the typed value; otherwise
//                 {{var}} is interpolated. Vars: prompt, image_b64, image_data_url, mask_b64, mask_data_url,
//                 width, height, size ("1024x1024"), seed
//   resultPath    where the image is in the JSON response, e.g. data[0].b64_json or images[0].url
//                 (value may be base64, a data: URI or an http(s) URL). Empty = response body is the image itself.
//   pricePerImage USD per call, recorded in the cost ledger
//   timeoutSec    request timeout
// Async/queue APIs (submit → poll) need a small custom adapter; see docs/ADAPTERS.md.
import { getPath, toImageBuffer, fetchJson } from './util.js';

export const KEY_ENV_RE = /^WB_HTTP_[A-Z0-9_]+$/;

export function renderTemplate(tpl, vars) {
  const sub = (s) => {
    const exact = /^\{\{(\w+)\}\}$/.exec(s);
    if (exact) return vars[exact[1]] ?? null;
    return s.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
  };
  const walk = (v) =>
    typeof v === 'string'
      ? sub(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  let parsed;
  try {
    parsed = typeof tpl === 'string' ? JSON.parse(tpl) : tpl;
  } catch (e) {
    throw new Error('请求体模板不是合法 JSON (bodyTemplate is not valid JSON): ' + e.message);
  }
  return walk(parsed);
}

export function buildHeaders(config, env = process.env) {
  const h = { 'Content-Type': 'application/json' };
  if (config.authHeader) {
    if (config.keyEnv && !KEY_ENV_RE.test(config.keyEnv)) throw new Error('keyEnv 必须以 WB_HTTP_ 开头（keyEnv must start with WB_HTTP_）');
    const key = config.keyEnv ? env[config.keyEnv] : '';
    if (/\{\{key\}\}/.test(config.authHeader) && !key) throw new Error(`未设置环境变量 ${config.keyEnv || '(keyEnv)'}（API key env var is not set）`);
    const i = config.authHeader.indexOf(':');
    if (i < 1) throw new Error('鉴权头格式应为 "Header-Name: value"');
    h[config.authHeader.slice(0, i).trim()] = config.authHeader
      .slice(i + 1)
      .trim()
      .replace(/\{\{key\}\}/g, key);
  }
  return h;
}

export default {
  id: 'http',
  type: 'http',
  capabilities: () => ({ ops: ['txt2img', 'img2img'], pricing: '按配置的单价 (pricePerImage)' }),
  configFields: ['endpoint', 'method', 'keyEnv', 'authHeader', 'bodyTemplate', 'resultPath', 'pricePerImage', 'timeoutSec'],
  keyEnv: null,
  async generate({ prompt, image, mask, size, seed, config = {} }) {
    if (!config.endpoint || !/^https?:\/\//i.test(config.endpoint)) throw new Error('请先在设置里填写通用 HTTP 通道的请求地址 (endpoint)');
    const [width, height] = String(size || '1024x1024')
      .split('x')
      .map(Number);
    const b64 = image ? image.toString('base64') : '';
    const mb64 = mask ? mask.toString('base64') : '';
    const vars = {
      prompt,
      width,
      height,
      size,
      seed: seed ?? null,
      image_b64: b64,
      image_data_url: b64 && `data:image/png;base64,${b64}`,
      mask_b64: mb64,
      mask_data_url: mb64 && `data:image/png;base64,${mb64}`,
    };
    const body = renderTemplate(config.bodyTemplate || '{"prompt":"{{prompt}}","image":"{{image_b64}}"}', vars);
    const headers = buildHeaders(config);
    const timeout = Number(config.timeoutSec) || 180;
    let value;
    if (!config.resultPath) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout * 1000);
      try {
        const r = await fetch(config.endpoint, { method: config.method || 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
        value = Buffer.from(await r.arrayBuffer());
      } finally {
        clearTimeout(t);
      }
    } else {
      const json = await fetchJson(config.endpoint, { method: config.method || 'POST', headers, body: JSON.stringify(body) }, timeout);
      value = getPath(json, config.resultPath);
      if (!value) throw new Error(`返回中找不到图片字段 ${config.resultPath}`);
    }
    const buffer = await toImageBuffer(value);
    return { buffer, model: config.model || new URL(config.endpoint).host, usage: null, cost: Number(config.pricePerImage) || 0 };
  },
};
