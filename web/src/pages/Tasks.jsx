import { useEffect, useState } from 'react';
import { Plus, Search, Camera, Workflow, Package, ImageOff, Clock, CheckCircle2, Hourglass, ClipboardList } from 'lucide-react';
import { api } from '../api.js';
import { useApp, go } from '../App.jsx';
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
  ['all', '全部'],
  ['todo', '待拍摄'],
  ['active', '进行中'],
  ['review', '待审核'],
  ['done', '已入库'],
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
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  const canCreate = role === 'admin' || role === 'designer';
  const save = async () => {
    setSaving(true);
    try {
      await api('/api/products', { method: 'POST', body: form });
      notify('任务单已创建');
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
        eyebrow="工作区"
        title="拍摄任务单"
        desc="每个款号一张任务单：摄影按角度拍照上传，系统自动出图，审核通过后进入素材库。"
        actions={
          canCreate && (
            <Button variant="primary" icon={Plus} onClick={() => setForm({ ...EMPTY, angles: [...meta.defaultAngles] })}>
              新建任务单
            </Button>
          )
        }
      />
      {rows && (
        <div className="stats">
          <div className="card stat">
            <div className="k">
              <Package size={14} />
              款号
            </div>
            <div className="v">{all.length}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Camera size={14} />
              已拍原片
            </div>
            <div className="v">{sum('sourceCount')}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <Hourglass size={14} />
              待审核图片
            </div>
            <div className="v">{sum('pendingCount')}</div>
          </div>
          <div className="card stat">
            <div className="k">
              <CheckCircle2 size={14} />
              已入库图片
            </div>
            <div className="v">{sum('approvedCount')}</div>
          </div>
        </div>
      )}
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder="搜索款号、ASIN 或品名" value={kw} onChange={(e) => setKw(e.target.value)} />
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
            title="还没有任务单"
            action={
              canCreate && (
                <Button variant="primary" icon={Plus} onClick={() => setForm({ ...EMPTY, angles: [...meta.defaultAngles] })}>
                  新建第一张任务单
                </Button>
              )
            }
          >
            先建任务单，填好款号、ASIN 和必拍角度。摄影打开手机就能按单拍摄上传。
          </Empty>
        </div>
      ) : !list.length ? (
        <div className="card">
          <Empty icon={Search} title="没有符合条件的款号">
            换个关键词，或切回「全部」。
          </Empty>
        </div>
      ) : (
        <>
          <div className="task-head">
            <span />
            <span>款号 / 品名</span>
            <span>拍摄进度</span>
            <span>出图审核</span>
            <span>状态</span>
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
                          {r.status.label}
                        </Badge>
                      </span>
                    </div>
                    <div className="task-sub ellipsis">
                      {r.name}
                      {r.name_zh ? ` · ${r.name_zh}` : ''}
                    </div>
                    <div className="task-meta">
                      <span className="mono">{r.asin || '未填 ASIN'}</span>
                      {r.due_date && (
                        <span className="row" style={{ gap: 4 }}>
                          <Clock size={12} />
                          {r.due_date}
                        </span>
                      )}
                      {r.photographer && <span>摄影 {r.photographer}</span>}
                    </div>
                  </div>
                  <div className="task-progress">
                    <div className="metric">
                      <div className="mk">
                        <span>拍摄</span>
                        <b>
                          {shot}/{need}
                        </b>
                      </div>
                      <Progress value={shot / need} tone={shot === need ? 'success' : 'accent'} />
                      {r.status.missing?.length > 0 && (
                        <div className="missing ellipsis">
                          缺 {r.status.missing.map((a) => meta.angles.find((x) => x.id === a)?.label.replace(/（.*）/, '')).join('、')}
                        </div>
                      )}
                    </div>
                    <div className="metric">
                      <div className="mk">
                        <span>已通过</span>
                        <b>
                          {r.approvedCount}/{r.nodeCount || '–'}
                        </b>
                      </div>
                      <Progress value={r.nodeCount ? r.approvedCount / r.nodeCount : 0} tone="success" />
                      {r.pendingCount > 0 && (
                        <div className="missing" style={{ color: 'var(--text-3)' }}>
                          {r.pendingCount} 张待审核
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="desktop-only">
                    <Badge tone={PRODUCT_TONE[r.status.code]} dot>
                      {r.status.label}
                    </Badge>
                  </div>
                  <div className="task-actions">
                    {(role === 'photographer' || role === 'admin') && (
                      <Button size="sm" variant={role === 'photographer' ? 'primary' : 'secondary'} icon={Camera} onClick={() => go('upload/' + r.id)}>
                        拍照上传
                      </Button>
                    )}
                    {(role === 'designer' || role === 'admin') && (
                      <Button size="sm" icon={Workflow} onClick={() => go('canvas/' + r.id)}>
                        打开画布
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
        title="新建任务单"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              创建任务单
            </Button>
          </>
        }
      >
        {form && (
          <>
            <div className="form-section">
              <h3>基本信息</h3>
              <p>款号和英文品名必填。ASIN 用于亚马逊导出命名。</p>
              <div className="grid-2">
                {F('sku', '款号', { ph: '如 LUMA-VC30', upper: true, hint: '必填' })}
                {F('asin', 'ASIN', { ph: 'B0XXXXXXXX', upper: true, hint: '10 位' })}
                {F('name', '英文品名', { ph: 'LUMA Vitamin C Serum', hint: '上图用' })}
                {F('name_zh', '中文品名', { ph: '维C精华' })}
                {F('brand', '品牌', { ph: 'LUMA' })}
                {F('size_spec', '容量规格', { ph: '30 ml / 1 fl oz' })}
              </div>
              {F('dimensions', '外形尺寸', { ph: 'H 10.5 cm × Ø 3.4 cm', hint: '用于尺寸图' })}
              <div className="grid-2">
                <label className="field">
                  <span className="label">
                    品类形态<em>决定质地图和提示词</em>
                  </span>
                  <select value={form.product_type || ''} onChange={(e) => setForm({ ...form, product_type: e.target.value })}>
                    <option value="">自动识别（按品名）</option>
                    {Object.entries(meta.productTypes || {}).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                {F('brand_colors', '品牌色', { ph: 'amber glass, warm white', hint: '可选' })}
              </div>
              {F('audience', '目标人群', { ph: 'adults 25-45, minimalist routine', hint: '可选，英文' })}
            </div>
            <div className="form-section">
              <h3>拍摄要求</h3>
              <p>摄影只需在手机上点对应角度拍照，文件名和批次自动生成。</p>
              <div className="field">
                <span className="label">
                  必拍角度<em>已选 {form.angles.length} 个</em>
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
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid-2">
                {F('due_date', '截止日期', { type: 'date' })}
                {F('photographer', '指派摄影', { ph: '小王' })}
              </div>
              {F('notes', '拍摄注意事项', { area: true, rows: 2, ph: '保留标签正面、避免瓶身反光' })}
            </div>
            <div className="form-section">
              <h3>上图文案（英文）</h3>
              <p>排版引擎直接使用这些内容，并会做 FDA / 亚马逊宣称合规检查。</p>
              {F('ingredients', '核心成分', { area: true, ph: 'Vitamin C 15%|Helps skin look brighter', hint: '每行：成分|说明' })}
              {F('benefits', '卖点', { area: true, ph: 'Visibly brighter-looking skin', hint: '每行一条' })}
              {F('usage_steps', '使用步骤', { area: true, hint: '每行一步' })}
              {F('box_contents', '包装内容', { area: true, rows: 2, hint: '每行一项' })}
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}
