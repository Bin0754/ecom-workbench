import { useEffect, useState } from 'react';
import { Cpu, FileText, ShieldAlert, Receipt, KeyRound, Globe, Server, FlaskConical, Sparkles, Save, DollarSign, Activity, Download } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { t, tx } from '../i18n.js';
import { Badge, Button, PageHeader, SkeletonList, PromptEditor } from '../ui.jsx';

const FIELD_LABEL = {
  model: t('set.f.model'),
  quality: t('set.f.quality'),
  baseUrl: t('set.f.baseUrl'),
  timeoutSec: t('set.f.timeoutSec'),
  endpoint: t('set.f.endpoint'),
  method: t('set.f.method'),
  keyEnv: t('set.f.keyEnv'),
  authHeader: t('set.f.authHeader'),
  bodyTemplate: t('set.f.bodyTemplate'),
  resultPath: t('set.f.resultPath'),
  pricePerImage: t('set.f.pricePerImage'),
  workflowJson: t('set.f.workflowJson'),
  promptNode: t('set.f.promptNode'),
  imageNode: t('set.f.imageNode'),
  maskNode: t('set.f.maskNode'),
  seedNode: t('set.f.seedNode'),
  outputNode: t('set.f.outputNode'),
  aspectRatios: t('set.f.aspectRatios'),
};
const PICON = { mock: FlaskConical, openai: Sparkles, http: Globe, comfyui: Server };

