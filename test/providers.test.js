import './setup-env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { listen } from './helpers.js';
import httpAdapter, { renderTemplate, buildHeaders } from '../server/providers/http.js';
import comfy, { parseTarget, applyInputs, pickOutputImage } from '../server/providers/comfyui.js';
import fal from '../server/providers/fal.js';
import mock from '../server/providers/mock.js';
import { seedProviders, updateProvider, listProviders, defaultProvider } from '../server/providers/index.js';
import { getPath, toImageBuffer } from '../server/providers/util.js';

const png = (w = 64, h = 64, c = '#c8b4a0') =>
  sharp({ create: { width: w, height: h, channels: 3, background: c } })
    .png()
    .toBuffer();
const readBody = (req) =>
  new Promise((r) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => r(Buffer.concat(ch)));
  });
const servers = [];
after(() => Promise.all(servers.map((s) => s.close())));

test('getPath / toImageBuffer', async () => {
  assert.equal(getPath({ data: [{ b64_json: 'x' }] }, 'data[0].b64_json'), 'x');
  assert.equal(getPath({ a: { b: 1 } }, 'a.b'), 1);
  const b = await png();
  assert.deepEqual(await toImageBuffer(b.toString('base64')), b);
  assert.deepEqual(await toImageBuffer('data:image/png;base64,' + b.toString('base64')), b);
});

test('renderTemplate keeps types for exact placeholders and escapes strings safely', () => {
  const out = renderTemplate('{"prompt":"{{prompt}}","n":"{{width}}","s":"size={{size}}","nested":{"img":"{{image_b64}}"}}', {
    prompt: 'say "hi"\nnow',
    width: 1024,
    size: '1024x1024',
    image_b64: 'AAA',
  });
  assert.deepEqual(out, { prompt: 'say "hi"\nnow', n: 1024, s: 'size=1024x1024', nested: { img: 'AAA' } });
  assert.throws(() => renderTemplate('{bad json', {}), /JSON/);
});

test('HTTP adapter: key only from a WB_HTTP_* env var', () => {
  assert.throws(() => buildHeaders({ authHeader: 'Authorization: Bearer {{key}}', keyEnv: 'OPENAI_API_KEY' }, { OPENAI_API_KEY: 'sk-x' }), /WB_HTTP_/);
  assert.throws(() => buildHeaders({ authHeader: 'Authorization: Bearer {{key}}', keyEnv: 'WB_HTTP_K' }, {}), /未设置环境变量/);
  assert.equal(buildHeaders({ authHeader: 'Authorization: Bearer {{key}}', keyEnv: 'WB_HTTP_K' }, { WB_HTTP_K: 'abc' }).Authorization, 'Bearer abc');
});

test('HTTP adapter end-to-end against a mock image API (b64 JSON + URL results)', async () => {
  const img = await png(32, 32);
  let seen;
  const srv = await listen(async (req, res) => {
    if (req.url === '/img.png') {
      res.setHeader('Content-Type', 'image/png');
      return res.end(img);
    }
    seen = { headers: req.headers, body: JSON.parse(await readBody(req)) };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(req.url === '/url' ? { images: [{ url: `http://${req.headers.host}/img.png` }] } : { data: [{ b64_json: img.toString('base64') }] }),
    );
  });
  servers.push(srv);
  process.env.WB_HTTP_TEST_KEY = 'test-key-123';
  const config = {
    endpoint: srv.base + '/gen',
    keyEnv: 'WB_HTTP_TEST_KEY',
    authHeader: 'Authorization: Bearer {{key}}',
    bodyTemplate: '{"prompt":"{{prompt}}","image":"{{image_data_url}}","w":"{{width}}"}',
    resultPath: 'data[0].b64_json',
    pricePerImage: 0.02,
  };
  const r = await httpAdapter.generate({ prompt: 'a "quoted" scene', image: img, size: '1024x768', config });
  assert.deepEqual(r.buffer, img);
  assert.equal(r.cost, 0.02);
  assert.equal(seen.headers.authorization, 'Bearer test-key-123');
  assert.equal(seen.body.prompt, 'a "quoted" scene');
  assert.equal(seen.body.w, 1024);
  assert.match(seen.body.image, /^data:image\/png;base64,/);
  const r2 = await httpAdapter.generate({
    prompt: 'p',
    image: img,
    size: '64x64',
    config: { ...config, endpoint: srv.base + '/url', resultPath: 'images[0].url' },
  });
  assert.deepEqual(r2.buffer, img);
  delete process.env.WB_HTTP_TEST_KEY;
});

