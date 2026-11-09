import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, checkTexts } from '../server/compliance.js';

const hit = (text) => checkTexts([{ field: 'f', text }]).map((h) => h.rule);

test('every rule has id, level, regex, message and fix', () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(r.id && !ids.has(r.id), `unique id ${r.id}`);
    ids.add(r.id);
    assert.ok(['high', 'medium', 'low'].includes(r.level));
    assert.ok(r.re instanceof RegExp && r.msg && r.fix);
  }
  assert.ok(RULES.length >= 15);
});

test('flags drug / disease claims', () => {
  assert.ok(hit('Treats eczema-prone skin').includes('drug-treat'));
  assert.ok(hit('Treats eczema-prone skin').includes('disease'));
  assert.ok(hit('Cures acne overnight').includes('drug-cure'));
  assert.ok(hit('Boosts collagen production').includes('structure'));
  assert.ok(hit('SPF 30 sun protection').includes('sunscreen'));
  assert.ok(hit('FDA approved formula').includes('medical'));
});

test('flags Amazon-forbidden promo and superlatives', () => {
  assert.ok(hit('Only $19.99 today').includes('promo'));
  assert.ok(hit('20% off this week').includes('promo'));
  assert.ok(hit('#1 best seller').includes('superlative'));
});

test('does not flag compliant cosmetic copy', () => {
  for (const ok of [
    'Helps skin look brighter and more even',
    'Lightweight, fast-absorbing',
    'Fragrance-free formula',
    'Visibly smoother-looking skin',
    'Gentle daily cleanse',
  ]) {
    assert.deepEqual(hit(ok), [], ok);
  }
});

test('skips empty fields and reports field + match', () => {
  const r = checkTexts([
    { field: 'a', text: '' },
    { field: 'headline', text: 'Miracle cream' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].field, 'headline');
  assert.equal(r[0].match.toLowerCase(), 'miracle');
});
