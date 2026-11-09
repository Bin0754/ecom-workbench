import http from 'node:http';

/** Start an express app (or any request handler) on a random port. */
export function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler).listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${srv.address().port}`;
      resolve({
        base,
        close: () =>
          new Promise((r) => {
            srv.closeAllConnections?.();
            srv.close(r);
          }),
      });
    });
  });
}

export async function waitFor(fn, { timeout = 120000, interval = 500 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Tiny JSON client with role headers. */
export function client(base, role = 'admin', extra = {}) {
  return async (path, { method = 'GET', body, headers = {}, raw = false } = {}) => {
    const h = { 'x-role': role, 'x-user': encodeURIComponent(`test-${role}`), ...extra, ...headers };
    let payload = body;
    if (body && !(body instanceof FormData) && !Buffer.isBuffer(body) && typeof body !== 'string') {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
    if (raw) return res;
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
}