test('ComfyUI helpers', () => {
  assert.deepEqual(parseTarget('6.text'), { node: '6', input: 'text' });
  assert.equal(parseTarget(''), null);
  assert.throws(() => parseTarget('six'), /节点ID/);
  const wf = { 6: { inputs: { text: '' } }, 3: { inputs: { seed: 1 } } };
  const out = applyInputs(wf, [
    [parseTarget('6.text'), 'hello'],
    [parseTarget('3.seed'), 42],
    [null, 'x'],
  ]);
  assert.equal(out[6].inputs.text, 'hello');
  assert.equal(out[3].inputs.seed, 42);
  assert.equal(wf[6].inputs.text, '', 'original untouched');
  assert.throws(() => applyInputs(wf, [[parseTarget('9.text'), 'x']]), /没有节点 9/);
  assert.deepEqual(pickOutputImage({ outputs: { 9: { images: [{ filename: 'a.png', type: 'output' }] } } }), { filename: 'a.png', type: 'output' });
});

test('ComfyUI adapter end-to-end against a mock ComfyUI server', async () => {
  const img = await png(40, 40, '#123456');
  const state = { uploads: [], prompt: null, polls: 0 };
  const srv = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Content-Type', 'application/json');
    if (u.pathname === '/upload/image') {
      const b = await readBody(req);
      const name = /filename="([^"]+)"/.exec(b.toString('latin1'))[1];
      state.uploads.push(name);
      return res.end(JSON.stringify({ name, subfolder: '', type: 'input' }));
    }
    if (u.pathname === '/prompt') {
      state.prompt = JSON.parse(await readBody(req)).prompt;
      return res.end(JSON.stringify({ prompt_id: 'p1', number: 1 }));
    }
    if (u.pathname === '/history/p1') {
      state.polls++;
      return res.end(
        JSON.stringify(
          state.polls < 2
            ? {}
            : {
                p1: {
                  status: { status_str: 'success', completed: true },
                  outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
                },
              },
        ),
      );
    }
    if (u.pathname === '/view') {
      res.setHeader('Content-Type', 'image/png');
      return res.end(img);
    }
    res.statusCode = 404;
    res.end('{}');
  });
  servers.push(srv);
  const workflow = {
    3: { class_type: 'KSampler', inputs: { seed: 0 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    10: { class_type: 'LoadImage', inputs: { image: '' } },
    9: { class_type: 'SaveImage', inputs: {} },
  };
  const r = await comfy.generate({
    prompt: 'marble counter',
    image: await png(),
    seed: 7,
    size: '1024x1024',
    config: { baseUrl: srv.base, workflowJson: JSON.stringify(workflow), promptNode: '6.text', imageNode: '10.image', seedNode: '3.seed' },
  });
  assert.deepEqual(r.buffer, img);
  assert.equal(state.prompt[6].inputs.text, 'marble counter');
  assert.equal(state.prompt[3].inputs.seed, 7);
  assert.equal(state.prompt[10].inputs.image, state.uploads[0]);
  assert.equal(r.cost, 0);
});

test('fal adapter never falls back to OPENAI_API_KEY', async () => {
  process.env.OPENAI_API_KEY = 'sk-should-not-be-used';
  try {
    assert.equal(fal.keyPresent(), false);
    await assert.rejects(fal.generate({ prompt: 'x', image: await png(), size: '1024x1024' }), /FAL_KEY/);
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test('mock adapter returns an image of the requested size at zero cost', async () => {
  const r = await mock.generate({ prompt: 'bathroom vanity', size: '256x128' });
  const m = await sharp(r.buffer).metadata();
  assert.equal(m.width, 256);
  assert.equal(m.height, 128);
  assert.equal(r.cost, 0);
});

test('provider settings: secrets and key-receiving URLs cannot be set from the web', () => {
  seedProviders();
  assert.throws(() => updateProvider('openai', { config: { apiKey: 'sk-x' } }), /环境变量/);
  assert.throws(() => updateProvider('openai', { config: { baseUrl: 'https://evil.example' } }), /环境变量/);
  assert.throws(() => updateProvider('http', { config: { authHeader: 'Authorization: Bearer sk-literal-secret-value' } }), /\{\{key\}\}/);
  assert.throws(() => updateProvider('fal', { enabled: true }), /FAL_KEY/);
  assert.throws(() => updateProvider('openai', { enabled: true }), /OPENAI_API_KEY/);
  updateProvider('comfyui', { enabled: true, config: { baseUrl: 'http://127.0.0.1:8188' } });
  const list = listProviders();
  assert.equal(list.find((p) => p.id === 'comfyui').enabled, true);
  assert.equal(list.find((p) => p.id === 'fal').keyPresent, false);
  assert.ok(!('baseUrl' in list.find((p) => p.id === 'openai').config));
  assert.equal(defaultProvider(), 'mock'); // built-in default when WB_DEFAULT_PROVIDER is unset
});
