#!/usr/bin/env node
// Seed demo data through the HTTP API (the server must be running: `npm start` or `npm run dev`).
//   npm run seed                      → creates the demo products from scripts/seed_products.json
//   npm run seed -- --no-photos       → products only (no uploads, no generation)
// Demo photos are taken from samples/<SKU>_<angle>_<nn>.jpg when present, otherwise the synthetic test fixture is
// uploaded as the front shot. NOTE: some demo copy deliberately contains non-compliant claims (e.g. "Treats eczema",
// "Boosts collagen") so you can see the FDA/Amazon precheck flag them.
// Env: WB_URL (default http://localhost:$PORT or 5180), WB_ACCESS_PASSWORD (if the gate is on).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.WB_URL || `http://localhost:${process.env.PORT || 5180}`;
const noPhotos = process.argv.includes('--no-photos');
let cookie = '';

async function call(p, { method = 'GET', body, form } = {}) {
  const headers = { 'x-role': 'admin', 'x-user': 'seed', ...(cookie ? { cookie } : {}) };
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status });
  return d;
}

async function main() {
  try {
    await fetch(BASE + '/api/health');
  } catch {
    console.error(`Server not reachable at ${BASE}. Start it first: npm start`);
    process.exit(1);
  }
  if (process.env.WB_ACCESS_PASSWORD) {
    const r = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: process.env.WB_ACCESS_PASSWORD }),
    });
    if (!r.ok) throw new Error('login failed');
    cookie = r.headers.get('set-cookie').split(';')[0];
  }
  const products = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'seed_products.json'), 'utf8'));
  const existing = new Map((await call('/api/tasks')).map((t) => [t.sku, t.id]));
  const samples = fs.existsSync(path.join(ROOT, 'samples')) ? fs.readdirSync(path.join(ROOT, 'samples')) : [];
  for (const p of products) {
    let id = existing.get(p.sku);
    if (id) console.log(`= ${p.sku} already exists (#${id})`);
    else {
      id = (await call('/api/products', { method: 'POST', body: p })).id;
      console.log(`+ ${p.sku} created (#${id})`);
    }
    if (noPhotos) continue;
    let photos = samples
      .filter((f) => f.startsWith(p.sku + '_') && /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => ({ file: path.join(ROOT, 'samples', f), angle: f.slice(p.sku.length + 1).split('_')[0] }));
    if (!photos.length && p === products[0]) photos = [{ file: path.join(ROOT, 'test', 'fixtures', 'demo-serum.jpg'), angle: 'front' }];
    for (const ph of photos) {
      const fd = new FormData();
      fd.append('productId', String(id));
      fd.append('angle', ph.angle);
      fd.append('originalName', path.basename(ph.file));
      fd.append('file', new Blob([fs.readFileSync(ph.file)], { type: 'image/jpeg' }), path.basename(ph.file));
      const r = await call('/api/upload', { method: 'POST', form: fd });
      console.log(`  ↑ ${path.basename(ph.file)} as ${ph.angle} → ${r.started} node(s) started`);
    }
  }
  console.log(`Done. Open ${BASE}/#/canvas`);
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
