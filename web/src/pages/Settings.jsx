import { useEffect, useState } from 'react';
import { Cpu, FileText, ShieldAlert, Receipt, KeyRound, Globe, Server, FlaskConical, Sparkles, Save, DollarSign, Activity, Download } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Button, PageHeader, SkeletonList, PromptEditor } from '../ui.jsx';

const FIELD_LABEL = {
  model: '模型',
  quality: '默认质量',
  baseUrl: '接口地址',
  timeoutSec: '超时（秒）',
  endpoint: '请求地址',
  method: '请求方法',
  keyEnv: '密钥环境变量名（WB_HTTP_…）',
  authHeader: '鉴权头模板（用 {{key}}）',
  bodyTemplate: '请求体模板（JSON）',
  resultPath: '结果字段路径',
  pricePerImage: '单张价格（美元）',
  workflowJson: '工作流 JSON（API 格式）',
  promptNode: '提示词节点.字段',
  imageNode: '输入图节点.字段',
  maskNode: '遮罩节点.字段（可选）',
  seedNode: '种子节点.字段',
  outputNode: '输出节点 ID（可选）',
  aspectRatios: '支持画幅',
};
const PICON = { mock: FlaskConical, openai: Sparkles, http: Globe, comfyui: Server };

function ProviderCard({ p, reload }) {
  const { notify, meta } = useApp();
  const [cfg, setCfg] = useState(p.config);
  const save = async (patch) => {
    try {
      await api('/api/providers/' + p.id, { method: 'PUT', body: patch });
      notify('已保存');
      reload();
    } catch (e) {
      notify(e.message, true);
    }
  };
  const I = PICON[p.type] || Cpu;
  return (
    <div className="card set-card">
      <div className="set-card-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="ico">
            <I size={18} />
          </span>
          <div>
            <div className="row wrap" style={{ gap: 8 }}>
              <h3>{p.name}</h3>
              {meta.defaultProvider === p.id && <Badge tone="accent">默认</Badge>}
              {p.enabled ? (
                <Badge tone="success" dot>
                  已启用
                </Badge>
              ) : (
                <Badge dot>未启用</Badge>
              )}
            </div>
            <div className="xs muted" style={{ marginTop: 2 }}>
              能力 {p.capabilities.ops.join(' · ')} ｜ {p.capabilities.pricing}
            </div>
          </div>
        </div>
        {p.external && (
          <div className="xs muted" style={{ marginTop: 6 }}>
            服务器不调用外部模型、不读任何密钥：生成时把完整提示词 + 参考构图写入待出图队列，用
            Grok（或任意生图工具）出背景后在画布节点里导入，再自动合成（商品原图贴回、对位、阴影、文字、预检）。
          </div>
        )}
        {
          <label className="switch">
            <input type="checkbox" checked={p.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
            <span className="track" />
          </label>
        }
      </div>
      {(p.keyStatus || Object.keys(cfg).length > 0) && (
        <div className="set-card-body">
          {p.keyStatus && (
            <div className={'callout ' + (p.keyPresent ? 't-success' : 't-warning')} style={{ marginBottom: 16 }}>
              <KeyRound size={15} />
              <div>
                <b>{p.keyStatus}</b>
                <div className="xs" style={{ opacity: 0.85 }}>
                  密钥只从服务器环境变量 <code>{p.keyEnv}</code> 读取，网页不保存、不显示；未设置时不能启用。
                </div>
              </div>
            </div>
          )}
          <div className="grid-2">
            {Object.keys(cfg).map((k) => (
              <label key={k} className="field" style={/Json|Template/.test(k) ? { gridColumn: '1 / -1' } : undefined}>
                <span className="label">{FIELD_LABEL[k] || k}</span>
                {k === 'model' && p.models ? (
                  <select value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}>
                    {p.models.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                ) : k === 'quality' ? (
                  <select value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}>
                    {['low', 'medium', 'high', 'auto'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                ) : Array.isArray(cfg[k]) ? (
                  <input value={cfg[k].join(', ')} readOnly />
                ) : /Json|Template/.test(k) ? (
                  <textarea rows={3} className="mono" value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
                ) : (
                  <input value={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })} />
                )}
              </label>
            ))}
          </div>
        </div>
      )}
      {Object.keys(cfg).length > 0 && (
        <div className="set-card-foot">
          <Button size="sm" icon={Save} onClick={() => save({ config: cfg })}>
            保存配置
          </Button>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  const { meta, notify } = useApp();
  const [providers, setProviders] = useState(null);
  const [costs, setCosts] = useState(null);
  const [tab, setTab] = useState('providers');
  const [tpls, setTpls] = useState(meta.templates);
  const load = () => {
    api('/api/providers').then(setProviders);
    api('/api/costs').then(setCosts);
  };
  useEffect(load, []);
  const saveTpl = async (t) => {
    try {
      await api('/api/templates/' + t.id, { method: 'PUT', body: { prompt: t.prompt } });
      notify('模板提示词已保存（新生成生效）');
    } catch (e) {
      notify(e.message, true);
    }
  };
  const total = costs?.byProvider.reduce((a, r) => a + (r.usd || 0), 0) || 0;
  const TABS = [
    ['providers', '模型通道', Cpu],
    ['templates', '模板', FileText],
    ['rules', '合规规则', ShieldAlert],
    ['costs', '成本流水', Receipt],
  ];
  const BG = { white: ['纯白合成', 'neutral'], solid: ['排版', 'info'], generate: ['模型出背景 + 原图贴回', 'accent'] };
  return (
    <div className="fade-in">
      <PageHeader eyebrow="管理员" title="设置" desc="管理生图通道、模板提示词、宣称合规规则，并查看每次调用的成本。" />
      <div className="settings">
        <div className="seg set-nav">
          {TABS.map(([k, l, I]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              <I size={15} />
              {l}
            </button>
          ))}
        </div>
        <div className="stack-16">
          {tab === 'providers' &&
            (providers ? (
              <>
                <div className="callout t-info">
                  <Cpu size={15} />
                  <span>
                    画布里每个模板节点都可以单独切换通道。新建节点的默认通道可用环境变量 WB_DEFAULT_PROVIDER 指定。API
                    密钥只从服务器环境变量读取，网页里不能填写。白底主图、尺寸图等不调用模型。
                  </span>
                </div>
                {providers.map((p) => (
                  <ProviderCard key={p.id} p={p} reload={load} />
                ))}
              </>
            ) : (
              <SkeletonList n={3} h={140} />
            ))}
          {tab === 'templates' &&
            tpls.map((t, i) => (
              <div className="card set-card" key={t.id}>
                <div className="set-card-head">
                  <div>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {t.id}
                      </span>
                      <h3>{t.name}</h3>
                    </div>
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      <Badge>
                        {t.width}×{t.height}
                      </Badge>
                      <Badge tone={BG[t.spec.bg][1]}>{BG[t.spec.bg][0]}</Badge>
                      {t.spec.layout && t.spec.layout !== 'none' && <Badge tone="info">排版：{t.spec.layout}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="set-card-body">
                  {t.spec.bg === 'generate' ? (
                    <>
                      <PromptEditor
                        value={t.prompt}
                        onChange={(v) => setTpls(tpls.map((x, k) => (k === i ? { ...x, prompt: v } : x)))}
                        hint="硬约束段由系统自动追加"
                      />
                      <div className="row end">
                        <Button size="sm" icon={Save} onClick={() => saveTpl(t)}>
                          保存
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="sm muted">此模板不调用生图模型，商品像素原样保留。</div>
                  )}
                </div>
              </div>
            ))}
          {tab === 'rules' && (
            <>
              <div className="callout t-warning">
                <ShieldAlert size={15} />
                <span>
                  FDA 区分化妆品与药品：宣称治疗、治愈、预防疾病，或影响身体结构/功能（如促进胶原），可能被认定为药品宣称；亚马逊图片与 A+
                  还禁止价格、促销、保修等信息。命中「高」的图在预检中标红，仅作提示，以人工和法务判断为准。
                </span>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>等级</th>
                        <th>风险</th>
                        <th>建议改法</th>
                        <th>匹配规则</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meta.rules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Badge tone={{ high: 'danger', medium: 'warning', low: 'neutral' }[r.level]}>
                              {{ high: '高', medium: '中', low: '低' }[r.level]}
                            </Badge>
                          </td>
                          <td style={{ minWidth: 180 }}>{r.msg}</td>
                          <td style={{ minWidth: 160 }} className="text-2">
                            {r.fix}
                          </td>
                          <td>
                            <code>{r.re.length > 60 ? r.re.slice(0, 60) + '…' : r.re}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {tab === 'costs' &&
            (costs ? (
              <>
                <div className="kpis">
                  <div className="card stat">
                    <div className="k">
                      <DollarSign size={14} />
                      累计费用
                    </div>
                    <div className="v">${total.toFixed(4)}</div>
                  </div>
                  <div className="card stat">
                    <div className="k">
                      <Activity size={14} />
                      调用次数
                    </div>
                    <div className="v">{costs.byProvider.reduce((a, r) => a + r.calls, 0)}</div>
                  </div>
                  <div className="card stat">
                    <div className="k">
                      <Download size={14} />
                      下载次数
                    </div>
                    <div className="v">{costs.downloads.length}</div>
                  </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="set-card-head">
                    <h3>按通道</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>通道</th>
                          <th>模型</th>
                          <th className="num">调用</th>
                          <th className="num">成功</th>
                          <th className="num">费用 $</th>
                          <th className="num">平均耗时</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costs.byProvider.map((r, i) => (
                          <tr key={i}>
                            <td>{r.provider_id}</td>
                            <td className="mono">{r.model}</td>
                            <td className="num">{r.calls}</td>
                            <td className="num">{r.ok_calls}</td>
                            <td className="num">{r.usd}</td>
                            <td className="num">{r.avg_ms} ms</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="set-card-head">
                    <h3>按款号</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>款号</th>
                          <th className="num">调用</th>
                          <th className="num">费用 $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costs.byProduct.map((r, i) => (
                          <tr key={i}>
                            <td className="mono">{r.sku}</td>
                            <td className="num">{r.calls}</td>
                            <td className="num">{r.usd}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="set-card-head">
                    <h3>最近调用</h3>
                    <span className="xs muted">最多 300 条</span>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>款号</th>
                          <th>通道 / 模型</th>
                          <th>操作</th>
                          <th className="num">tokens 入/出</th>
                          <th className="num">$</th>
                          <th className="num">耗时</th>
                          <th>结果</th>
                          <th>操作人</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costs.rows.slice(0, 60).map((r) => (
                          <tr key={r.id}>
                            <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                              {r.created_at.slice(5, 16)}
                            </td>
                            <td className="mono">{r.sku}</td>
                            <td>
                              {r.provider_id} / <span className="mono">{r.model}</span>
                            </td>
                            <td>{r.op}</td>
                            <td className="num">
                              {r.input_tokens ?? '–'} / {r.output_tokens ?? '–'}
                            </td>
                            <td className="num">
                              {r.amount_usd}
                              {r.estimated ? <span className="xs muted"> 估</span> : null}
                            </td>
                            <td className="num">{r.duration_ms} ms</td>
                            <td>{r.ok ? <Badge tone="success">成功</Badge> : <Badge tone="danger">失败</Badge>}</td>
                            <td>{r.operator}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <SkeletonList n={3} h={120} />
            ))}
        </div>
      </div>
    </div>
  );
}
