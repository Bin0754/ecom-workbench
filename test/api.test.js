// API smoke test of the whole flow with the free mock adapter:
// create shoot task → phone upload → auto canvas + generation → designer submit → reviewer approve/reject →
// resubmission → Amazon ZIP export. Also covers the external-import (Grok) channel and upload hardening.
import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { listen, waitFor, client } from './helpers.js';
import { createApp } from '../server/app.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'demo-serum.jpg');
let srv, admin, photographer, designer, reviewer, pid;

before(async () => {
  srv = await listen(createApp());
  admin = client(srv.base, 'admin');
  photographer = client(srv.base, 'photographer');
  designer = client(srv.base, 'designer');
  reviewer = client(srv.base, 'reviewer');
});
after(() => srv.close());

const upload = (productId, angle, buf, name = 'IMG_0001.jpg', type = 'image/jpeg') => {
  const fd = new FormData();
  fd.append('productId', String(productId));
  fd.append('angle', angle);
  fd.append('originalName', name);
  fd.append('file', new Blob([buf], { type }), name);
  return photographer('/api/upload', { method: 'POST', body: fd });
};
const latest = async () => (await designer(`/api/products/${pid}`)).data.nodes.map((n) => ({ ...n.outputs[0], template_id: n.template_id, nodeId: n.id }));

test('meta + health', async () => {
  const m = await admin('/api/meta');
  assert.equal(m.status, 200);
  assert.ok(m.data.templates.length >= 11);
  assert.equal(m.data.defaultProvider, 'mock');
  assert.equal((await admin('/api/health')).data.ok, true);
  assert.equal((await admin('/api/nope')).status, 404);
});

test('create product: validation + roles', async () => {
  assert.equal((await photographer('/api/products', { method: 'POST', body: { sku: 'X', name: 'Y' } })).status, 403);
  assert.match((await admin('/api/products', { method: 'POST', body: { sku: '../evil', name: 'x' } })).data.error, /款号/);
  assert.match((await admin('/api/products', { method: 'POST', body: { sku: 'OK1', name: 'x', asin: 'bad' } })).data.error, /ASIN/);
  const r = await admin('/api/products', {
    method: 'POST',
    body: {
      sku: 'DEMO-VC30',
      asin: 'B0TESTVC30',
      name: 'DEMO Vitamin C Serum',
      brand: 'DEMO',
      size_spec: '30 ml / 1 fl oz',
      dimensions: 'H 10.5 cm × Ø 3.4 cm',
      ingredients: 'Vitamin C 15%|Helps skin look brighter\nHyaluronic Acid|Moisture',
      benefits: 'Visibly brighter-looking skin\nLightweight\nTreats acne',
      usage_steps: 'Cleanse\nApply 3 drops',
      box_contents: '1 × 30 ml bottle',
      angles: ['front'],
    },
  });
  assert.equal(r.status, 200);
  pid = r.data.id;
  assert.match((await admin('/api/products', { method: 'POST', body: { sku: 'DEMO-VC30', name: 'dup' } })).data.error, /已存在/);
});

test('upload hardening: non-images rejected, unknown angle rejected', async () => {
  const bad = await upload(pid, 'front', Buffer.from('<html><script>alert(1)</script></html>'), 'x.html', 'text/html');
  assert.equal(bad.status, 415);
  const fake = await upload(pid, 'front', Buffer.from('not really a jpeg'), 'x.jpg', 'image/jpeg');
  assert.equal(fake.status, 415);
  assert.match((await upload(pid, 'nope', fs.readFileSync(FIXTURE))).data.error, /未知角度/);
  assert.deepEqual(
    fs.readdirSync(path.join(process.env.WB_DATA_DIR, 'tmp')).filter((f) => !f.startsWith('thumbs')),
    [],
    'temp files cleaned up',
  );
});

test('phone upload auto-builds the canvas and generates every template (mock)', async () => {
  const r = await upload(pid, 'front', fs.readFileSync(FIXTURE));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.started >= 11);
  assert.match(r.data.source.archive_name, /^DEMO-VC30_front_01_\d{8}\.jpg$/);
  const outs = await waitFor(
    async () => {
      const l = await latest();
      return l.every((o) => o.status && o.status !== 'generating') && l;
    },
    { timeout: 180000 },
  );
  const failed = outs.filter((o) => o.status !== 'draft');
  assert.deepEqual(
    failed.map((o) => `${o.template_id}:${o.status}:${o.error}`),
    [],
  );
  const main = outs.find((o) => o.template_id === 'MAIN');
  const meta = await sharp(path.join(process.env.WB_DATA_DIR, decodeURIComponent(main.url.replace('/files/', '')))).metadata();
  assert.equal(meta.width, 2000);
  assert.equal(meta.height, 2000);
  const pc = Object.fromEntries(main.precheck.items.map((i) => [i.key, i.level]));
  assert.equal(pc.whiteBg, 'pass');
  const benefits = outs.find((o) => o.template_id === 'PT04');
  assert.ok(
    benefits.precheck.items.some((i) => i.key === 'compliance' && i.level === 'fail'),
    '"Treats acne" is flagged',
  );
});

