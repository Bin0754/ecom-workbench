// "Grok image (external import)" channel — a MANUAL / EXTERNAL provider.
// The server never calls a model and reads no key. When a node is generated with this channel, the pipeline writes
// a job to data/grok_jobs/<outputId>.json (full prompt + layout reference image) and the output waits in status
// "awaiting". Any image generator can then fulfil the job — originally Grok Bot's built-in image generation, but a
// person with ChatGPT/Midjourney/etc. works too — by importing the background image:
//   - in the UI: canvas → node inspector → "导入背景图 / Import background"
//   - via API:  POST /api/grok/import/:outputId  (body = image bytes, Content-Type image/png|jpeg)
//   - via CLI:  python3 scripts/grok_jobs.py import <outputId> <image>
// After import the normal compositing runs (product paste-back, alignment, shadow, text overlay, precheck), cost 0.
export const GROK_RATIOS = { '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16 };
export function pickRatio(w, h) {
  const r = w / h;
  let best = '1:1';
  for (const [k, v] of Object.entries(GROK_RATIOS)) if (Math.abs(Math.log(v / r)) < Math.abs(Math.log(GROK_RATIOS[best] / r))) best = k;
  return best;
}
export default {
  id: 'grok',
  type: 'grok',
  external: true,
  keyEnv: null,
  capabilities: () => ({ ops: ['img2img'], maxSize: 2048, pricing: '免费 · 外部生图后导入（Grok Bot 或任意工具）' }),
  async generate() {
    throw new Error('外部导入通道不在服务器端调用模型，请通过「导入背景图」提交结果');
  },
};
