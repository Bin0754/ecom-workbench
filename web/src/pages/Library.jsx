import { useEffect, useState } from 'react';
import { Download, ExternalLink, Search, FileArchive, Images } from 'lucide-react';
import { api, session } from '../api.js';
import { useApp } from '../App.jsx';
import { t, tx } from '../i18n.js';
import { Badge, Button, Empty, PageHeader, SkeletonList } from '../ui.jsx';

export default function Library() {
  const { notify } = useApp();
  const [rows, setRows] = useState(null);
  const [kw, setKw] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    api('/api/library')
      .then(setRows)
      .catch((e) => notify(e.message, true));
  }, []);
  const dl = (url, key) => {
    // Download with role headers so the server can log who downloaded
    setBusy(key);
    fetch(url, { headers: { 'x-role': session.role, 'x-user': encodeURIComponent(session.user || session.role) } })
      .then(async (r) => {
        if (!r.ok) throw new Error(tx((await r.json()).error));
        const name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/)?.[1] || 'download');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob());
        a.download = name;
        a.click();
        notify(t('lib.downloading', { name }));
      })
      .catch((e) => notify(e.message, true))
      .finally(() => setBusy(null));
  };
  const list = (rows || []).filter((p) => !kw || [p.sku, p.asin, p.name, p.name_zh].join(' ').toLowerCase().includes(kw.toLowerCase()));
  const total = (rows || []).reduce((a, p) => a + p.assets.length, 0);
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow={t('lib.eyebrow')}
        title={t('nav.library')}
        desc={t('lib.desc') + (rows ? t('lib.desc.count', { skus: rows.length, n: total }) : '')}
      />
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder={t('tasks.search')} value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
      </div>
      {!rows ? (
        <SkeletonList n={2} h={260} />
      ) : !list.length ? (
        <div className="card">
          <Empty icon={Images} title={rows.length ? t('tasks.nomatch.title') : t('lib.empty.title')}>
            {rows.length ? t('lib.nomatch.desc') : t('lib.empty.desc')}
          </Empty>
        </div>
      ) : (
        list.map((p) => (
          <section className="card lib-group" key={p.id}>
            <div className="lib-head">
              <div className="thumb">
                <img src={p.assets[0]?.thumb} alt="" />
              </div>
              <div className="grow">
                <b>{p.sku}</b>
                <div className="sm text-2 ellipsis">{p.name}</div>
                <div className="row wrap" style={{ marginTop: 4, gap: 6 }}>
                  <span className="xs mono muted">ASIN {p.asin || t('lib.noAsin')}</span>
                  <Badge tone="success">{t('lib.approvedN', { n: p.assets.length })}</Badge>
                </div>
              </div>
              <Button
                variant="primary"
                icon={FileArchive}
                loading={busy === 'zip' + p.id}
                onClick={() => dl(`/api/products/${p.id}/export/amazon`, 'zip' + p.id)}
              >
                {t('lib.export')}
              </Button>
            </div>
            <div className="lib-grid">
              {p.assets.map((a) => (
                <div className="tile" key={a.id}>
                  <div className="img">
                    <img src={a.thumb} alt={tx(a.tname)} loading="lazy" />
                    <span className="slotname">
                      <Badge className="solid-dark">{a.slot === 'APLUS' ? 'A+' : a.slot}</Badge>
                    </span>
                    {a.provider_id === 'mock' && (
                      <span className="mockflag">
                        <Badge tone="warning">{t('lib.mock')}</Badge>
                      </span>
                    )}
                    <button className="icon-btn m-dl" title={t('lib.download')} onClick={() => dl(`/api/outputs/${a.id}/download`, a.id)}>
                      <Download size={16} />
                    </button>
                    <div className="hover">
                      <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" title={t('lib.view')}>
                        <ExternalLink size={16} />
                      </a>
                      <button className="icon-btn" title={t('lib.download')} onClick={() => dl(`/api/outputs/${a.id}/download`, a.id)}>
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="cap">
                    <div className="fn" title={a.exportName}>
                      {a.exportName.replace('APLUS/', '')}
                    </div>
                    <div className="sub">
                      {tx(a.tname)} · {a.width}×{a.height}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
