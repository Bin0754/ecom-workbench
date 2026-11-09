// 设计系统组件：徽标、按钮、骨架屏、空状态、预检列表、角度示意图、抽屉
import { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, Loader2, X } from 'lucide-react';

export function Badge({ tone = 'neutral', icon: I, children, dot, className = '' }) {
  return (
    <span className={`badge t-${tone} ${className}`}>
      {dot && <i className="dot" />}
      {I && <I size={12} strokeWidth={2.25} />}
      {children}
    </span>
  );
}
export function Button({ variant = 'secondary', size = 'md', icon: I, iconRight: IR, loading, children, className = '', ...rest }) {
  return (
    <button className={`btn v-${variant} s-${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : I && <I size={size === 'sm' ? 14 : 16} strokeWidth={2} />}
      {children && <span>{children}</span>}
      {IR && <IR size={16} strokeWidth={2} />}
    </button>
  );
}
export const Skeleton = ({ w = '100%', h = 16, r = 8, style }) => <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
export function SkeletonList({ n = 3, h = 76 }) {
  return (
    <div className="stack-8">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} h={h} r={14} />
      ))}
    </div>
  );
}
export function Empty({ icon: I, title, children, action }) {
  return (
    <div className="empty">
      {I && (
        <div className="empty-icon">
          <I size={22} strokeWidth={1.75} />
        </div>
      )}
      <div className="empty-title">{title}</div>
      {children && <div className="empty-desc">{children}</div>}
      {action}
    </div>
  );
}
export function PageHeader({ title, desc, actions, eyebrow }) {
  return (
    <div className="page-header">
      <div className="ph-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

export const STATUS = {
  generating: ['生成中', 'info'],
  awaiting: ['待外部出图', 'accent'],
  failed: ['生成失败', 'danger'],
  draft: ['草稿', 'neutral'],
  pending: ['待审核', 'warning'],
  rejected: ['已打回', 'danger'],
  approved: ['已通过', 'success'],
  void: ['已作废', 'neutral'],
};
export function StatusBadge({ status }) {
  const [l, t] = STATUS[status] || ['未生成', 'neutral'];
  return (
    <Badge tone={t} dot>
      {l}
    </Badge>
  );
}
export const PRODUCT_TONE = {
  todo: 'neutral',
  uploaded: 'warning',
  generating: 'info',
  refine: 'accent',
  review: 'warning',
  rejected: 'danger',
  partial: 'teal',
  done: 'success',
};
const LV = {
  pass: { I: CheckCircle2, tone: 'success', label: '通过' },
  warn: { I: AlertTriangle, tone: 'warning', label: '提醒' },
  fail: { I: XCircle, tone: 'danger', label: '不合规' },
};
export function PrecheckBadge({ pc }) {
  if (!pc) return null;
  const v = LV[pc.overall];
  return (
    <Badge tone={v.tone} icon={v.I}>
      预检{v.label}
    </Badge>
  );
}
export function Precheck({ pc, compact }) {
  if (!pc) return null;
  const items = compact ? pc.items.filter((i) => i.level !== 'pass') : pc.items;
  return (
    <div className="checks">
      {items.length === 0 && (
        <div className="check pass">
          <CheckCircle2 size={16} />
          <div>
            <b>全部检查通过</b>
          </div>
        </div>
      )}
      {items.map((i, k) => {
        const v = LV[i.level];
        return (
          <div key={k} className={'check ' + i.level}>
            <v.I size={16} strokeWidth={2} />
            <div>
              <b>{i.label}</b>
              <span>{i.detail}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function Sheet({ open, onClose, title, children, footer, wide }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={'sheet' + (wide ? ' wide' : '')} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Progress({ value, tone = 'accent', label }) {
  return (
    <div className={'progress t-' + tone} title={label}>
      <i style={{ width: Math.max(0, Math.min(1, value)) * 100 + '%' }} />
    </div>
  );
}

// 拍摄角度示意线稿：给不懂 AI 的摄影一个直观的构图参考
export function AngleGlyph({ angle, size = 56 }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const bottle = (t = '') => (
    <g transform={t}>
      <rect x="24" y="8" width="16" height="9" rx="2" {...s} />
      <rect x="18" y="17" width="28" height="39" rx="6" {...s} />
    </g>
  );
  const G = {
    front: (
      <>
        {bottle()}
        <rect x="23" y="28" width="18" height="14" rx="1.5" {...s} />
      </>
    ),
    back: (
      <>
        {bottle()}
        <path d="M23 27h18M23 32h18M23 37h14M23 42h16M23 47h10" {...s} />
      </>
    ),
    '45deg': (
      <>
        <g transform="rotate(-14 32 32)">
          {bottle()}
          <rect x="25" y="28" width="12" height="14" rx="1.5" {...s} />
        </g>
        <path d="M48 50a20 20 0 0 0 4-14" {...s} strokeDasharray="2 3" />
      </>
    ),
    side: (
      <>
        <rect x="27" y="8" width="10" height="9" rx="2" {...s} />
        <rect x="24" y="17" width="16" height="39" rx="5" {...s} />
      </>
    ),
    top: (
      <>
        <circle cx="32" cy="32" r="20" {...s} />
        <circle cx="32" cy="32" r="8" {...s} />
        <path d="M32 4v6M32 54v6" {...s} strokeDasharray="2 3" />
      </>
    ),
    texture: (
      <>
        <path d="M10 40c8-10 16 6 24-4s14-2 20-8" {...s} strokeWidth="5" opacity=".35" />
        <path d="M10 40c8-10 16 6 24-4s14-2 20-8" {...s} />
        <circle cx="46" cy="18" r="5" {...s} />
      </>
    ),
    package: (
      <>
        <path d="M14 22l18-9 18 9v22l-18 9-18-9z" {...s} />
        <path d="M14 22l18 9 18-9M32 31v22" {...s} />
      </>
    ),
    inbox: (
      <>
        <rect x="8" y="16" width="22" height="32" rx="4" {...s} />
        <rect x="35" y="26" width="20" height="22" rx="3" {...s} />
        <path d="M38 20h14" {...s} />
      </>
    ),
    detail: (
      <>
        <circle cx="27" cy="27" r="13" {...s} />
        <path d="M37 37l12 12" {...s} strokeWidth="3" />
        <path d="M22 27h10M27 22v10" {...s} />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      {G[angle] || G.front}
    </svg>
  );
}
export const LevelIcon = { info: Info };

// ---------- 分段提示词编辑器（## 段名 分段；可整段或逐段编辑） ----------
const SEC_CN = {
  PURPOSE: '用途',
  SUBJECT: '商品（锁定）',
  'SCENE & SET': '场景与布景',
  CAMERA: '机位',
  LIGHTING: '布光',
  COMPOSITION: '构图与留白',
  STYLE: '风格',
  'HARD CONSTRAINTS': '硬约束（系统追加）',
};
export const PROMPT_VARS = [
  'name',
  'brand',
  'product_form',
  'product_colors',
  'hero_ingredients',
  'ingredient_props',
  'ingredient_prop',
  'key_benefit',
  'benefit_mood',
  'palette',
  'audience',
  'scene',
  'texture_desc',
  'texture_surface',
  'formula_color',
  'camera',
  'light_side',
  'fill_side',
  'shadow_side',
  'product_zone',
  'text_zone',
];
export function splitPrompt(text = '') {
  const out = [];
  const re = /^##\s*(.+?)\s*$/gm;
  let m,
    last = null,
    idx = 0;
  const pre = [];
  while ((m = re.exec(text))) {
    if (last === null) pre.push(text.slice(0, m.index).trim());
    else out.push({ name: last, body: text.slice(idx, m.index).trim() });
    last = m[1];
    idx = re.lastIndex;
  }
  if (last !== null) out.push({ name: last, body: text.slice(idx).trim() });
  if (pre[0]) out.unshift({ name: '', body: pre[0] });
  if (!out.length && text.trim()) out.push({ name: '', body: text.trim() });
  return out;
}
const joinPrompt = (secs) => secs.map((s) => (s.name ? `## ${s.name}\n${s.body}` : s.body)).join('\n\n');
export function PromptEditor({ value, onChange, hint }) {
  const [mode, setMode] = useState('sections');
  const secs = splitPrompt(value || '');
  const setSec = (i, body) => onChange(joinPrompt(secs.map((s, k) => (k === i ? { ...s, body } : s))));
  return (
    <div className="pe">
      <div className="pe-head">
        <span className="label">
          提示词<em>{hint || '变量 {…} 发送前自动替换'}</em>
        </span>
        <div className="seg sm">
          <button type="button" className={mode === 'sections' ? 'on' : ''} onClick={() => setMode('sections')}>
            分段
          </button>
          <button type="button" className={mode === 'raw' ? 'on' : ''} onClick={() => setMode('raw')}>
            整段
          </button>
        </div>
      </div>
      {mode === 'raw' || !secs.some((s) => s.name) ? (
        <textarea className="pe-raw" rows={12} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <div className="pe-secs">
          {secs.map((s, i) => (
            <label key={i} className="pe-sec">
              <span className="pe-name">
                {SEC_CN[s.name] || s.name || '前言'}
                <i>{s.name}</i>
              </span>
              <textarea rows={Math.min(8, Math.max(2, Math.ceil(s.body.length / 58)))} value={s.body} onChange={(e) => setSec(i, e.target.value)} />
            </label>
          ))}
        </div>
      )}
      <details className="pe-vars">
        <summary>可用变量（{PROMPT_VARS.length}）</summary>
        <div>
          {PROMPT_VARS.map((v) => (
            <code key={v}>{`{${v}}`}</code>
          ))}
        </div>
      </details>
    </div>
  );
}
export function PromptPreview({ text }) {
  const secs = splitPrompt(text || '');
  return (
    <details className="pp">
      <summary>实际发送给模型的完整提示词（{(text || '').split(/\s+/).filter(Boolean).length} 词）</summary>
      <div className="pp-body">
        {secs.map((s, i) => (
          <div key={i} className={'pp-sec' + (s.name === 'HARD CONSTRAINTS' ? ' sys' : '')}>
            {s.name && <b>{SEC_CN[s.name] || s.name}</b>}
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
