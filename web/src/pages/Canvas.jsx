import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Square,
  Sparkles,
  LayoutTemplate,
  Image as ImageIcon,
  RefreshCw,
  Send,
  Plus,
  Monitor,
  Loader2,
  AlertTriangle,
  Save,
  Wand2,
  X,
  Camera,
  Cpu,
  History,
  ShieldCheck,
  Layers,
  Upload,
  Copy,
} from 'lucide-react';
import { api, uploadRaw } from '../api.js';
import { useApp, go } from '../App.jsx';
import { Badge, Button, Empty, Precheck, PrecheckBadge, StatusBadge, STATUS, PRODUCT_TONE, PromptEditor, PromptPreview } from '../ui.jsx';

const KIND = {
  white: { I: Square, cls: 'k-white', label: '抠图 · 纯白合成' },
  solid: { I: LayoutTemplate, cls: 'k-layout', label: '排版 · 不调模型' },
  generate: { I: Sparkles, cls: 'k-gen', label: '模型背景 · 原图贴回' },
};
const DOT = { success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', neutral: 'var(--text-3)' };

function SourceNode({ data }) {
  return (
    <div className={'node src' + (data.used ? '' : ' dim')}>
      <img src={data.s.thumb} alt="" />
      <div className="cap">
        <b>{data.label}</b>
        <span className="xs muted">
          {data.s.width}×{data.s.height}
        </span>
      </div>
      <div className="xs muted" style={{ padding: '0 4px 2px' }}>
        原片 · {data.uses} 个模板
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function TemplateNode({ data }) {
  const n = data.n;
  const k = KIND[n.spec.bg] || KIND.generate;
  const last = n.outputs[0];
  const prov = data.providers.find((p) => p.id === n.provider_id);
  return (
    <div className={'node tpl' + (data.selected ? ' sel' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="node-head">
        <span className={'ico ' + k.cls}>
          <k.I size={14} strokeWidth={2} />
        </span>
        <div className="tt">
          <b>{n.tname}</b>
          <span className="mono">
            {n.template_id} · {n.width}×{n.height}
          </span>
        </div>
        {last?.status === 'generating' && <Loader2 size={15} className="spin" style={{ color: 'var(--info)' }} />}
      </div>
      <div className="node-body">
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="node-chip">{k.label}</span>
          {n.spec.bg === 'generate' && (
            <span className="node-chip">
              <Cpu size={11} />
              {prov?.id === 'grok' ? 'Grok 生图 · 外部导入' : prov?.id === 'mock' ? '模拟' : prov?.name || n.provider_id}
            </span>
          )}
        </div>
        {n.spec.bg === 'generate' && <div className="node-prompt">{n.resolvedPrompt}</div>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function OutputNode({ data }) {
  const o = data.o;
  return (
    <div className={'node out ' + (o?.status || '') + (data.selected ? ' sel' : '')}>
      <Handle type="target" position={Position.Left} />
      <div className="imgw">
        {o?.thumb ? (
          <img src={o.thumb + '?v=' + o.id} alt="" />
        ) : o?.status === 'generating' ? (
          <Loader2 size={26} className="spin" />
        ) : o?.status === 'awaiting' ? (
          <Sparkles size={26} />
        ) : o?.status === 'failed' ? (
          <AlertTriangle size={26} />
        ) : (
          <ImageIcon size={26} />
        )}
        <span className="st">
          <StatusBadge status={o?.status} />
        </span>
        <span className="vv">
          <Badge className="solid-dark">v{o?.version || 0}</Badge>
        </span>
      </div>
      <div className="foot">
        <PrecheckBadge pc={o?.precheck} />
        <span className="xs muted">{data.count} 个版本</span>
      </div>
      {o?.status === 'rejected' && <div className="err">打回：{o.reviews[0]?.reasons.join('、')}</div>}
      {o?.status === 'failed' && <div className="err">{o.error}</div>}
    </div>
  );
}
const nodeTypes = { srcNode: SourceNode, tplNode: TemplateNode, outNode: OutputNode };

// External-import channel: download the layout reference + prompt, generate the background in any tool, import it here.
function AwaitingImport({ o, reload, notify }) {
  const [busy, setBusy] = useState(false);
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      await uploadRaw(`/api/grok/import/${o.id}`, f);
      notify('已导入，正在合成');
      reload();
    } catch (err) {
      notify(err.message, true);
    }
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(o.prompt || '');
      notify('提示词已复制');
    } catch {
      notify('复制失败，请展开下方提示词手动复制', true);
    }
  };
  return (
    <div className="callout t-info" style={{ marginBottom: 12, display: 'block' }}>
      <div className="sm" style={{ marginBottom: 8 }}>
        <b>等待外部出图</b>：用参考构图图 + 提示词在 Grok（或任意生图工具）里生成背景，再把结果导入，系统会自动贴回商品原图并合成。
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn s-sm v-secondary" href={`/api/grok/jobs/${o.id}/ref.png`} target="_blank" rel="noreferrer" download={`ref_${o.id}.png`}>
          <ImageIcon size={14} />
          参考构图图
        </a>
        <Button size="sm" icon={Copy} onClick={copy}>
          复制提示词
        </Button>
        <label className="btn s-sm v-primary" style={{ cursor: 'pointer' }}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}导入背景图
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} disabled={busy} />
        </label>
      </div>
    </div>
  );
}

function Inspector({ n, d, providers, reload, notify, onClose }) {
  const [tab, setTab] = useState('edit');
  const [prompt, setPrompt] = useState(n.effectivePrompt || '');
  const [provider, setProvider] = useState(n.provider_id);
  const [source, setSource] = useState(n.source_id);
  const [params, setParams] = useState(n.params || {});
  const [ver, setVer] = useState(n.outputs[0]?.id);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPrompt(n.effectivePrompt || '');
    setProvider(n.provider_id);
    setSource(n.source_id);
    setParams(n.params || {});
  }, [n.id]);
  useEffect(() => {
    setVer(n.outputs[0]?.id);
  }, [n.id, n.outputs[0]?.id]);
  const o = n.outputs.find((x) => x.id === ver) || n.outputs[0];
  const gen = n.spec.bg === 'generate';
  const k = KIND[n.spec.bg] || KIND.generate;
  const save = async (regen) => {
    setBusy(true);
    try {
      await api('/api/nodes/' + n.id, { method: 'PUT', body: { prompt, provider_id: provider, source_id: Number(source), params } });
      if (regen) {
        await api(`/api/nodes/${n.id}/generate`, { method: 'POST' });
        notify('已开始生成新版本');
        setTab('versions');
      } else notify('已保存');
      reload();
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  };
  const submit = async () => {
    try {
      await api(`/api/outputs/${o.id}/submit`, { method: 'POST' });
      notify('已提交审核');
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  };
  const P = (key, label, ph, area) => (
    <label className="field">
      <span className="label">{label}</span>
      {area ? (
        <textarea rows={4} value={params[key] ?? ''} placeholder={ph} onChange={(e) => setParams({ ...params, [key]: e.target.value || undefined })} />
      ) : (
        <input value={params[key] ?? ''} placeholder={ph} onChange={(e) => setParams({ ...params, [key]: e.target.value || undefined })} />
      )}
    </label>
  );
  return (
    <aside className="inspector">
      <div className="insp-head">
        <span className={'node-head'} style={{ padding: 0 }}>
          <span className={'ico ' + k.cls}>
            <k.I size={14} />
          </span>
        </span>
        <div className="grow">
          <h3>{n.tname}</h3>
          <div className="xs muted mono">
            {n.template_id} · {n.width}×{n.height} · 亚马逊位置 {n.slot}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <X size={17} />
        </button>
      </div>
      <div className="insp-tabs">
        <div className="seg block">
          <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>
            <Wand2 size={14} />
            编辑
          </button>
          <button className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>
            <History size={14} />
            版本 {n.outputs.length}
          </button>
          <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>
            <ShieldCheck size={14} />
            预检
          </button>
        </div>
      </div>
      <div className="insp-body">
        {tab === 'edit' && (
          <>
            <label className="field">
              <span className="label">原片</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                {d.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.archive_name}
                  </option>
                ))}
              </select>
            </label>
            {gen ? (
              <>
                <label className="field">
                  <span className="label">
                    生图模型<em>仅本节点</em>
                  </span>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.enabled}>
                        {p.name}
                        {!p.enabled ? '（未启用）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <PromptEditor value={prompt} onChange={setPrompt} hint={n.prompt ? '本节点已改写' : '来自模板 v2'} />
                <PromptPreview text={n.resolvedPrompt} />
                <div className="grid-2">
                  {P('palette', '色调', '自动：按成分推导')}
                  {P('scene', '场景', 'marble vanity counter')}
                  {P('texture', '质地', '自动：按品类')}
                  {P('mood', '氛围', '自动：按卖点')}
                  <label className="field">
                    <span className="label">质量</span>
                    <select value={params.quality || ''} onChange={(e) => setParams({ ...params, quality: e.target.value || undefined })}>
                      <option value="">跟随通道</option>
                      {['low', 'medium', 'high'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <div className="callout t-neutral" style={{ marginBottom: 16 }}>
                <Layers size={15} />
                <span>
                  {n.spec.bg === 'white'
                    ? '主图走确定性流程：本地抠图后合成纯白底，商品占 85%，不调用生图模型。'
                    : '此模板只做排版，不调用生图模型，商品像素原样保留。'}
                </span>
              </div>
            )}
            {n.spec.layout && n.spec.layout !== 'none' && (
              <>
                <div className="section-title" style={{ marginTop: 8 }}>
                  画面文案 · 排版引擎叠加
                </div>
                {P('headline', '标题', n.texts.headline)}
                {P('sub', '副标题', n.texts.sub)}
                {P('items', '条目（每行一条）', n.texts.items.join('\n'), true)}
              </>
            )}
          </>
        )}
        {tab === 'versions' && (
          <>
            <div className="versions">
              {n.outputs.map((x) => {
                const t = (STATUS[x.status] || [])[1];
                return (
                  <button key={x.id} className={'ver' + (x.id === o?.id ? ' on' : '')} onClick={() => setVer(x.id)}>
                    <span className="vi">
                      {x.thumb ? (
                        <img src={x.thumb} alt="" />
                      ) : x.status === 'generating' ? (
                        <Loader2 size={18} className="spin" />
                      ) : x.status === 'awaiting' ? (
                        <Sparkles size={18} />
                      ) : (
                        <AlertTriangle size={18} />
                      )}
                    </span>
                    <span>
                      <i className="vdot" style={{ background: DOT[t] }} />v{x.version}
                    </span>
                  </button>
                );
              })}
            </div>
            {o && (
              <>
                {o.url && (
                  <a href={o.url} target="_blank" rel="noreferrer">
                    <img src={o.thumb} alt="" className="big-preview" />
                  </a>
                )}
                <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
                  <StatusBadge status={o.status} />
                  <PrecheckBadge pc={o.precheck} />
                </div>
                <dl className="kv">
                  <dt>通道</dt>
                  <dd>
                    {o.provider_id}
                    {o.model ? ` / ${o.model}` : ''}
                  </dd>
                  <dt>耗时</dt>
                  <dd>{o.duration_ms ? (o.duration_ms / 1000).toFixed(1) + ' 秒' : '–'}</dd>
                  <dt>生成人</dt>
                  <dd>{o.created_by}</dd>
                  <dt>时间</dt>
                  <dd>{o.created_at}</dd>
                </dl>
                {o.error && (
                  <div className="callout t-danger" style={{ marginBottom: 12 }}>
                    <AlertTriangle size={15} />
                    {o.error}
                  </div>
                )}
                {o.status === 'awaiting' && <AwaitingImport o={o} reload={reload} notify={notify} />}
                {o.reviews.map((r) => (
                  <div key={r.id} className={'review-log ' + r.result}>
                    <b>{r.result === 'rejected' ? '打回' : '通过'}</b>
                    <span>
                      {r.reviewer} · {r.reasons.join('、')} {r.comment}
                    </span>
                  </div>
                ))}
                {o.prompt && (
                  <details>
                    <summary className="sm muted" style={{ cursor: 'pointer', margin: '8px 0' }}>
                      这一版的提示词
                    </summary>
                    <div className="preview-box" style={{ margin: 0 }}>
                      {o.prompt}
                    </div>
                  </details>
                )}
              </>
            )}
          </>
        )}
        {tab === 'check' && (o?.precheck ? <Precheck pc={o.precheck} /> : <div className="sm muted">还没有可预检的版本。</div>)}
      </div>
      <div className="insp-foot">
        {tab === 'edit' ? (
          <>
            <Button icon={Save} loading={busy} onClick={() => save(false)}>
              保存
            </Button>
            <Button variant="primary" icon={RefreshCw} loading={busy} onClick={() => save(true)}>
              保存并重新生成
            </Button>
          </>
        ) : o?.status === 'draft' ? (
          <Button variant="primary" icon={Send} onClick={submit}>
            提交 v{o.version} 去审核
          </Button>
        ) : (
          <Button variant="primary" icon={RefreshCw} onClick={() => save(true)}>
            重新生成新版本
          </Button>
        )}
      </div>
    </aside>
  );
}

export default function CanvasPage({ arg }) {
  const { meta, notify } = useApp();
  const [tasks, setTasks] = useState(null);
  const [d, setD] = useState(null);
  const [providers, setProviders] = useState([]);
  const [sel, setSel] = useState(null);
  const [pos, setPos] = useState({});
  const [rfNodes, setRfNodes] = useState([]);
  const load = useCallback(
    () =>
      arg &&
      api('/api/products/' + arg)
        .then(setD)
        .catch((e) => notify(e.message, true)),
    [arg],
  );
  useEffect(() => {
    api('/api/tasks').then(setTasks);
    api('/api/providers').then(setProviders);
    load();
  }, [arg]);
  const generating = d?.nodes.some((n) => n.outputs[0]?.status === 'generating');
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [generating, load]);

  const graph = useMemo(() => {
    if (!d) return { nodes: [], edges: [] };
    const nodes = [],
      edges = [];
    d.sources.forEach((s, i) =>
      nodes.push({
        id: 's' + s.id,
        type: 'srcNode',
        position: { x: 0, y: 40 + i * 300 },
        data: {
          s,
          used: d.nodes.some((n) => n.source_id === s.id),
          uses: d.nodes.filter((n) => n.source_id === s.id).length,
          label: meta.angles.find((a) => a.id === s.angle)?.label.replace(/（.*）/, ''),
        },
      }),
    );
    d.nodes.forEach((n, i) => {
      // 默认 3 列网格：每格是「模板 → 结果」一对；可拖动，位置会保存
      const col = i % 3,
        row = Math.floor(i / 3),
        x = 260 + col * 590,
        y = row * 320;
      nodes.push({ id: 't' + n.id, type: 'tplNode', position: n.pos?.t || { x, y: y + 60 }, data: { n, providers, selected: sel === n.id } });
      nodes.push({
        id: 'o' + n.id,
        type: 'outNode',
        position: n.pos?.o || { x: x + 288, y },
        data: { o: n.outputs[0], count: n.outputs.length, selected: sel === n.id },
      });
      const st = n.outputs[0]?.status;
      edges.push({
        id: `e-s${n.source_id}-t${n.id}`,
        source: 's' + n.source_id,
        target: 't' + n.id,
        type: 'smoothstep',
        style: { stroke: '#DDD6CC', strokeDasharray: '4 4' },
        animated: st === 'generating',
      });
      edges.push({
        id: `e-t${n.id}-o${n.id}`,
        source: 't' + n.id,
        target: 'o' + n.id,
        style: { stroke: st === 'rejected' ? '#E0A3AA' : st === 'approved' ? '#9CCFB2' : '#C9C0B4', strokeWidth: 1.75 },
      });
    });
    return { nodes, edges };
  }, [d, providers, sel, meta]);
  useEffect(() => {
    setRfNodes(graph.nodes.map((x) => (pos[x.id] ? { ...x, position: pos[x.id] } : x)));
  }, [graph]);
  const onNodesChange = (ch) => setRfNodes((ns) => applyNodeChanges(ch, ns));
  const onDragStop = (_, node) => {
    setPos((p) => ({ ...p, [node.id]: node.position }));
    if (node.id[0] !== 's') {
      const n = d.nodes.find((x) => x.id === Number(node.id.slice(1)));
      api('/api/nodes/' + n.id, { method: 'PUT', body: { pos: { ...(n.pos || {}), [node.id[0]]: node.position } } });
    }
  };
  const all = async (what) => {
    try {
      const r = await api(`/api/products/${arg}/${what}`, { method: 'POST' });
      notify(what === 'submit-all' ? `已提交 ${r.submitted} 张草稿去审核` : `已开始生成 ${r.started} 个节点`);
      load();
    } catch (e) {
      notify(e.message, true);
    }
  };
  const selNode = d?.nodes.find((n) => n.id === sel);
  const cnt = (s) => d?.nodes.filter((n) => n.outputs[0]?.status === s).length || 0;
  return (
    <>
      <div className="mobile-only">
        <div className="card" style={{ marginTop: 12 }}>
          <Empty
            icon={Monitor}
            title="画布需要在电脑上使用"
            action={
              <div className="row" style={{ gap: 8 }}>
                <Button onClick={() => go('tasks')}>任务单</Button>
                <Button variant="primary" onClick={() => go('library')}>
                  素材库
                </Button>
              </div>
            }
          >
            无限画布需要较大的屏幕来编辑节点和提示词。手机上可以使用拍摄上传、审核和素材库。
          </Empty>
        </div>
      </div>
      <div className="cv desktop-only">
        <div className="cv-toolbar">
          <select className="input" value={arg || ''} onChange={(e) => go('canvas/' + e.target.value)}>
            <option value="">选择款号…</option>
            {(tasks || []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.sku} · {t.name_zh || t.name}
              </option>
            ))}
          </select>
          {d && (
            <>
              <Badge tone={PRODUCT_TONE[d.status.code]} dot>
                {d.status.label}
              </Badge>
              <span className="div" />
              <span className="cv-stat" title="原片 / 模板">
                <Layers size={14} />
                <b>{d.nodes.length}</b>个模板
              </span>
              <span className="cv-stat">
                <i className="vdot" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--text-3)', display: 'inline-block' }} />
                <b>{cnt('draft')}</b>草稿
              </span>
              <span className="cv-stat">
                <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--warning)', display: 'inline-block' }} />
                <b>{cnt('pending')}</b>待审
              </span>
              <span className="cv-stat">
                <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--success)', display: 'inline-block' }} />
                <b>{cnt('approved')}</b>通过
              </span>
              {cnt('rejected') > 0 && (
                <span className="cv-stat">
                  <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--danger)', display: 'inline-block' }} />
                  <b>{cnt('rejected')}</b>打回
                </span>
              )}
              <span className="grow" />
              <Button size="sm" variant="ghost" icon={Plus} title="按已上传角度补齐缺少的模板节点" onClick={() => all('ensure')}>
                补齐
              </Button>
              <Button size="sm" icon={RefreshCw} onClick={() => confirm('所有节点各生成一个新版本？') && all('generate-all')}>
                全部重新生成
              </Button>
              <Button size="sm" variant="primary" icon={Send} onClick={() => all('submit-all')}>
                提交全部草稿
              </Button>
            </>
          )}
        </div>
        {!arg ? (
          <div className="card">
            <Empty icon={Layers} title="选择一个款号">
              从左上角下拉框选择款号，查看它的出图画布。
            </Empty>
          </div>
        ) : !d ? (
          <div className="card">
            <Empty icon={Loader2} title="加载中…" />
          </div>
        ) : !d.nodes.length ? (
          <div className="card">
            <Empty icon={Camera} title="还没有原片">
              摄影上传原片后，系统会自动铺好画布并开始出图。
            </Empty>
          </div>
        ) : (
          <div className="cv-body">
            <div className="cv-flow">
              <div className="cv-legend">
                <Badge icon={Square}>纯白合成</Badge>
                <Badge icon={LayoutTemplate}>排版</Badge>
                <Badge icon={Sparkles}>模型背景</Badge>
              </div>
              <ReactFlow
                nodes={rfNodes}
                edges={graph.edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onNodeDragStop={onDragStop}
                onNodeClick={(_, node) => node.id[0] !== 's' && setSel(Number(node.id.slice(1)))}
                onPaneClick={() => setSel(null)}
                defaultViewport={{ x: 24, y: 56, zoom: 0.78 }}
                minZoom={0.1}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#D9D2C8" />
                <Controls showInteractive={false} position="bottom-left" />
                <MiniMap
                  pannable
                  zoomable
                  position="bottom-right"
                  nodeColor={(n) => (n.type === 'outNode' ? '#E8D5DA' : n.type === 'srcNode' ? '#D9D2C8' : '#EFEBE6')}
                  nodeStrokeWidth={0}
                  maskColor="rgba(247,245,242,.7)"
                  style={{ width: 160, height: 100 }}
                />
              </ReactFlow>
            </div>
            {selNode && <Inspector n={selNode} d={d} providers={providers} reload={load} notify={notify} onClose={() => setSel(null)} />}
          </div>
        )}
      </div>
    </>
  );
}
