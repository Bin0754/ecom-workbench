import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amazonName, csvRow, csvCell, SKU_RE, ASIN_RE } from '../server/exporter.js';
import { TEMPLATES } from '../server/templates.js';

test('Amazon gallery naming: ASIN.SLOT.jpg', () => {
  assert.equal(amazonName('B0TESTVC30', { slot: 'MAIN', template_id: 'MAIN', tw: 2000, th: 2000 }), 'B0TESTVC30.MAIN.jpg');
  assert.equal(amazonName('B0TESTVC30', { slot: 'PT05', template_id: 'PT05', tw: 2000, th: 2000 }), 'B0TESTVC30.PT05.jpg');
});

test('A+ naming goes into APLUS/ with size suffix', () => {
  assert.equal(amazonName('B0X', { slot: 'APLUS', template_id: 'APLUS_HEADER', tw: 970, th: 600 }), 'APLUS/B0X.APLUS_HEADER_970x600.jpg');
});

test('template pack: unique ids, gallery slots map 1:1, Amazon sizes', () => {
  const ids = TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  const gallery = TEMPLATES.filter((t) => t.slot !== 'APLUS');
  assert.equal(new Set(gallery.map((t) => t.slot)).size, gallery.length, 'no two gallery templates share a slot');
  for (const t of gallery) assert.ok(Math.max(t.width, t.height) >= 1000, `${t.id} zoomable`);
  const main = TEMPLATES.find((t) => t.id === 'MAIN');
  assert.equal(main.spec.bg, 'white');
  assert.equal(main.spec.product.fill, 0.85);
});

test('CSV cells are escaped (RFC 4180)', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvRow(['x', 1, 'y,z']), 'x,1,"y,z"');
});

test('SKU / ASIN validation blocks path tricks', () => {
  for (const ok of ['LUMA-VC30', 'A1', 'sku_01.v2']) assert.ok(SKU_RE.test(ok), ok);
  for (const bad of ['../etc', 'a/b', '.hidden', '', 'a\\b', 'x'.repeat(65)]) assert.ok(!SKU_RE.test(bad), bad);
  assert.ok(ASIN_RE.test('B0TESTVC30'));
  assert.ok(!ASIN_RE.test('b0testvc30'));
});
