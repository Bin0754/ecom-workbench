import './setup-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DATA_DIR } from './setup-env.js';
import { trimmedProduct, placeProduct, overlayTexts, precheck } from '../server/pipeline.js';
import { TEMPLATES } from '../server/templates.js';

// A synthetic transparent "bottle": 200x400 opaque rectangle inside a 600x600 transparent canvas.
async function fakeCutout() {
  const p = path.join(DATA_DIR, 'fake_cut.png');
  const bottle = await sharp({ create: { width: 200, height: 400, channels: 4, background: { r: 120, g: 70, b: 30, alpha: 1 } } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: bottle, left: 150, top: 100 }])
    .png()
    .toFile(p);
  return p;
}

test('trimmedProduct crops to the opaque bounding box', async () => {
  const prod = await trimmedProduct(await fakeCutout());
  assert.equal(prod.w, 200);
  assert.equal(prod.h, 400);
});

test('MAIN placement: longest side fills 85% and is centred', async () => {
  const prod = await trimmedProduct(await fakeCutout());
  const main = TEMPLATES.find((t) => t.id === 'MAIN');
  const pl = await placeProduct(prod, 2000, 2000, main.spec);
  assert.equal(pl.h, 1700);
  assert.equal(pl.w, 850);
  assert.equal(pl.left, Math.round(1000 - 850 / 2));
  assert.equal(pl.top, 150);
});

test('layout placement respects maxW and bottom anchor', async () => {
  const wide = {
    buf: await sharp({ create: { width: 800, height: 200, channels: 4, background: '#888' } })
      .png()
      .toBuffer(),
    w: 800,
    h: 200,
  };
  const spec = { product: { cx: 0.5, cy: 0.5, h: 0.5, maxW: 0.3 } };
  const pl = await placeProduct(wide, 1000, 1000, spec);
  assert.equal(pl.w, 300);
  assert.equal(pl.top + pl.h, 750, 'base stays at cy + h/2');
});

test('overlayTexts: designer params override defaults; text comes from product data', () => {
  const p = { name: 'X Serum', ingredients: 'A|aa\nB|bb', benefits: 'One\nTwo', usage_steps: 's1\ns2' };
  assert.deepEqual(overlayTexts('ingredients', p).items, ['A|aa', 'B|bb']);
  assert.equal(overlayTexts('howto', p).headline, 'HOW TO USE');
  assert.equal(overlayTexts('benefits', p, { headline: 'Custom' }).headline, 'Custom');
  assert.deepEqual(overlayTexts('inbox', p).items, ['1 × X Serum']);
});

test('precheck: pure-white MAIN at 85% passes; compliance hits fail', async () => {
  const main = { ...TEMPLATES.find((t) => t.id === 'MAIN') };
  main.spec = JSON.stringify(main.spec);
  const f = path.join(DATA_DIR, 'main.jpg');
  const prod = await sharp({ create: { width: 850, height: 1700, channels: 3, background: '#7a4a20' } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: prod, left: 575, top: 150 }])
    .jpeg({ quality: 95 })
    .toFile(f);
  const ok = await precheck(f, main, { texts: [{ field: 't', text: 'Lightweight serum' }] });
  const by = Object.fromEntries(ok.items.map((i) => [i.key, i.level]));
  assert.equal(by.size, 'pass');
  assert.equal(by.whiteBg, 'pass');
  assert.equal(by.fill85, 'pass');
  assert.equal(by.compliance, 'pass');
  const bad = await precheck(f, main, { texts: [{ field: 't', text: 'Cures eczema' }] });
  assert.equal(bad.overall, 'fail');
  fs.rmSync(f);
});
