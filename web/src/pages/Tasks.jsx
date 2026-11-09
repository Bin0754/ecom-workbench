import { useEffect, useState } from 'react';
import { Plus, Search, Camera, Workflow, Package, ImageOff, Clock, CheckCircle2, Hourglass, ClipboardList } from 'lucide-react';
import { api } from '../api.js';
import { useApp, go } from '../App.jsx';
import { t, tx } from '../i18n.js';
import { Badge, Button, Empty, PageHeader, Progress, Sheet, SkeletonList, PRODUCT_TONE } from '../ui.jsx';

const EMPTY = {
  sku: '',
  asin: '',
  name: '',
  name_zh: '',
  brand: '',
  size_spec: '',
  dimensions: '',
  ingredients: '',
  benefits: '',
  usage_steps: '',
  box_contents: '',
  due_date: '',
  notes: '',
  photographer: '',
  product_type: '',
  brand_colors: '',
  audience: '',
};
const FILTERS = [
  ['all', t('tasks.f.all')],
  ['todo', t('tasks.f.todo')],
  ['active', t('tasks.f.active')],
  ['review', t('tasks.f.review')],
  ['done', t('tasks.f.done')],
];
const match = (f, code) => f === 'all' || (f === 'active' ? ['uploaded', 'generating', 'refine', 'rejected', 'partial'].includes(code) : code === f);

