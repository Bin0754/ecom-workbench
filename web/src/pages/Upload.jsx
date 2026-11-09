import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  FolderUp,
  Check,
  AlertTriangle,
  RotateCw,
  Wifi,
  Pin,
  ChevronRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  Archive,
  Inbox,
} from 'lucide-react';
import { api, uploadXHR, compressImage, fmtBytes } from '../api.js';
import { useApp, go } from '../App.jsx';
import { t, tx } from '../i18n.js';
import { AngleGlyph, Badge, Button, Empty, PageHeader, Progress, SkeletonList } from '../ui.jsx';

// File-name parsing: SKU_angle_nn, e.g. LUMA-VC30_front_01.jpg / LUMA-VC30_正面_1.jpg (Chinese angle names work too)
const ALIAS = {
  front: ['front', 'f', '正面', 'zm'],
  back: ['back', 'b', '背面', 'bm'],
  '45deg': ['45deg', '45', '45°', 'angle'],
  side: ['side', 's', '侧面'],
  top: ['top', 't', '俯拍'],
  texture: ['texture', 'swatch', '质地', '膏体'],
  package: ['package', 'box', 'pkg', '包装', '包装盒'],
  inbox: ['inbox', 'flatlay', '平铺', '包装内容'],
  detail: ['detail', 'd', '细节'],
};
export function parseName(name, product) {
  const base = name.replace(/\.[^.]+$/, '');
  const parts = base.split(/[_\s]+/);
  const skuOk = [product.sku, product.asin].filter(Boolean).some((s) => base.toUpperCase().startsWith(s.toUpperCase()));
  for (const p of parts.slice(1)) {
    const angle = Object.keys(ALIAS).find((a) => ALIAS[a].includes(p.toLowerCase()));
    if (angle) return { angle, skuOk };
  }
  return { angle: null, skuOk };
}
const slow = () => {
  const c = navigator.connection;
  return !!(c && (c.saveData || /2g|3g/.test(c.effectiveType || '')));
};
const short = (l) => tx(l)?.replace(/（.*）| \(.*\)/, '');