function ProviderCard({ p, reload }) {
  const { notify, meta } = useApp();
  const [cfg, setCfg] = useState(p.config);
  const save = async (patch) => {
    try {
      await api('/api/providers/' + p.id, { method: 'PUT', body: patch });
      notify(t('set.saved'));
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
              <h3>{tx(p.name)}</h3>
              {meta.defaultProvider === p.id && <Badge tone="accent">{t('set.default')}</Badge>}
              {p.enabled ? (
                <Badge tone="success" dot>
                  {t('set.enabled')}
                </Badge>
              ) : (
                <Badge dot>{t('set.disabled')}</Badge>
              )}
            </div>
            <div className="xs muted" style={{ marginTop: 2 }}>
              {t('set.caps', { ops: p.capabilities.ops.join(' · '), pricing: tx(p.capabilities.pricing) })}
            </div>
          </div>
        </div>
        {p.external && (
          <div className="xs muted" style={{ marginTop: 6 }}>
            {t('set.external')}
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
                <b>{tx(p.keyStatus)}</b>
                <div className="xs" style={{ opacity: 0.85 }}>
                  {t('set.key1')} <code>{p.keyEnv}</code>
                  {t('set.key2')}
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
            {t('set.saveCfg')}
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
  const saveTpl = async (tp) => {
    try {
      await api('/api/templates/' + tp.id, { method: 'PUT', body: { prompt: tp.prompt } });
      notify(t('set.tplSaved'));
    } catch (e) {
      notify(e.message, true);
    }
  };
  const total = costs?.byProvider.reduce((a, r) => a + (r.usd || 0), 0) || 0;
  const TABS = [
    ['providers', t('set.tab.providers'), Cpu],
    ['templates', t('set.tab.templates'), FileText],
    ['rules', t('set.tab.rules'), ShieldAlert],
    ['costs', t('set.tab.costs'), Receipt],
  ];
  const BG = { white: [t('set.bg.white'), 'neutral'], solid: [t('set.bg.solid'), 'info'], generate: [t('set.bg.generate'), 'accent'] };
  return (
    <div className="fade-in">
      <PageHeader eyebrow={t('srv.role.admin')} title={t('nav.settings')} desc={t('set.desc')} />
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
                  <span>{t('set.providers.info')}</span>
                </div>
                {providers.map((p) => (
                  <ProviderCard key={p.id} p={p} reload={load} />
                ))}
              </>
            ) : (
              <SkeletonList n={3} h={140} />
            ))}
          {tab === 'templates' &&
            tpls.map((tp, i) => (
              <div className="card set-card" key={tp.id}>
                <div className="set-card-head">
                  <div>
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {tp.id}
                      </span>
                      <h3>{tx(tp.name)}</h3>
                    </div>
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      <Badge>
                        {tp.width}×{tp.height}
                      </Badge>
                      <Badge tone={BG[tp.spec.bg][1]}>{BG[tp.spec.bg][0]}</Badge>
                      {tp.spec.layout && tp.spec.layout !== 'none' && <Badge tone="info">{t('set.layout', { l: tp.spec.layout })}</Badge>}
                    </div>
                  </div>
                </div>
                <div className="set-card-body">
                  {tp.spec.bg === 'generate' ? (
                    <>
                      <PromptEditor
                        value={tp.prompt}
                        onChange={(v) => setTpls(tpls.map((x, k) => (k === i ? { ...x, prompt: v } : x)))}
                        hint={t('set.tpl.hint')}
                      />
                      <div className="row end">
                        <Button size="sm" icon={Save} onClick={() => saveTpl(tp)}>
                          {t('common.save')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="sm muted">{t('set.tpl.noModel')}</div>
                  )}
                </div>
              </div>
            ))}
          {tab === 'rules' && (
            <>
              <div className="callout t-warning">
                <ShieldAlert size={15} />
                <span>{t('set.rules.info')}</span>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>{t('set.r.level')}</th>
                        <th>{t('set.r.risk')}</th>
                        <th>{t('set.r.fix')}</th>
                        <th>{t('set.r.pattern')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {meta.rules.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Badge tone={{ high: 'danger', medium: 'warning', low: 'neutral' }[r.level]}>{t('set.r.' + r.level)}</Badge>
                          </td>
                          <td style={{ minWidth: 180 }}>{tx(r.msg)}</td>
                          <td style={{ minWidth: 160 }} className="text-2">
                            {tx(r.fix)}
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
                      {t('set.c.total')}
                    </div>
                    <div className="v">${total.toFixed(4)}</div>
                  </div>
                  <div className="card stat">
                    <div className="k">
                      <Activity size={14} />
                      {t('set.c.calls')}
                    </div>
                    <div className="v">{costs.byProvider.reduce((a, r) => a + r.calls, 0)}</div>
                  </div>
                  <div className="card stat">
                    <div className="k">
                      <Download size={14} />
                      {t('set.c.downloads')}
                    </div>
                    <div className="v">{costs.downloads.length}</div>
                  </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                  <div className="set-card-head">
                    <h3>{t('set.c.byChannel')}</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>{t('set.c.channel')}</th>
                          <th>{t('set.f.model')}</th>
                          <th className="num">{t('set.c.callsCol')}</th>
                          <th className="num">{t('set.c.ok')}</th>
                          <th className="num">{t('set.c.cost')}</th>
                          <th className="num">{t('set.c.avg')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costs.byProvider.map((r, i) => (
                          <tr key={i}>
                            <td>{r.provider_id}</td>
                            <td className="mono">{tx(r.model)}</td>
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
                    <h3>{t('set.c.bySku')}</h3>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>{t('tasks.form.sku')}</th>
                          <th className="num">{t('set.c.callsCol')}</th>
                          <th className="num">{t('set.c.cost')}</th>
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
                    <h3>{t('set.c.recent')}</h3>
                    <span className="xs muted">{t('set.c.max')}</span>
                  </div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>{t('set.c.time')}</th>
                          <th>{t('tasks.form.sku')}</th>
                          <th>{t('set.c.chModel')}</th>
                          <th>{t('set.c.op')}</th>
                          <th className="num">{t('set.c.tokens')}</th>
                          <th className="num">$</th>
                          <th className="num">{t('set.c.dur')}</th>
                          <th>{t('set.c.result')}</th>
                          <th>{t('set.c.operator')}</th>
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
                              {r.provider_id} / <span className="mono">{tx(r.model)}</span>
                            </td>
                            <td>{r.op}</td>
                            <td className="num">
                              {r.input_tokens ?? '–'} / {r.output_tokens ?? '–'}
                            </td>
                            <td className="num">
                              {r.amount_usd}
                              {r.estimated ? <span className="xs muted"> {t('set.c.est')}</span> : null}
                            </td>
                            <td className="num">{r.duration_ms} ms</td>
                            <td>{r.ok ? <Badge tone="success">{t('set.c.ok')}</Badge> : <Badge tone="danger">{t('st.failed')}</Badge>}</td>
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
