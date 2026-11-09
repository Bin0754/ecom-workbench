// fal.ai 适配器：OpenAI GPT Image 2.5（fal 托管）。
// 端点（已在 fal.ai 模型页核实）：openai/gpt-image-2.5/sunburst/edit、openai/gpt-image-2.5/flare/edit
// 队列 API：POST https://queue.fal.run/<model> → 轮询 status_url → GET response_url
// 输入：prompt, image_urls[]（这里用 base64 data URI）, image_size {width,height}, quality, output_format
// Optional adapter. The key is read ONLY from the FAL_KEY env var, at call time; it is never stored, logged or
// returned by the API, and there is deliberately no fallback to any other variable (e.g. OPENAI_API_KEY).
// The channel stays disabled until an admin enables it in Settings AND FAL_KEY is set.
export const FAL_MODELS = ['openai/gpt-image-2.5/sunburst/edit', 'openai/gpt-image-2.5/flare/edit'];

// fal 官方价目表：单张编辑图的「输出」成本（美元），按 1024×1024 档；按像素线性折算，另加每张参考图约 $0.008。
const OUT_1M = { low: 0.00588, medium: 0.01317, high: 0.05268, xhigh: 0.09366, max: 0.21072 };
export function estimateCost(w, h, quality = 'high', refs = 1, promptChars = 0) {
  const px = (w * h) / (1024 * 1024);
  return +((OUT_1M[quality] ?? OUT_1M.high) * px + 0.008 * refs + ((promptChars / 4) * 5) / 1e6).toFixed(5);
}
const key = () => process.env.FAL_KEY || '';
export const falKeyPresent = () => Boolean(process.env.FAL_KEY);

function falSize(size) {
  let [w, h] = size.split('x').map(Number);
  const k = Math.min(1, 2560 / Math.max(w, h));
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3; // fal 限制宽高比 1:3~3:1
  w = Math.max(256, Math.floor((w * k) / 16) * 16);
  h = Math.max(256, Math.floor((h * k) / 16) * 16);
  return { width: w, height: h };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function falFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Key ${key()}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = json?.detail ? (typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail).slice(0, 300)) : text.slice(0, 300);
    const e = new Error(`fal ${res.status}: ${msg}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// 真实账单：GET https://api.fal.ai/v1/models/billing-events?request_id=...（可能有延迟，取不到则返回 null）
export async function fetchBilledCost(requestId) {
  try {
    const j = await falFetch(`https://api.fal.ai/v1/models/billing-events?request_id=${encodeURIComponent(requestId)}`, { method: 'GET' });
    const ev = (j?.billing_events || []).filter((e) => e.request_id === requestId);
    if (!ev.length) return null;
    return ev.reduce((a, e) => a + Number(e.cost_total ?? e.cost_subtotal ?? 0), 0);
  } catch (e) {
    return { error: e.message, status: e.status };
  }
}

export default {
  id: 'fal',
  type: 'fal',
  capabilities: () => ({ ops: ['img2img', 'inpaint'], maxSize: 3840, pricing: '按 token（fal 代收）：1024² medium 约 $0.021/张，high 约 $0.061/张' }),
  keyEnv: 'FAL_KEY',
  keyPresent: () => Boolean(key()),
  models: FAL_MODELS,
  async generate({ prompt, image, mask, size, config = {} }) {
    if (!key()) throw new Error('未配置 FAL_KEY 环境变量，无法调用 fal（Set FAL_KEY to use the fal channel）。');
    const model = config.model || FAL_MODELS[0];
    const quality = config.quality || 'medium';
    const image_size = falSize(size);
    const input = { prompt, image_urls: [`data:image/png;base64,${image.toString('base64')}`], image_size, quality, num_images: 1, output_format: 'png' };
    if (mask) input.mask_url = `data:image/png;base64,${mask.toString('base64')}`;
    const deadline = Date.now() + (config.timeoutSec || 300) * 1000;
    const sub = await falFetch(`https://queue.fal.run/${model}`, { method: 'POST', body: JSON.stringify(input) });
    const rid = sub.request_id;
    const statusUrl = sub.status_url || `https://queue.fal.run/${model}/requests/${rid}/status`;
    const respUrl = sub.response_url || `https://queue.fal.run/${model}/requests/${rid}`;
    let st;
    for (let i = 0; ; i++) {
      if (Date.now() > deadline) throw new Error(`fal 超时（request ${rid}）`);
      await sleep(i < 5 ? 1500 : 3000);
      st = await falFetch(statusUrl, { method: 'GET' });
      if (st.status === 'COMPLETED') break;
      if (st.status && !['IN_QUEUE', 'IN_PROGRESS'].includes(st.status)) throw new Error(`fal 状态异常：${st.status}`);
    }
    const out = await falFetch(respUrl, { method: 'GET' });
    const img = out?.images?.[0];
    if (!img?.url) throw new Error(`fal 返回中没有图片（request ${rid}）`);
    let buffer;
    if (img.url.startsWith('data:')) buffer = Buffer.from(img.url.split(',')[1], 'base64');
    else {
      const r = await fetch(img.url);
      if (!r.ok) throw new Error(`下载 fal 结果失败 ${r.status}`);
      buffer = Buffer.from(await r.arrayBuffer());
    }
    const cost = estimateCost(image_size.width, image_size.height, quality, mask ? 2 : 1, prompt.length); // 遮罩按一张输入图计
    return {
      buffer,
      model,
      usage: null,
      cost,
      costEstimated: true,
      requestId: rid,
      inferenceMs: st?.metrics?.inference_time ? Math.round(st.metrics.inference_time * 1000) : null,
      raw: { size: `${image_size.width}x${image_size.height}`, quality, width: img.width, height: img.height },
    };
  },
};
