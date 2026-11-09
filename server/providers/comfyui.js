// Local ComfyUI adapter. Paste a workflow exported with "Save (API Format)" and tell the adapter which node inputs
// receive the prompt, the reference image and the seed:
//   baseUrl      e.g. http://127.0.0.1:8188
//   workflowJson the API-format workflow JSON
//   promptNode   "<nodeId>.<input>", e.g. "6.text"      (CLIPTextEncode)
//   imageNode    "<nodeId>.<input>", e.g. "10.image"    (LoadImage) — optional for txt2img workflows
//   maskNode     "<nodeId>.<input>", optional (LoadImage used as mask; white = editable, black = keep)
//   seedNode     "<nodeId>.<input>", e.g. "3.seed"      (KSampler) — optional
//   outputNode   node id whose images are returned (optional; default: first node with images)
//   timeoutSec   default 600
// Flow: POST /upload/image (reference + mask) → POST /prompt → poll GET /history/<id> → GET /view.
import { fetchJson, sleep } from './util.js';

export function parseTarget(s) {
  if (!s) return null;
  const m = /^\s*([^.\s]+)\.(\w+)\s*$/.exec(String(s));
  if (!m) throw new Error(`节点字段格式应为 "节点ID.字段"（got "${s}"）`);
  return { node: m[1], input: m[2] };
}

export function applyInputs(workflow, assignments) {
  const wf = JSON.parse(JSON.stringify(workflow));
  for (const [target, value] of assignments) {
    if (!target || value == null) continue;
    const node = wf[target.node];
    if (!node) throw new Error(`工作流里没有节点 ${target.node}`);
    node.inputs = { ...(node.inputs || {}), [target.input]: value };
  }
  return wf;
}

export function pickOutputImage(historyEntry, outputNode) {
  const outs = historyEntry?.outputs || {};
  const ids = outputNode ? [String(outputNode)] : Object.keys(outs);
  for (const id of ids) {
    const img = outs[id]?.images?.find((i) => i.type !== 'temp') || outs[id]?.images?.[0];
    if (img) return img;
  }
  return null;
}

async function uploadImage(base, buf, name) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), name);
  fd.append('overwrite', 'true');
  const r = await fetchJson(`${base}/upload/image`, { method: 'POST', body: fd }, 60);
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
}

export default {
  id: 'comfyui',
  type: 'comfyui',
  capabilities: () => ({ ops: ['txt2img', 'img2img', 'inpaint', 'relight'], pricing: '本地 GPU（按电费/折旧自填）' }),
  configFields: ['baseUrl', 'workflowJson', 'promptNode', 'imageNode', 'maskNode', 'seedNode', 'outputNode', 'timeoutSec'],
  keyEnv: null,
  async generate({ prompt, image, mask, seed, config = {} }) {
    const base = String(config.baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
    if (!config.workflowJson) throw new Error('请先在设置里粘贴 ComfyUI 工作流（API 格式）');
    let wf;
    try {
      wf = typeof config.workflowJson === 'string' ? JSON.parse(config.workflowJson) : config.workflowJson;
    } catch (e) {
      throw new Error('工作流 JSON 解析失败：' + e.message);
    }
    const promptT = parseTarget(config.promptNode);
    if (!promptT) throw new Error('请填写提示词节点（如 6.text）');
    const tag = `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const imgName = image && config.imageNode ? await uploadImage(base, image, `${tag}.png`) : null;
    const maskName = mask && config.maskNode ? await uploadImage(base, mask, `${tag}_mask.png`) : null;
    const s = seed ?? Math.floor(Math.random() * 2 ** 31);
    const graph = applyInputs(wf, [
      [promptT, prompt],
      [parseTarget(config.imageNode), imgName],
      [parseTarget(config.maskNode), maskName],
      [parseTarget(config.seedNode), s],
    ]);
    const sub = await fetchJson(
      `${base}/prompt`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: tag }) },
      60,
    );
    if (!sub?.prompt_id) throw new Error('ComfyUI 未返回 prompt_id：' + JSON.stringify(sub?.node_errors || sub).slice(0, 300));
    const deadline = Date.now() + (Number(config.timeoutSec) || 600) * 1000;
    let entry;
    for (let i = 0; ; i++) {
      if (Date.now() > deadline) throw new Error(`ComfyUI 超时（prompt ${sub.prompt_id}）`);
      await sleep(i < 5 ? 500 : 1500);
      const h = await fetchJson(`${base}/history/${encodeURIComponent(sub.prompt_id)}`, {}, 30);
      entry = h?.[sub.prompt_id];
      if (entry?.status?.status_str === 'error') throw new Error('ComfyUI 执行出错：' + JSON.stringify(entry.status.messages || '').slice(0, 300));
      if (entry && (entry.status?.completed || Object.keys(entry.outputs || {}).length)) break;
    }
    const img = pickOutputImage(entry, config.outputNode);
    if (!img) throw new Error('ComfyUI 工作流没有输出图片（检查 SaveImage/PreviewImage 节点）');
    const qs = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' });
    const r = await fetch(`${base}/view?${qs}`);
    if (!r.ok) throw new Error(`ComfyUI 取图失败 HTTP ${r.status}`);
    return { buffer: Buffer.from(await r.arrayBuffer()), model: 'comfyui-workflow', seed: s, usage: null, cost: 0, requestId: sub.prompt_id };
  },
};
