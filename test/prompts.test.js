import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, fillVars, promptVars, inferProductType, splitSections, hardConstraints, PROMPTS_V2, ingredientInfo } from '../server/prompts.js';
import { TEMPLATES } from '../server/templates.js';

const serum = {
  name: 'LUMA Vitamin C Serum',
  brand: 'LUMA',
  ingredients: 'Vitamin C 15%|Brighter look\nHyaluronic Acid|Moisture',
  benefits: 'Visibly brighter-looking skin\nLightweight',
};

test('fillVars replaces known vars and keeps unknown ones', () => {
  assert.equal(fillVars('a {x} b {y}', { x: 1 }), 'a 1 b {y}');
  assert.equal(fillVars(null, {}), '');
});

test('inferProductType picks a form from name / explicit type', () => {
  assert.equal(inferProductType(serum), 'serum_dropper');
  assert.equal(inferProductType({ name: 'Hydra Barrier Cream' }), 'cream_jar');
  assert.equal(inferProductType({ name: 'Gentle Foam Cleanser' }), 'tube');
  assert.equal(inferProductType({ name: 'Thing', product_type: 'toner_bottle' }), 'toner_bottle');
  assert.equal(inferProductType({ name: 'Thing' }), 'other');
});

test('ingredients map to props and palette', () => {
  const i = ingredientInfo(serum);
  assert.match(i.props[0], /orange/);
  assert.match(i.palette, /apricot/);
  assert.equal(i.hero, 'Vitamin C, Hyaluronic Acid');
});

test('every generative template has a v2 sectioned prompt', () => {
  for (const t of TEMPLATES.filter((x) => x.spec.bg === 'generate')) {
    assert.ok(PROMPTS_V2[t.id], t.id);
    const names = splitSections(PROMPTS_V2[t.id]).map((s) => s.name);
    for (const sec of ['PURPOSE', 'SUBJECT']) assert.ok(names.includes(sec), `${t.id} has ${sec}`);
  }
});

test('buildPrompt resolves all variables and appends hard constraints', () => {
  for (const t of TEMPLATES.filter((x) => x.spec.bg === 'generate')) {
    const vars = promptVars(serum, {}, { spec: t.spec, angle: 'front', analysis: { colors: ['dark amber'], light: 'left' } });
    const p = buildPrompt(t.prompt, vars, t.spec);
    assert.doesNotMatch(p, /\{\w+\}/, `${t.id} has unresolved {var}`);
    assert.match(p, /## HARD CONSTRAINTS/);
    assert.match(p, /No text, letters, numbers, logos/);
    assert.ok(p.includes('LUMA Vitamin C Serum'));
  }
});

test('hard constraints reserve the text zone only for layouts with text', () => {
  assert.match(hardConstraints({}, { layout: 'ingredients' }), /text is overlaid there later/);
  assert.doesNotMatch(hardConstraints({}, { layout: 'none' }), /text is overlaid there later/);
});

test('designer params override derived vars', () => {
  const v = promptVars(serum, { palette: 'mint', scene: 'wooden shelf' }, { spec: {} });
  assert.equal(v.palette, 'mint');
  assert.equal(v.scene, 'wooden shelf');
});