test('files: only image folders are public; traversal blocked; thumbnails work', async () => {
  const outs = await latest();
  assert.equal((await fetch(srv.base + outs[0].url)).status, 200);
  assert.equal((await fetch(srv.base + '/files/workbench.db')).status, 404);
  assert.equal((await fetch(srv.base + '/files/grok_jobs/x.json')).status, 404);
  assert.equal((await fetch(srv.base + '/thumb/240/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await fetch(srv.base + '/thumb/240/workbench.db')).status, 404);
  const th = await fetch(srv.base + outs[0].thumb);
  assert.equal(th.status, 200);
  assert.equal(th.headers.get('x-content-type-options'), 'nosniff');
});

test('designer submits → reviewer rejects one and approves the rest → resubmit → export', async () => {
  assert.equal((await photographer(`/api/products/${pid}/submit-all`, { method: 'POST' })).status, 403);
  const s = await designer(`/api/products/${pid}/submit-all`, { method: 'POST' });
  assert.ok(s.data.submitted >= 11);
  const queue = (await reviewer('/api/review/queue')).data;
  const pt05 = queue.find((o) => o.template_id === 'PT05');
  assert.match((await reviewer(`/api/outputs/${pt05.id}/review`, { method: 'POST', body: { result: 'rejected' } })).data.error, /原因/);
  assert.equal(
    (await reviewer(`/api/outputs/${pt05.id}/review`, { method: 'POST', body: { result: 'rejected', reasons: ['光影不真实'], comment: 'too dark' } })).status,
    200,
  );
  const rest = queue.filter((o) => o.id !== pt05.id).map((o) => o.id);
  assert.equal((await reviewer('/api/review/batch-approve', { method: 'POST', body: { ids: rest } })).data.approved, rest.length);

  // designer regenerates the rejected node with a tweaked prompt and resubmits
  const node = (await latest()).find((o) => o.template_id === 'PT05');
  assert.equal((await designer(`/api/nodes/${node.nodeId}`, { method: 'PUT', body: { params: { scene: 'warm oak shelf' } } })).status, 200);
  const {
    data: { outputId },
  } = await designer(`/api/nodes/${node.nodeId}/generate`, { method: 'POST' });
  await waitFor(async () => (await latest()).find((o) => o.id === outputId)?.status === 'draft');
  assert.equal((await designer(`/api/outputs/${outputId}/submit`, { method: 'POST' })).status, 200);
  const q2 = (await reviewer('/api/review/queue')).data;
  assert.equal(q2.length, 1);
  assert.equal(q2[0].previous.status, 'rejected', 'reviewer sees the rejected version for comparison');
  assert.equal((await reviewer(`/api/outputs/${outputId}/review`, { method: 'POST', body: { result: 'approved' } })).status, 200);

  const lib = (await designer('/api/library')).data;
  const names = lib.find((p) => p.id === pid).assets.map((a) => a.exportName);
  assert.ok(names.includes('B0TESTVC30.MAIN.jpg'));
  assert.ok(names.includes('APLUS/B0TESTVC30.APLUS_HEADER_970x600.jpg'));

  const zip = await designer(`/api/products/${pid}/export/amazon`, { raw: true });
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  for (const n of ['B0TESTVC30.MAIN.jpg', 'B0TESTVC30.PT05.jpg', 'manifest.csv']) assert.ok(buf.includes(Buffer.from(n)), n);
});

test('external-import (Grok) channel: job is queued, background imported, composited at zero cost', async () => {
  const node = (await latest()).find((o) => o.template_id === 'PT01');
  assert.equal((await designer(`/api/nodes/${node.nodeId}`, { method: 'PUT', body: { provider_id: 'grok' } })).status, 200);
  const {
    data: { outputId },
  } = await designer(`/api/nodes/${node.nodeId}/generate`, { method: 'POST' });
  await waitFor(async () => (await latest()).find((o) => o.id === outputId)?.status === 'awaiting');
  const jobs = (await designer('/api/grok/jobs?status=pending')).data;
  const job = jobs.find((j) => j.outputId === outputId);
  assert.ok(job && job.prompt.includes('HARD CONSTRAINTS'));
  assert.equal((await fetch(`${srv.base}/api/grok/jobs/${outputId}/ref.png`)).status, 200);
  const bg = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#E9DCCB' } })
    .png()
    .toBuffer();
  assert.equal((await designer(`/api/grok/import/${outputId}`, { method: 'POST', body: bg, headers: { 'Content-Type': 'image/png' } })).status, 200);
  const done = await waitFor(async () => {
    const o = (await latest()).find((x) => x.id === outputId);
    return o?.status === 'draft' && o;
  });
  assert.equal(done.provider_id, 'grok');
  const costs = (await admin('/api/costs')).data;
  assert.ok(costs.rows.some((r) => r.output_id === outputId && r.amount_usd === 0));
});