export default function Tasks() {
  const { meta, role, notify } = useApp();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [kw, setKw] = useState('');
  const [filter, setFilter] = useState('all');
  const load = () =>
    api('/api/tasks')
      .then(setRows)
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  const canCreate = role === 'admin' || role === 'designer';
  const save = async () => {
    setSaving(true);
    try {
      await api('/api/products', { method: 'POST', body: form });
      notify(t('tasks.created'));
      setForm(null);
      load();
    } catch (e) {
      notify(e.message, true);
    }
    setSaving(false);
  };
  const all = rows || [];
  const list = all.filter(
    (r) => match(filter, r.status.code) && (!kw || [r.sku, r.asin, r.name, r.name_zh].join(' ').toLowerCase().includes(kw.toLowerCase())),
  );
  const count = (f) => all.filter((r) => match(f, r.status.code)).length;
  const F = (k, label, p = {}) => (
    <label className="field">
      <span className="label">
        {label}
        {p.hint && <em>{p.hint}</em>}
      </span>
      {p.area ? (
        <textarea rows={p.rows || 3} value={form[k]} placeholder={p.ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      ) : (
        <input
          value={form[k]}
          placeholder={p.ph}
          type={p.type || 'text'}
          onChange={(e) => setForm({ ...form, [k]: p.upper ? e.target.value.toUpperCase() : e.target.value })}
        />
      )}
    </label>
  );
  const sum = (k) => all.reduce((a, r) => a + (r[k] || 0), 0);
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={t('side.workspace')}
        title={t('tasks.title')}
        desc={t('tasks.desc')}
        actions={
          canCreate && (
            <Button variant="primary" icon={Plus} onClick={() => setForm({ ...EMPTY, angles: [...meta.defaultAngles] })}>
              {t('tasks.new')}
            </Button>
          )
        }
      />
      {rows && (
        <div className="stats">
          <div className="card stat">
            <div className="k">
              <Package size={14} />
              {t('tasks.stat.sku')}
            </div>
            <div className="v">{all.length}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Camera size={14} />
              {t('tasks.stat.sources')}
            </div>
            <div className="v">{sum('sourceCount')}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Hourglass size={14} />
              {t('tasks.stat.pending')}
            </div>
            <div className="v">{sum('pendingCount')}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <CheckCircle2 size={14} />
              {t('tasks.stat.approved')}
            </div>
            <div className="v">{sum('approvedCount')}</div>
          </div>
        </div>
      )}
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder={t('tasks.search')} value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}
              <span className="muted xs">{rows ? count(k) : ''}</span>
            </button>
          ))}
        </div>
      </div>
      {!rows ? (
        <SkeletonList n={3} h={88} />
      ) : !all.length ? (
        <div className="card">
          <Empty
            icon={ClipboardList}
            title={t('tasks.empty.title')}
            action={
              canCreate && (
                <Button variant="primary" icon={Plus} onClick={() => setForm({ ...EMPTY, angles: [...meta.defaultAngles] })}>
                  {t('tasks.empty.cta')}
                </Button>
              )
            }
          >
            {t('tasks.empty.desc')}
          </Empty>
        </div>
      ) : !list.length ? (
        <div className="card">
          <Empty icon={Search} title={t('tasks.nomatch.title')}>
            {t('tasks.nomatch.desc')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="task-head">
            <span />
            <span>{t('tasks.col.sku')}</span>
            <span>{t('tasks.col.shoot')}</span>
            <span>{t('tasks.col.review')}</span>
            <span>{t('tasks.col.status')}</span>
            <span />
          </div>
          <div className="task-list">
            {list.map((r) => {
              const need = r.angles.length || 1,
                shot = r.angles.filter((a) => r.shotAngles.includes(a)).length;
              return (
                <div className="card task-row" key={r.id}>
                  <div className="thumb">{r.cover ? <img src={r.cover} alt="" loading="lazy" /> : <ImageOff size={20} strokeWidth={1.6} />}</div>
                  <div className="task-main">
                    <div className="task-title">
                      <b>{r.sku}</b>
                      <span className="desktop-only" />
                      <span className="mobile-only">
                        <Badge tone={PRODUCT_TONE[r.status.code]} dot>
                          {tx(r.status.label)}
                        </Badge>
                      </span>
                    </div>
                    <div className="task-sub ellipsis">
                      {r.name}
                      {r.name_zh ? ` · ${r.name_zh}` : ''}
                    </div>
                    <div className="task-meta">
                      <span className="mono">{r.asin || t('tasks.noAsin')}</span>
                      {r.due_date && (
                        <span className="row" style={{ gap: 4 }}>
                          <Clock size={12} />
                          {r.due_date}
                        </span>
                      )}
                      {r.photographer && <span>{t('tasks.photographer', { name: r.photographer })}</span>}
                    </div>
                  </div>
                  <div className="task-progress">
                    <div className="metric">
                      <div className="mk">
                        <span>{t('tasks.m.shot')}</span>
                        <b>
                          {shot}/{need}
                        </b>
                      </div>
                      <Progress value={shot / need} tone={shot === need ? 'success' : 'accent'} />
                      {r.status.missing?.length > 0 && (
                        <div className="missing ellipsis">
                          {t('tasks.missing', {
                            list: r.status.missing
                              .map((a) => tx(meta.angles.find((x) => x.id === a)?.label || a).replace(/（.*）| \(.*\)/, ''))
                              .join(t('common.listSep')),
                          })}
                        </div>
                      )}
                    </div>
                    <div className="metric">
                      <div className="mk">
                        <span>{t('tasks.m.approved')}</span>
                        <b>
                          {r.approvedCount}/{r.nodeCount || '–'}
                        </b>
                      </div>
                      <Progress value={r.nodeCount ? r.approvedCount / r.nodeCount : 0} tone="success" />
                      {r.pendingCount > 0 && (
                        <div className="missing" style={{ color: 'var(--text-3)' }}>
                          {t('tasks.m.pending', { n: r.pendingCount })}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="desktop-only">
                    <Badge tone={PRODUCT_TONE[r.status.code]} dot>
                      {tx(r.status.label)}
                    </Badge>
                  </div>
                  <div className="task-actions">
                    {(role === 'photographer' || role === 'admin') && (
                      <Button size="sm" variant={role === 'photographer' ? 'primary' : 'secondary'} icon={Camera} onClick={() => go('upload/' + r.id)}>
                        {t('tasks.btn.upload')}
                      </Button>
                    )}
                    {(role === 'designer' || role === 'admin') && (
                      <Button size="sm" icon={Workflow} onClick={() => go('canvas/' + r.id)}>
                        {t('tasks.btn.canvas')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      <Sheet
        open={!!form}
        onClose={() => setForm(null)}
        title={t('tasks.new')}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {t('tasks.create')}
            </Button>
          </>
        }
      >
        {form && (
          <>
            <div className="form-section">
              <h3>{t('tasks.form.basic')}</h3>
              <p>{t('tasks.form.basic.desc')}</p>
              <div className="grid-2">
                {F('sku', t('tasks.form.sku'), { ph: t('tasks.form.sku.ph'), upper: true, hint: t('tasks.form.required') })}
                {F('asin', 'ASIN', { ph: 'B0XXXXXXXX', upper: true, hint: t('tasks.form.asin.hint') })}
                {F('name', t('tasks.form.name'), { ph: 'LUMA Vitamin C Serum', hint: t('tasks.form.name.hint') })}
                {F('name_zh', t('tasks.form.nameZh'), { ph: t('tasks.form.nameZh.ph') })}
                {F('brand', t('tasks.form.brand'), { ph: 'LUMA' })}
                {F('size_spec', t('tasks.form.size'), { ph: '30 ml / 1 fl oz' })}
              </div>
              {F('dimensions', t('tasks.form.dims'), { ph: 'H 10.5 cm × Ø 3.4 cm', hint: t('tasks.form.dims.hint') })}
              <div className="grid-2">
                <label className="field">
                  <span className="label">
                    {t('tasks.form.ptype')}
                    <em>{t('tasks.form.ptype.hint')}</em>
                  </span>
                  <select value={form.product_type || ''} onChange={(e) => setForm({ ...form, product_type: e.target.value })}>
                    <option value="">{t('tasks.form.ptype.auto')}</option>
                    {Object.entries(meta.productTypes || {}).map(([k, v]) => (
                      <option key={k} value={k}>
                        {tx(v)}
                      </option>
                    ))}
                  </select>
                </label>
                {F('brand_colors', t('tasks.form.colors'), { ph: 'amber glass, warm white', hint: t('tasks.form.optional') })}
              </div>
              {F('audience', t('tasks.form.audience'), { ph: 'adults 25-45, minimalist routine', hint: t('tasks.form.optionalEn') })}
            </div>
            <div className="form-section">
              <h3>{t('tasks.form.shoot')}</h3>
              <p>{t('tasks.form.shoot.desc')}</p>
              <div className="field">
                <span className="label">
                  {t('tasks.form.angles')}
                  <em>{t('tasks.form.angles.n', { n: form.angles.length })}</em>
                </span>
                <div className="chips">
                  {meta.angles.map((a) => {
                    const on = form.angles.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={'chip' + (on ? ' on' : '')}
                        onClick={() => setForm({ ...form, angles: on ? form.angles.filter((x) => x !== a.id) : [...form.angles, a.id] })}
                      >
                        {tx(a.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid-2">
                {F('due_date', t('tasks.form.due'), { type: 'date' })}
                {F('photographer', t('tasks.form.assign'), { ph: t('tasks.form.assign.ph') })}
              </div>
              {F('notes', t('tasks.form.notes'), { area: true, rows: 2, ph: t('tasks.form.notes.ph') })}
            </div>
            <div className="form-section">
              <h3>{t('tasks.form.copy')}</h3>
              <p>{t('tasks.form.copy.desc')}</p>
              {F('ingredients', t('tasks.form.ingredients'), {
                area: true,
                ph: 'Vitamin C 15%|Helps skin look brighter',
                hint: t('tasks.form.ingredients.hint'),
              })}
              {F('benefits', t('tasks.form.benefits'), { area: true, ph: 'Visibly brighter-looking skin', hint: t('tasks.form.perLine') })}
              {F('usage_steps', t('tasks.form.usage'), { area: true, hint: t('tasks.form.perStep') })}
              {F('box_contents', t('tasks.form.box'), { area: true, rows: 2, hint: t('tasks.form.perItem') })}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