export default function Upload({ arg }) {
  const { meta, notify } = useApp();
  const [tasks, setTasks] = useState(null);
  const [d, setD] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [saver, setSaver] = useState(() => (localStorage.getItem('wb.saver') ? localStorage.getItem('wb.saver') === '1' : slow()));
  const [unsorted, setUnsorted] = useState([]);
  const pickRef = useRef({});
  const load = () =>
    arg &&
    api('/api/products/' + arg)
      .then(setD)
      .catch((e) => notify(e.message, true));
  useEffect(() => {
    if (!arg) api('/api/tasks').then(setTasks);
    else load();
  }, [arg]);
  useEffect(() => {
    localStorage.setItem('wb.saver', saver ? '1' : '0');
  }, [saver]);

  if (!arg)
    return (
      <div className="fade-in">
        <PageHeader eyebrow={t('nav.upload')} title={t('up.pick.title')} desc={t('up.pick.desc')} />
        {!tasks ? (
          <SkeletonList n={3} h={72} />
        ) : !tasks.length ? (
          <div className="card">
            <Empty icon={Inbox} title={t('up.none.title')}>
              {t('up.none.desc')}
            </Empty>
          </div>
        ) : (
          <div className="pick-list">
            {tasks.map((tk) => {
              const need = tk.angles.length || 1,
                shot = tk.angles.filter((a) => tk.shotAngles.includes(a)).length;
              return (
                <button key={tk.id} className="card pick" onClick={() => go('upload/' + tk.id)}>
                  <div className="thumb">{tk.cover ? <img src={tk.cover} alt="" /> : <Camera size={20} strokeWidth={1.6} />}</div>
                  <div className="grow">
                    <div className="row">
                      <b>{tk.sku}</b>
                      <Badge tone={shot === need ? 'success' : 'warning'}>{t('up.angles', { shot, need })}</Badge>
                    </div>
                    <div className="sm text-2 ellipsis">{tk.name_zh || tk.name}</div>
                    <Progress value={shot / need} tone={shot === need ? 'success' : 'accent'} />
                  </div>
                  <ChevronRight size={18} className="muted" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  if (!d) return <SkeletonList n={4} h={120} />;
  const req = d.task?.angles || meta.defaultAngles;
  const slots = [...req, ...meta.angles.map((a) => a.id).filter((a) => !req.includes(a))];
  const byAngle = (a) => d.sources.filter((s) => s.angle === a);
  const done = req.filter((a) => byAngle(a).length).length;
  const nextMissing = req.find((a) => !byAngle(a).length && !jobs.some((j) => j.angle === a && !j.bad));

  const setJob = (id, patch) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  async function send(file, angle) {
    const id = Math.random().toString(36).slice(2);
    const preview = URL.createObjectURL(file);
    setJobs((js) => [{ id, name: file.name, angle, size: file.size, progress: 0, state: t('up.job.prep'), preview }, ...js]);
    try {
      if (saver && file.size > 600 * 1024) {
        setJob(id, { state: t('up.job.compress') });
        const c = await compressImage(file);
        setJob(id, { state: t('up.job.preview', { size: fmtBytes(c.blob.size) }) });
        const f = new FormData();
        f.append('productId', d.product.id);
        f.append('angle', angle);
        f.append('preview', '1');
        f.append('originalName', file.name);
        f.append('file', c.blob, file.name.replace(/\.[^.]+$/, '') + '_preview.jpg');
        const r = await uploadXHR('/api/upload', f, { onProgress: (p, msg) => setJob(id, { progress: p * 0.5, ...(msg ? { state: msg } : {}) }) });
        load();
        setJob(id, { state: t('up.job.started') });
        const o = new FormData();
        o.append('file', file, file.name);
        await uploadXHR(`/api/sources/${r.source.id}/original`, o, {
          method: 'PUT',
          onProgress: (p, msg) => setJob(id, { progress: 0.5 + p * 0.5, ...(msg ? { state: msg } : {}) }),
        });
      } else {
        const f = new FormData();
        f.append('productId', d.product.id);
        f.append('angle', angle);
        f.append('originalName', file.name);
        f.append('file', file, file.name);
        await uploadXHR('/api/upload', f, {
          onProgress: (p, msg) => setJob(id, { progress: p, state: msg || t('up.job.uploading', { p: Math.round(p * 100) }) }),
        });
      }
      setJob(id, { progress: 1, state: t('up.job.done'), ok: true });
      load();
    } catch (e) {
      setJob(id, { state: t('up.job.failed', { e: tx(e.message) }), bad: true, retry: () => send(file, angle) });
    }
  }
  const onPick = (angle) => (e) => {
    [...e.target.files].forEach((f) => send(f, angle));
    e.target.value = '';
  };
  const onBulk = (e) => {
    const bad = [];
    for (const f of e.target.files) {
      const p = parseName(f.name, d.product);
      if (p.angle && p.skuOk) send(f, p.angle);
      else bad.push({ f, angle: p.angle || '', why: !p.skuOk ? t('up.why.sku') : t('up.why.angle') });
    }
    if (bad.length) setUnsorted((u) => [...u, ...bad]);
    e.target.value = '';
  };
  const pct = Math.round((done / req.length) * 100);

  return (
    <div className="upload fade-in">
      <button className="btn v-ghost s-sm" style={{ marginBottom: 8, marginLeft: -8 }} onClick={() => go('upload')}>
        <ArrowLeft size={15} />
        <span>{t('up.allSkus')}</span>
      </button>
      <div className="card up-hero">
        <div className="top">
          <div className="ring" style={{ '--p': pct }}>
            <span>
              {done}/{req.length}
            </span>
          </div>
          <div className="grow">
            <h1 style={{ fontSize: 20 }}>{d.product.sku}</h1>
            <div className="sm text-2 ellipsis">{d.product.name_zh || d.product.name}</div>
            <div className="xs muted mono">ASIN {d.product.asin || t('up.notSet')}</div>
          </div>
          <Badge tone={done === req.length ? 'success' : 'warning'}>{done === req.length ? t('up.complete') : t('up.left', { n: req.length - done })}</Badge>
        </div>
        {d.task?.notes && (
          <div className="callout t-warning up-note">
            <Pin size={15} />
            <span>{d.task.notes}</span>
          </div>
        )}
        <label className="saver-row">
          <span className="switch">
            <input type="checkbox" checked={saver} onChange={(e) => setSaver(e.target.checked)} />
            <span className="track" />
          </span>
          <span className="grow">
            <span className="t">
              <Wifi size={14} />
              {t('up.saver')}
            </span>
            <span className="d">
              {t('up.saver.desc')}
              {slow() ? t('up.saver.slow') : ''}
            </span>
          </span>
        </label>
      </div>

      <div className="slots-title">
        <h2>{t('up.slots')}</h2>
        <span className="xs muted">{t('up.slots.hint')}</span>
      </div>
      <div className="slots">
        {slots.map((a) => {
          const list = byAngle(a);
          const last = list[list.length - 1];
          const must = req.includes(a);
          const label = tx(meta.angles.find((x) => x.id === a)?.label);
          const job = jobs.find((j) => j.angle === a && !j.ok && !j.bad);
          return (
            <div key={a} className={'slot' + (last ? ' filled' : '') + (must ? ' must' : ' opt')}>
              <button className="slot-btn" onClick={() => pickRef.current[a].click()} aria-label={t('up.shootAria', { label })}>
                {last ? (
                  <img className="shot" src={last.thumb} alt={label} />
                ) : (
                  <span className="guide">
                    <AngleGlyph angle={a} size={54} />
                    <span className="cta">
                      <Camera size={13} />
                      {must ? t('up.shoot') : t('up.optional')}
                    </span>
                  </span>
                )}
                {must && !last && (
                  <span className="tag">
                    <Badge tone="accent">{t('up.required')}</Badge>
                  </span>
                )}
                {last && (
                  <span className="tag">
                    <Badge tone="neutral" className="solid-dark">
                      {t('up.count', { n: list.length })}
                      {last.original_received ? '' : t('up.origPending')}
                    </Badge>
                  </span>
                )}
                {last && (
                  <span className="ok">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
                {job && (
                  <span className="busy">
                    <Loader2 size={18} className="spin" />
                    {Math.round(job.progress * 100)}%<Progress value={job.progress} />
                  </span>
                )}
              </button>
              <input ref={(el) => (pickRef.current[a] = el)} type="file" accept="image/*" capture="environment" hidden onChange={onPick(a)} />
              <div className="slot-foot">
                <div className="grow">
                  <div className="name ellipsis">{short(label)}</div>
                  {label !== short(label) && <div className="sub ellipsis">{((m) => m?.[1] || m?.[2])(label.match(/（(.*)）| \((.*)\)/))}</div>}
                </div>
                <label className="fromalbum" title={t('up.album.title')}>
                  <ImagePlus size={14} />
                  {t('up.album')}
                  <input type="file" accept="image/*" multiple hidden onChange={onPick(a)} />
                </label>
              </div>
              {last?.warnings?.map((w, i) => (
                <div key={i} className="slot-warn">
                  <AlertTriangle size={12} style={{ flex: 'none', marginTop: 2 }} />
                  {tx(w)}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="card panel bulk">
        <div className="panel-head">
          <div>
            <h3>{t('up.bulk')}</h3>
            <div className="xs muted">{t('up.bulk.hint')}</div>
          </div>
          <label className="btn v-secondary s-md">
            <FolderUp size={16} />
            <span>{t('up.bulk.pick')}</span>
            <input type="file" accept="image/*" multiple hidden onChange={onBulk} />
          </label>
        </div>
        <div className="xs muted">
          {t('up.bulk.fmt1')}{' '}
          <code>
            {d.product.sku}_{t('up.bulk.fmtName')}.jpg
          </code>
          {t('up.bulk.fmt2')}
        </div>
      </div>

      {unsorted.length > 0 && (
        <div className="card panel">
          <div className="panel-head">
            <h3>{t('up.unsorted')}</h3>
            <Badge tone="warning">{unsorted.length}</Badge>
          </div>
          {unsorted.map((u, i) => (
            <div key={i} className="unsorted">
              <div className="ellipsis">
                <div className="sm ellipsis" style={{ fontWeight: 550 }}>
                  {u.f.name}
                </div>
                <div className="xs warning-text">{u.why}</div>
              </div>
              <select className="input" value={u.angle} onChange={(e) => setUnsorted(unsorted.map((x, k) => (k === i ? { ...x, angle: e.target.value } : x)))}>
                <option value="">{t('up.pickAngle')}</option>
                {meta.angles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {tx(a.label)}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                disabled={!u.angle}
                onClick={() => {
                  send(u.f, u.angle);
                  setUnsorted(unsorted.filter((_, k) => k !== i));
                }}
              >
                {t('up.upload')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {jobs.length > 0 && (
        <div className="card panel">
          <div className="panel-head">
            <h3>{t('up.queue')}</h3>
            <span className="xs muted">{t('up.queue.done', { ok: jobs.filter((j) => j.ok).length, n: jobs.length })}</span>
          </div>
          {jobs.map((j) => (
            <div key={j.id} className="job">
              <img src={j.preview} alt="" />
              <div className="grow">
                <div className="sm ellipsis">
                  <b>{short(meta.angles.find((a) => a.id === j.angle)?.label)}</b>
                  <span className="muted">
                    {' '}
                    · {j.name} · {fmtBytes(j.size)}
                  </span>
                </div>
                <div style={{ marginTop: 6 }}>
                  <Progress value={j.progress} tone={j.bad ? 'danger' : j.ok ? 'success' : 'accent'} />
                </div>
                <div className={'st small ' + (j.bad ? 'danger-text' : '')}>
                  {j.ok ? <CheckCircle2 size={12} className="success-text" /> : j.bad ? <XCircle size={12} /> : <Loader2 size={12} className="spin" />}
                  {j.state}
                </div>
              </div>
              {j.retry && (
                <Button
                  size="sm"
                  icon={RotateCw}
                  onClick={() => {
                    setJobs((js) => js.filter((x) => x.id !== j.id));
                    j.retry();
                  }}
                >
                  {t('common.retry')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="card panel">
        <div className="panel-head">
          <h3 className="row" style={{ gap: 6 }}>
            <Archive size={15} />
            {t('up.archive')}
          </h3>
          <span className="xs muted">{t('up.archive.n', { n: d.sources.length })}</span>
        </div>
        {d.sources.length ? (
          <div className="archive">
            {d.sources.map((s) => (
              <a key={s.id} href={s.originalUrl || s.url} target="_blank" rel="noreferrer">
                <img src={s.thumb} alt="" loading="lazy" />
                <small>{s.archive_name}</small>
              </a>
            ))}
          </div>
        ) : (
          <div className="sm muted">{t('up.archive.empty')}</div>
        )}
      </div>
      {nextMissing && (
        <div className="sticky-cta">
          <Button variant="primary" size="lg" icon={Camera} onClick={() => pickRef.current[nextMissing].click()}>
            {t('up.next', { label: short(meta.angles.find((a) => a.id === nextMissing)?.label) })}
          </Button>
        </div>
      )}
      <div style={{ height: nextMissing ? 72 : 0 }} />
    </div>
  );
}
