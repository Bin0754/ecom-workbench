import { useEffect, useState } from 'react';
import { Download, ExternalLink, Search, FileArchive, Images } from 'lucide-react';
import { api, session } from '../api.js';
import { useApp } from '../App.jsx';
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
    // 带角色头下载，便于记录下载人
    setBusy(key);
    fetch(url, { headers: { 'x-role': session.role, 'x-user': encodeURIComponent(session.user || session.role) } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        const name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/)?.[1] || 'download');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await r.blob());
        a.download = name;
        a.click();
        notify('已开始下载 ' + name);
      })
      .catch((e) => notify(e.message, true))
      .finally(() => setBusy(null));
  };
  const list = (rows || []).filter((p) => !kw || [p.sku, p.asin, p.name, p.name_zh].join(' ').toLowerCase().includes(kw.toLowerCase()));
  const total = (rows || []).reduce((a, p) => a + p.assets.length, 0);
  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="交付"
        title="素材库"
        desc={`只收审核通过的最终版本，按亚马逊命名规范一键导出。${rows ? `共 ${rows.length} 个款号 · ${total} 张图。` : ''}`}
      />
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder="搜索款号、ASIN 或品名" value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
      </div>
      {!rows ? (
        <SkeletonList n={2} h={260} />
      ) : !list.length ? (
        <div className="card">
          <Empty icon={Images} title={rows.length ? '没有匹配的款号' : '素材库还是空的'}>
            {rows.length ? '换个关键词试试。' : '审核通过的图会自动出现在这里，可以单张下载或整款导出亚马逊 zip。'}
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
                  <span className="xs mono muted">ASIN {p.asin || '未填（导出时用款号代替）'}</span>
                  <Badge tone="success">{p.assets.length} 张已通过</Badge>
                </div>
              </div>
              <Button
                variant="primary"
                icon={FileArchive}
                loading={busy === 'zip' + p.id}
                onClick={() => dl(`/api/products/${p.id}/export/amazon`, 'zip' + p.id)}
              >
                导出亚马逊 zip
              </Button>
            </div>
            <div className="lib-grid">
              {p.assets.map((a) => (
                <div className="tile" key={a.id}>
                  <div className="img">
                    <img src={a.thumb} alt={a.tname} loading="lazy" />
                    <span className="slotname">
                      <Badge className="solid-dark">{a.slot === 'APLUS' ? 'A+' : a.slot}</Badge>
                    </span>
                    {a.provider_id === 'mock' && (
                      <span className="mockflag">
                        <Badge tone="warning">模拟</Badge>
                      </span>
                    )}
                    <button className="icon-btn m-dl" title="下载" onClick={() => dl(`/api/outputs/${a.id}/download`, a.id)}>
                      <Download size={16} />
                    </button>
                    <div className="hover">
                      <a className="icon-btn" href={a.url} target="_blank" rel="noreferrer" title="查看原图">
                        <ExternalLink size={16} />
                      </a>
                      <button className="icon-btn" title="下载" onClick={() => dl(`/api/outputs/${a.id}/download`, a.id)}>
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="cap">
                    <div className="fn" title={a.exportName}>
                      {a.exportName.replace('APLUS/', '')}
                    </div>
                    <div className="sub">
                      {a.tname} · {a.width}×{a.height}
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
