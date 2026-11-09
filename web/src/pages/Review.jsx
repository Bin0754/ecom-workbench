import { useEffect, useRef, useState } from 'react';
import { Check, X, ChevronLeft, ChevronRight, Layers, ArrowLeftRight, PartyPopper, RefreshCw, ShieldCheck, CornerUpLeft, Hand } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { t, tx } from '../i18n.js';
import { Badge, Button, Empty, Precheck, PrecheckBadge, Sheet, Skeleton } from '../ui.jsx';

// Phone-first card review: swipe right to approve, left to reject (with reasons), or use the big buttons
export default function Review() {
  const { meta, notify } = useApp();
  const [list, setList] = useState(null);
  const [i, setI] = useState(0);
  const [view, setView] = useState('out');
  const [reasons, setReasons] = useState([]);
  const [comment, setComment] = useState('');
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const [out, setOut] = useState(null);
  const [showReject, setShowReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doneN, setDoneN] = useState(0);
  const t0 = useRef(null);
  const load = () =>
    api('/api/review/queue').then((l) => {
      setList(l);
      setI((k) => Math.min(k, Math.max(0, l.length - 1)));
    });
  useEffect(() => {
    load();
  }, []);
  const cur = list?.[i];
  useEffect(() => {
    setView('out');
    setReasons([]);
    setComment('');
    setShowReject(false);
    setDx(0);
    setOut(null);
  }, [cur?.id]);

  async function decide(result) {
    if (!cur || busy) return;
    if (result === 'rejected' && !reasons.length) {
      setShowReject(true);
      return;
    }
    if (result === 'approved' && cur.precheck?.overall === 'fail' && !confirm(t('rv.confirmFail'))) return;
    setBusy(true);
    try {
      await api(`/api/outputs/${cur.id}/review`, { method: 'POST', body: { result, reasons, comment } });
      setShowReject(false);
      setOut(result === 'approved' ? 'out-right' : 'out-left');
      window.dispatchEvent(new Event('wb:changed'));
      notify(t(result === 'approved' ? 'rv.approved' : 'rv.rejected', { sku: cur.sku, tpl: tx(cur.tname) }));
      await new Promise((r) => setTimeout(r, 260));
      setDoneN((n) => n + 1);
      setList((l) => l.filter((x) => x.id !== cur.id));
    } catch (e) {
      notify(e.message, true);
    }
    setBusy(false);
  }
  async function approveProduct() {
    const ids = list.filter((x) => x.product_id === cur.product_id && x.precheck?.overall !== 'fail').map((x) => x.id);
    if (!confirm(t('rv.batchConfirm', { sku: cur.sku, n: ids.length }))) return;
    const r = await api('/api/review/batch-approve', { method: 'POST', body: { ids } });
    notify(t('rv.batchDone', { n: r.approved }));
    setDoneN((n) => n + r.approved);
    load();
  }
  const onTouchStart = (e) => {
    t0.current = e.touches[0].clientX;
    setDrag(true);
  };
  const onTouchMove = (e) => {
    if (t0.current != null) setDx(e.touches[0].clientX - t0.current);
  };
  const onTouchEnd = () => {
    const v = dx;
    t0.current = null;
    setDrag(false);
    setDx(0);
    if (v > 110) decide('approved');
    else if (v < -110) {
      if (reasons.length) decide('rejected');
      else setShowReject(true);
    }
  };

  if (!list)
    return (
      <div className="review">
        <Skeleton h={22} w="60%" style={{ marginBottom: 12 }} />
        <Skeleton h={380} r={22} />
        <Skeleton h={56} r={16} style={{ marginTop: 16 }} />
      </div>
    );
  if (!list.length)
    return (
      <div className="review fade-in">
        <div className="card" style={{ marginTop: 24 }}>
          <Empty
            icon={PartyPopper}
            title={t('rv.empty.title')}
            action={
              <Button icon={RefreshCw} onClick={load}>
                {t('common.refresh')}
              </Button>
            }
          >
            {doneN ? t('rv.empty.done', { n: doneN }) : ''}
            {t('rv.empty.desc')}
          </Empty>
        </div>
      </div>
    );
  const img = view === 'src' ? cur.source?.url : view === 'prev' ? cur.previous?.url : cur.url;
  const lastReject = cur.previous?.reviews?.find((r) => r.result === 'rejected');
  const total = list.length + doneN;
  const issues = cur.precheck?.items.filter((x) => x.level !== 'pass').length || 0;
  return (
    <div className="review">
      <div className="rv-top">
        <div className="grow">
          <div className="eyebrow">{t('nav.review')}</div>
          <h1 style={{ fontSize: 20 }} className="ellipsis">
            {cur.sku}
            <span className="muted" style={{ fontWeight: 500 }}>
              {' '}
              · {tx(cur.tname)}
            </span>
          </h1>
        </div>
        <span className="rv-count">
          {doneN + 1} / {total}
        </span>
      </div>
      <div className="rv-dots">
        {Array.from({ length: Math.min(total, 30) }).map((_, k) => (
          <i key={k} className={k < doneN ? 'done' : k === doneN ? 'cur' : ''} />
        ))}
      </div>
      <div className="seg block rv-seg">
        <button className={view === 'out' ? 'on' : ''} onClick={() => setView('out')}>
          <Layers size={14} />
          {t('rv.view.out')}
        </button>
        <button className={view === 'src' ? 'on' : ''} onClick={() => setView('src')}>
          <ArrowLeftRight size={14} />
          {t('rv.view.src')}
        </button>
        {cur.previous && (
          <button className={view === 'prev' ? 'on' : ''} onClick={() => setView('prev')}>
            <CornerUpLeft size={14} />
            {t('rv.view.prev', { v: cur.previous.version })}
          </button>
        )}
      </div>
      <div
        key={cur.id}
        className={'rv-card enter' + (drag ? ' dragging' : '') + (out ? ' ' + out : '')}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={!out && dx ? { transform: `translateX(${dx}px) rotate(${dx / 30}deg)` } : undefined}
      >
        <span className="rv-stamp ok" style={{ opacity: Math.max(0, Math.min(1, (dx - 30) / 80)) }}>
          {t('rv.approve')}
        </span>
        <span className="rv-stamp no" style={{ opacity: Math.max(0, Math.min(1, (-dx - 30) / 80)) }}>
          {t('rv.reject')}
        </span>
        <div className="rv-media">
          <a href={img} target="_blank" rel="noreferrer">
            <img className="rv-img" src={img} alt="" draggable={false} />
          </a>
          <div className="rv-overlay">
            <Badge className="solid-dark">
              {view === 'src'
                ? t('rv.view.src')
                : view === 'prev'
                  ? `v${cur.previous.version} · ${cur.previous.status === 'rejected' ? t('st.rejected') : t('rv.history')}`
                  : `v${cur.version}`}
            </Badge>
            {cur.provider_id === 'mock' && view === 'out' && <Badge tone="warning">{t('rv.mock')}</Badge>}
          </div>
        </div>
        <div className="rv-meta">
          <div className="grow">
            <b>{tx(cur.tname)}</b>
            <div className="sub">
              {cur.width}×{cur.height} · {tx(cur.model) || cur.provider_id}
            </div>
          </div>
          <PrecheckBadge pc={cur.precheck} />
        </div>
      </div>
      <div className="rv-hint">
        <span>
          <Hand size={13} />
          {t('rv.hint.right')}
        </span>
        <span>{t('rv.hint.left')}</span>
        <span>{t('rv.hint.tap')}</span>
      </div>
      {lastReject && (
        <div className="callout t-danger" style={{ marginBottom: 12 }}>
          <CornerUpLeft size={15} />
          <div>
            <b>{t('rv.lastReject')}</b> {lastReject.reasons.map(tx).join(t('common.listSep'))}
            {lastReject.comment ? ` — ${lastReject.comment}` : ''}
          </div>
        </div>
      )}
      <details className="card rv-section" open={issues > 0}>
        <summary>
          <span className="row" style={{ gap: 8 }}>
            <ShieldCheck size={16} />
            {t('rv.precheck')}
          </span>
          <span className="row" style={{ gap: 6 }}>
            {issues ? (
              <Badge tone={cur.precheck.overall === 'fail' ? 'danger' : 'warning'}>{t('rv.issues', { n: issues })}</Badge>
            ) : (
              <Badge tone="success">{t('rv.allPass')}</Badge>
            )}
          </span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <Precheck pc={cur.precheck} compact />
        </div>
      </details>
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={i === 0} onClick={() => setI(i - 1)}>
          {t('rv.prev')}
        </Button>
        <div className="grow" style={{ textAlign: 'center' }}>
          <Button size="sm" variant="ghost" icon={Check} onClick={approveProduct}>
            {t('rv.batch')}
          </Button>
        </div>
        <Button size="sm" variant="ghost" iconRight={ChevronRight} disabled={i >= list.length - 1} onClick={() => setI(i + 1)}>
          {t('rv.next')}
        </Button>
      </div>
      <div className="rv-pad" />
      <div className="rv-actions">
        <div className="inner">
          <button className="btn v-reject" disabled={busy} onClick={() => setShowReject(true)}>
            <X size={20} strokeWidth={2.5} />
            <span>{t('rv.reject')}</span>
          </button>
          <button className="btn v-approve" disabled={busy} onClick={() => decide('approved')}>
            <Check size={20} strokeWidth={2.5} />
            <span>{t('rv.approve')}</span>
          </button>
        </div>
      </div>
      <Sheet
        open={showReject}
        onClose={() => setShowReject(false)}
        title={t('rv.reasons')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowReject(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" icon={X} disabled={!reasons.length || busy} onClick={() => decide('rejected')}>
              {reasons.length ? t('rv.confirmReject', { n: reasons.length }) : t('rv.pickReason')}
            </Button>
          </>
        }
      >
        <div className="reject-sheet">
          <p className="sm text-2" style={{ marginTop: 0 }}>
            {t('rv.reasons.desc')}
          </p>
          <div className="chips">
            {meta.reasons.map((r) => (
              <button
                key={r}
                className={'chip lg' + (reasons.includes(r) ? ' on danger' : '')}
                onClick={() => setReasons(reasons.includes(r) ? reasons.filter((x) => x !== r) : [...reasons, r])}
              >
                {reasons.includes(r) && <Check size={14} />}
                {tx(r)}
              </button>
            ))}
          </div>
          <label className="field" style={{ marginTop: 16 }}>
            <span className="label">
              {t('rv.comment')}
              <em>{t('tasks.form.optional')}</em>
            </span>
            <textarea rows={3} placeholder={t('rv.comment.ph')} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
        </div>
      </Sheet>
    </div>
  );
}
