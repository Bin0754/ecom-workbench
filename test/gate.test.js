import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { listen } from './helpers.js';
import { installGate, _test } from '../server/gate.js';

const PW = 'correct horse battery';
let srv;
before(async () => {
  const app = express();
  installGate(app, express, PW);
  app.get('/api/ping', (req, res) => res.json({ ok: true }));
  app.get('/', (req, res) => res.send('home'));
  srv = await listen(app);
});
after(() => srv.close());

const post = (body) => fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('helpers: constant-time compare and open-redirect guard', () => {
  assert.equal(_test.safeEq('abc', 'abc'), true);
  assert.equal(_test.safeEq('abc', 'abd'), false);
  assert.equal(_test.safeEq('abc', 'abcd'), false);
  assert.equal(_test.safeNext('//evil.com'), '/');
  assert.equal(_test.safeNext('https://evil.com'), '/');
  assert.equal(_test.safeNext('/#/review'), '/#/review');
  assert.deepEqual(_test.parseCookies('a=1; b=%E0%A4%A'), { a: '1', b: '%E0%A4%A' });
});

test('API is blocked without a session; pages redirect to /login', async () => {
  assert.equal((await fetch(srv.base + '/api/ping')).status, 401);
  const r = await fetch(srv.base + '/', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/login/);
});

test('correct password issues an HttpOnly SameSite cookie that unlocks the API', async () => {
  const r = await post({ password: PW });
  assert.equal(r.status, 200);
  const c = r.headers.get('set-cookie');
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.doesNotMatch(c, new RegExp(PW));
  const cookie = c.split(';')[0];
  assert.equal((await fetch(srv.base + '/api/ping', { headers: { cookie } })).status, 200);
});

test('failed logins are rate-limited', async () => {
  let last;
  for (let i = 0; i < 11; i++) last = await post({ password: 'wrong' + i });
  assert.equal(last.status, 429);
  assert.equal((await post({ password: PW })).status, 429, 'even the right password is blocked while limited');
});
