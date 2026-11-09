// Model adapter registry. Adapter contract (see docs/ADAPTERS.md):
//   { id, type, capabilities(), keyEnv?, keyPresent?(), models?, configFields?, external?,
//     generate({ prompt, image, mask, size, seed, config }) → { buffer, model, cost, usage?, costEstimated?, requestId? } }
import mock from './mock.js';
import openai, { OPENAI_MODELS } from './openai.js';
import http from './http.js';
import comfyui from './comfyui.js';
import fal, { FAL_MODELS } from './fal.js';
import grok from './grok.js';
import { q, q1, run, J } from '../db.js';
import { config } from '../config.js';

export const ADAPTERS = { mock, grok, openai, fal, http, comfyui };
export { OPENAI_MODELS, FAL_MODELS };

const SEEDS = [
  ['grok', 'grok', 'Grok 生图（外部导入）', 1, { aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'] }],
  ['mock', 'mock', '模拟（本地程序出图，免费）', 1, {}],
  ['openai', 'openai', 'OpenAI GPT Image（直连）', 0, { model: 'gpt-image-2.5-sunburst', quality: 'medium', timeoutSec: 180 }],
  ['fal', 'fal', 'GPT Image 2.5 (fal.ai)', 0, { model: 'openai/gpt-image-2.5/sunburst/edit', quality: 'medium', timeoutSec: 300 }],
  [
    'http',
    'http',
    '通用 HTTP API',
    0,
    {
      endpoint: '',
      method: 'POST',
      keyEnv: 'WB_HTTP_API_KEY',
      authHeader: 'Authorization: Bearer {{key}}',
      bodyTemplate: '{"prompt":"{{prompt}}","image":"{{image_data_url}}","size":"{{size}}"}',
      resultPath: 'data[0].b64_json',
      pricePerImage: 0,
      timeoutSec: 180,
    },
  ],
  [
    'comfyui',
    'comfyui',
    '本地 ComfyUI',
    0,
    { baseUrl: 'http://127.0.0.1:8188', workflowJson: '', promptNode: '', imageNode: '', maskNode: '', seedNode: '', outputNode: '', timeoutSec: 600 },
  ],
];
// Config keys that must never come from the web UI (keys/secrets live only in env vars; base URLs that receive a key too).
const FORBIDDEN_CONFIG = { openai: ['baseUrl'] };
const SECRET_KEY_RE = /(api[-_]?key|secret|token|password)$/i;

export function seedProviders() {
  for (const [id, type, name, en, cfg] of SEEDS)
    run('INSERT OR IGNORE INTO providers(id,type,name,enabled,config) VALUES(?,?,?,?,?)', id, type, name, en, JSON.stringify(cfg));
  // Fill in config fields added in newer versions without touching values an admin already set.
  for (const [id, , , , cfg] of SEEDS) {
    const row = q1('SELECT config FROM providers WHERE id=?', id);
    const cur = J(row?.config, {});
    for (const k of FORBIDDEN_CONFIG[id] || []) delete cur[k];
    run('UPDATE providers SET config=? WHERE id=?', JSON.stringify({ ...cfg, ...cur }), id);
  }
}

export function defaultProvider() {
  // Fresh installs default to the free mock channel; set WB_DEFAULT_PROVIDER (e.g. grok, openai, comfyui) to change it.
  const want = config.defaultProvider || 'mock';
  if (q1('SELECT enabled FROM providers WHERE id=?', want)?.enabled) return want;
  return 'mock';
}

export function listProviders() {
  return q(
    "SELECT * FROM providers ORDER BY CASE id WHEN 'grok' THEN 0 WHEN 'mock' THEN 1 WHEN 'openai' THEN 2 WHEN 'fal' THEN 3 WHEN 'http' THEN 4 WHEN 'comfyui' THEN 5 ELSE 6 END, rowid",
  ).map((p) => {
    const a = ADAPTERS[p.type];
    return {
      ...p,
      enabled: !!p.enabled,
      config: J(p.config, {}),
      capabilities: a.capabilities(),
      external: !!a.external,
      keyEnv: a.keyEnv || null,
      keyStatus: a.keyEnv ? (a.keyPresent() ? `已检测到 ${a.keyEnv}` : `未设置 ${a.keyEnv}`) : null,
      keyPresent: a.keyEnv ? a.keyPresent() : null,
      models: a.models || null,
    };
  });
}

export function updateProvider(id, b) {
  const p = q1('SELECT * FROM providers WHERE id=?', id);
  if (!p) throw new Error('通道不存在');
  const a = ADAPTERS[p.type];
  if (b.config) {
    if (typeof b.config !== 'object' || Array.isArray(b.config)) throw new Error('config 应为对象');
    const bad = Object.keys(b.config).find((k) => SECRET_KEY_RE.test(k) || (FORBIDDEN_CONFIG[p.id] || []).includes(k));
    if (bad) throw new Error(`「${bad}」不能通过网页设置：API key 和接收密钥的地址只能在服务器环境变量中配置`);
    const ah = b.config.authHeader;
    if (ah && !/\{\{key\}\}/.test(ah) && /\S{12,}/.test(ah.slice(ah.indexOf(':') + 1)))
      throw new Error('鉴权头里不要直接写密钥：请写 {{key}}，并在 keyEnv 填写保存密钥的环境变量名（WB_HTTP_…）');
    run('UPDATE providers SET config=? WHERE id=?', JSON.stringify({ ...J(p.config, {}), ...b.config }), p.id);
  }
  if ('enabled' in b && b.enabled && a.keyEnv && !a.keyPresent()) throw new Error(`启用前请先在服务器设置环境变量 ${a.keyEnv} 并重启（Set ${a.keyEnv} first）`);
  if ('enabled' in b) run('UPDATE providers SET enabled=? WHERE id=?', b.enabled ? 1 : 0, p.id);
  if (typeof b.name === 'string' && b.name.trim()) run('UPDATE providers SET name=? WHERE id=?', b.name.trim().slice(0, 80), p.id);
}

export function getProvider(id) {
  const p = q1('SELECT * FROM providers WHERE id=?', id);
  if (!p) throw new Error(`未知模型通道：${id}`);
  if (!p.enabled) throw new Error(`模型通道「${p.name}」未启用，请到设置页启用，或切换到其他通道`);
  return { row: { ...p, config: J(p.config, {}) }, adapter: ADAPTERS[p.type] };
}
