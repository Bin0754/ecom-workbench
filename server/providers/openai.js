// OpenAI GPT Image 适配器（默认 gpt-image-2.5-sunburst）。
// 接口：POST https://api.openai.com/v1/images/edits，JSON 请求体，images: [{ image_url: dataURL }]
// The key is read only from OPENAI_API_KEY at call time; never stored, logged or returned. baseUrl is configurable,
// so any OpenAI-compatible images endpoint (Azure/OpenRouter-style proxies, local servers) also works.
const PRICE = { textIn: 5, imageIn: 8, imageOut: 30 }; // 美元 / 百万 token（GPT Image 2 / 2.5 同价）

export const OPENAI_MODELS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'];

export function validSize(size) {
  // 宽高须为 16 的倍数，比例 1:3~3:1；超出 2560x1440 为实验性，这里限制最长边 2048
  let [w, h] = size.split('x').map(Number);
  const k = Math.min(1, 2048 / Math.max(w, h));
  w = Math.max(16, Math.round((w * k) / 16) * 16);
  h = Math.max(16, Math.round((h * k) / 16) * 16);
  return `${w}x${h}`;
}

export default {
  id: 'openai',
  type: 'openai',
  capabilities: () => ({ ops: ['txt2img', 'img2img', 'inpaint'], maxSize: 3840, pricing: '按 token：图像输出 $30/百万' }),
  keyEnv: 'OPENAI_API_KEY',
  keyPresent: () => Boolean(process.env.OPENAI_API_KEY),
  models: OPENAI_MODELS,
  async generate({ prompt, image, size, config = {} }) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('未配置环境变量 OPENAI_API_KEY，无法调用 OpenAI。请管理员在服务器上设置后重启。');
    const model = config.model || 'gpt-image-2.5-sunburst';
    // The base URL comes from the server env, not from the web UI, so nobody with UI access can redirect the key elsewhere.
    const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const body = { model, prompt, size: validSize(size), quality: config.quality || 'medium', output_format: 'png', n: 1 };
    let endpoint = '/images/generations';
    if (image) {
      endpoint = '/images/edits';
      body.images = [{ image_url: `data:image/png;base64,${image.toString('base64')}` }];
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), (config.timeoutSec || 180) * 1000);
    let res;
    try {
      res = await fetch(base + endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(t);
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message || res.statusText}`);
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI 返回中没有图片数据');
    const u = json.usage || {};
    const textIn = u.input_tokens_details?.text_tokens ?? 0;
    const imgIn = u.input_tokens_details?.image_tokens ?? Math.max(0, (u.input_tokens || 0) - textIn);
    const out = u.output_tokens || 0;
    const cost = (textIn * PRICE.textIn + imgIn * PRICE.imageIn + out * PRICE.imageOut) / 1e6;
    return {
      buffer: Buffer.from(b64, 'base64'),
      model,
      usage: { input_tokens: u.input_tokens || 0, output_tokens: out },
      cost,
      raw: { size: json.size, quality: json.quality },
    };
  },
};
