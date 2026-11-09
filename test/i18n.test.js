// i18n: the zh and en dictionaries must stay in sync, every literal t('key') in the web app must exist, and Chinese text
// produced by the server (errors, statuses, template names, precheck results…) must have an English translation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zh from '../shared/i18n/zh.js';
import en from '../shared/i18n/en.js';
import { t, localize, pickLang } from '../shared/i18n/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u4e00-\u9fff]/;
const vars = (s) => [...s.matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort();
const files = (dir, re) =>
  fs
    .readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => re.test(f))
    .map((f) => path.join(ROOT, dir, f));

test('zh and en dictionaries have identical keys', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
});

test('every entry is non-empty and uses the same {placeholders} in both languages', () => {
  for (const k of Object.keys(zh)) {
    assert.ok(zh[k] && en[k], `empty value for ${k}`);
    if (k === 'srv.err.enableKey') continue; // zh repeats the env var name in parentheses
    assert.deepEqual(vars(en[k]), vars(zh[k]), `placeholder mismatch for ${k}`);
  }
});

test('English strings contain no Chinese characters', () => {
  const bad = Object.entries(en).filter(([k, v]) => CJK.test(v) && !k.startsWith('lang.'));
  assert.deepEqual(bad, []);
});

test("every literal t('key') used in the web app exists", () => {
  const missing = new Set();
  for (const f of files('web/src', /\.(js|jsx)$/)) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([\w.]*\w)'\s*[,)]/g)) if (!(m[1] in zh)) missing.add(`${path.basename(f)}: ${m[1]}`);
  }
  assert.deepEqual([...missing], []);
});

test('the web app has no hard-coded Chinese UI text', () => {
  const hits = [];
  for (const f of files('web/src', /\.(js|jsx)$/)) {
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // Upload.jsx keeps Chinese angle aliases so files named like SKU_正面_1.jpg are recognized.
        if (CJK.test(line) && !/^\s*(\/\/|\w+: \[)/.test(line)) hits.push(`${path.basename(f)}:${i + 1}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('Chinese messages thrown by the server have English translations', () => {
  const missing = [];
  for (const f of files('server', /\.js$/)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:new Error|httpError\(\d+,)\s*\(?\s*'([^']*[\u4e00-\u9fff][^']*)'(\s*\+)?/g)) {
      const msg = m[1] + (m[2] ? 'x' : ''); // 'prefix：' + detail → test with a sample detail
      if (localize('en', msg) === msg) missing.push(`${path.basename(f)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('server data labels (angles, templates, roles, reasons, rules) translate', async () => {
  const { ANGLES, TEMPLATES } = await import('../server/templates.js');
  const { RULES } = await import('../server/compliance.js');
  const { PRODUCT_TYPES } = await import('../server/prompts.js');
  const labels = [
    ...ANGLES.map((a) => a.label),
    ...TEMPLATES.map((x) => x.name),
    ...RULES.flatMap((r) => [r.msg, r.fix]),
    ...Object.entries(PRODUCT_TYPES)
      .filter(([k]) => k !== 'other')
      .map(([, v]) => v.label),
  ];
  const untranslated = labels.filter((s) => CJK.test(s) && CJK.test(localize('en', s)));
  assert.deepEqual(untranslated, []);
});

test('localize fills placeholders recursively and leaves other text alone', () => {
  assert.equal(localize('en', '2000×1500，要求 2000×2000'), '2000×1500, required 2000×2000');
  assert.equal(
    localize('en', '「Treats eczema」@画面文案2：提及皮肤疾病（痘痘治疗在美国属 OTC 药品）；建议：删除疾病名称，改为外观描述'),
    '"Treats eczema" @ Copy line 2: Mentions a skin disease (acne treatment is an OTC drug in the US). Suggestion: Remove the disease name; describe appearance',
  );
  assert.equal(localize('en', '当前角色无权限（需要：美工/管理员）'), 'Your role is not allowed to do this (requires: Designer/Admin)');
  assert.equal(localize('en', 'LUMA Vitamin C Serum'), 'LUMA Vitamin C Serum');
  assert.equal(localize('zh', '商品变形'), '商品变形');
  assert.equal(t('en', 'role.forbidden', { role: 'Reviewer' }), 'The "Reviewer" role cannot use this page');
  assert.equal(pickLang(['fr-FR', 'zh-TW']), 'zh');
  assert.equal(pickLang(['fr']), null);
});
