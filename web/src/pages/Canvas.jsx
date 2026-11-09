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
import { t, tx } from '../i18n.js';
import { Badge, Button, Empty, Precheck, PrecheckBadge, StatusBadge, STATUS, PRODUCT_TONE, PromptEditor, PromptPreview } from '../ui.jsx';

const KIND = {
  white: { I: Square, cls: 'k-white', label: t('cv.kind.white') },
  solid: { I: LayoutTemplate, cls: 'k-layout', label: t('cv.kind.solid') },
  generate: { I: Sparkles, cls: 'k-gen', label: t('cv.kind.gen') },
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
        {t('cv.src.uses', { n: data.uses })}
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
          <b>{tx(n.tname)}</b>
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
              {prov?.id === 'grok' ? t('prov.grok') : prov?.id === 'mock' ? t('lib.mock') : tx(prov?.name) || n.provider_id}
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
        <span className="xs muted">{t('cv.versions', { n: data.count })}</span>
      </div>
      {o?.status === 'rejected' && <div className="err">{t('cv.rejectedFor', { list: (o.reviews[0]?.reasons || []).map(tx).join(t('common.listSep')) })}</div>}
      {o?.status === 'failed' && <div className="err">{tx(o.error)}</div>}
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
      notify(t('cv.imported'));
      reload();
    } catch (err) {
      notify(err.message, true);
    }
    setBusy(false);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(o.prompt || '');
      notify(t('cv.copied'));
    } catch {
      notify(t('cv.copyFail'), true);
    }
  };
  return (
    <div className="callout t-info" style={{ marginBottom: 12, display: 'block' }}>
      <div className="sm" style={{ marginBottom: 8 }}>
        <b>{t('cv.await.title')}</b>
        {t('cv.await.desc')}
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn s-sm v-secondary" href={`/api/grok/jobs/${o.id}/ref.png`} target="_blank" rel="noreferrer" download={`ref_${o.id}.png`}>
          <ImageIcon size={14} />
          {t('cv.await.ref')}
        </a>
        <Button size="sm" icon={Copy} onClick={copy}>
          {t('cv.await.copy')}
        </Button>
        <label className="btn s-sm v-primary" style={{ cursor: 'pointer' }}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {t('cv.await.import')}
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
        notify(t('cv.genStarted'));
        setTab('versions');
      } else notify(t('set.saved'));
      reload();
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  };
  const submit = async () => {
    try {
      await api(`/api/outputs/${o.id}/submit`, { method: 'POST' });
      notify(t('cv.submitted'));
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
          <h3>{tx(n.tname)}</h3>
          <div className="xs muted mono">
            {n.template_id} · {n.width}×{n.height} · {t('cv.slot', { slot: n.slot })}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t('ui.close')}>
          <X size={17} />
        </button>
      </div>
      <div className="insp-tabs">
        <div className="seg block">
          <button className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>
            <Wand2 size={14} />
            {t('cv.tab.edit')}
          </button>
          <button className={tab === 'versions' ? 'on' : ''} onClick={() => setTab('versions')}>
            <History size={14} />
            {t('cv.tab.versions', { n: n.outputs.length })}
          </button>
          <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>
            <ShieldCheck size={14} />
            {t('cv.tab.check')}
          </button>
        </div>
      </div>
      <div className="insp-body">
        {tab === 'edit' && (
          <>
            <label className="field">
              <span className="label">{t('rv.view.src')}</span>
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
                    {t('cv.model')}
                    <em>{t('cv.model.hint')}</em>
                  </span>
                  <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.enabled}>
                        {tx(p.name)}
                        {!p.enabled ? t('cv.notEnabled') : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <PromptEditor value={prompt} onChange={setPrompt} hint={n.prompt ? t('cv.prompt.custom') : t('cv.prompt.tpl')} />
                <PromptPreview text={n.resolvedPrompt} />
                <div className="grid-2">
                  {P('palette', t('cv.p.palette'), t('cv.p.palette.ph'))}
                  {P('scene', t('cv.p.scene'), 'marble vanity counter')}
                  {P('texture', t('cv.p.texture'), t('cv.p.texture.ph'))}
                  {P('mood', t('cv.p.mood'), t('cv.p.mood.ph'))}
                  <label className="field">
                    <span className="label">{t('cv.p.quality')}</span>
                    <select value={params.quality || ''} onChange={(e) => setParams({ ...params, quality: e.target.value || undefined })}>
                      <option value="">{t('cv.p.quality.auto')}</option>
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
                <span>{n.spec.bg === 'white' ? t('cv.white.info') : t('cv.layout.info')}</span>
              </div>
            )}
            {n.spec.layout && n.spec.layout !== 'none' && (
              <>
                <div className="section-title" style={{ marginTop: 8 }}>
                  {t('cv.copy')}
                </div>
                {P('headline', t('cv.p.headline'), n.texts.headline)}
                {P('sub', t('cv.p.sub'), n.texts.sub)}
                {P('items', t('cv.p.items'), n.texts.items.join('\n'), true)}
              </>
            )}
          </>
        )}
        {tab === 'versions' && (
          <>
            <div className="versions">
              {n.outputs.map((x) => {
                const tone = (STATUS[x.status] || [])[1];
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
                      <i className="vdot" style={{ background: DOT[tone] }} />v{x.version}
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
                  <dt>{t('set.c.channel')}</dt>
                  <dd>
                    {o.provider_id}
                    {o.model ? ` / ${tx(o.model)}` : ''}
                  </dd>
                  <dt>{t('set.c.dur')}</dt>
                  <dd>{o.duration_ms ? t('cv.sec', { s: (o.duration_ms / 1000).toFixed(1) }) : '–'}</dd>
                  <dt>{t('cv.by')}</dt>
                  <dd>{o.created_by}</dd>
                  <dt>{t('set.c.time')}</dt>
                  <dd>{o.created_at}</dd>
                </dl>
                {o.error && (
                  <div className="callout t-danger" style={{ marginBottom: 12 }}>
                    <AlertTriangle size={15} />
                    {tx(o.error)}
                  </div>
                )}
                {o.status === 'awaiting' && <AwaitingImport o={o} reload={reload} notify={notify} />}
                {o.reviews.map((r) => (
                  <div key={r.id} className={'review-log ' + r.result}>
                    <b>{r.result === 'rejected' ? t('rv.reject') : t('rv.approve')}</b>
                    <span>
                      {r.reviewer} · {r.reasons.map(tx).join(t('common.listSep'))} {tx(r.comment)}
                    </span>
                  </div>
                ))}
                {o.prompt && (
                  <details>
                    <summary className="sm muted" style={{ cursor: 'pointer', margin: '8px 0' }}>
                      {t('cv.thisPrompt')}
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
        {tab === 'check' && (o?.precheck ? <Precheck pc={o.precheck} /> : <div className="sm muted">{t('cv.noCheck')}</div>)}
      </div>
      <div className="insp-foot">
        {tab === 'edit' ? (
          <>
            <Button icon={Save} loading={busy} onClick={() => save(false)}>
              {t('common.save')}
            </Button>
            <Button variant="primary" icon={RefreshCw} loading={busy} onClick={() => save(true)}>
              {t('cv.saveRegen')}
            </Button>
          </>
        ) : o?.status === 'draft' ? (
          <Button variant="primary" icon={Send} onClick={submit}>
            {t('cv.submit', { v: o.version })}
          </Button>
        ) : (
          <Button variant="primary" icon={RefreshCw} onClick={() => save(true)}>
            {t('cv.regen')}
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
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
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
          label: tx(meta.angles.find((a) => a.id === s.angle)?.label || s.angle).replace(/（.*）| \(.*\)/, ''),
        },
      }),
    );
    d.nodes.forEach((n, i) => {
      // Default 3-column grid: each cell is a template → result pair; draggable, positions are saved
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
      notify(what === 'submit-all' ? t('cv.submittedN', { n: r.submitted }) : t('cv.startedN', { n: r.started }));
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
            title={t('cv.mobile.title')}
            action={
              <div className="row" style={{ gap: 8 }}>
                <Button onClick={() => go('tasks')}>{t('nav.tasks')}</Button>
                <Button variant="primary" onClick={() => go('library')}>
                  {t('nav.library')}
                </Button>
              </div>
            }
          >
            {t('cv.mobile.desc')}
          </Empty>
        </div>
      </div>
      <div className="cv desktop-only">
        <div className="cv-toolbar">
          <select className="input" value={arg || ''} onChange={(e) => go('canvas/' + e.target.value)}>
            <option value="">{t('cv.pickSku')}</option>
            {(tasks || []).map((tk) => (
              <option key={tk.id} value={tk.id}>
                {tk.sku} · {tk.name_zh || tk.name}
              </option>
            ))}
          </select>
          {d && (
            <>
              <Badge tone={PRODUCT_TONE[d.status.code]} dot>
                {tx(d.status.label)}
              </Badge>
              <span className="div" />
              <span className="cv-stat" title={t('cv.stat.title')}>
                <Layers size={14} />
                <b>{d.nodes.length}</b>
                {t('cv.stat.tpl')}
              </span>
              <span className="cv-stat">
                <i className="vdot" style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--text-3)', display: 'inline-block' }} />
                <b>{cnt('draft')}</b>
                {t('st.draft')}
              </span>
              <span className="cv-stat">
                <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--warning)', display: 'inline-block' }} />
                <b>{cnt('pending')}</b>
                {t('cv.stat.pending')}
              </span>
              <span className="cv-stat">
                <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--success)', display: 'inline-block' }} />
                <b>{cnt('approved')}</b>
                {t('st.approved')}
              </span>
              {cnt('rejected') > 0 && (
                <span className="cv-stat">
                  <i style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--danger)', display: 'inline-block' }} />
                  <b>{cnt('rejected')}</b>
                  {t('st.rejected')}
                </span>
              )}
              <span className="grow" />
              <Button size="sm" variant="ghost" icon={Plus} title={t('cv.ensure.title')} onClick={() => all('ensure')}>
                {t('cv.ensure')}
              </Button>
              <Button size="sm" icon={RefreshCw} onClick={() => confirm(t('cv.regenAll.confirm')) && all('generate-all')}>
                {t('cv.regenAll')}
              </Button>
              <Button size="sm" variant="primary" icon={Send} onClick={() => all('submit-all')}>
                {t('cv.submitAll')}
              </Button>
            </>
          )}
        </div>
        {!arg ? (
          <div className="card">
            <Empty icon={Layers} title={t('cv.pick.title')}>
              {t('cv.pick.desc')}
            </Empty>
          </div>
        ) : !d ? (
          <div className="card">
            <Empty icon={Loader2} title={t('app.loading')} />
          </div>
        ) : !d.nodes.length ? (
          <div className="card">
            <Empty icon={Camera} title={t('cv.nosrc.title')}>
              {t('cv.nosrc.desc')}
            </Empty>
          </div>
        ) : (
          <div className="cv-body">
            <div className="cv-flow">
              <div className="cv-legend">
                <Badge icon={Square}>{t('set.bg.white')}</Badge>
                <Badge icon={LayoutTemplate}>{t('set.bg.solid')}</Badge>
                <Badge icon={Sparkles}>{t('cv.legend.gen')}</Badge>
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
