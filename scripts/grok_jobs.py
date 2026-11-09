# External-import ("Grok") channel helper. Works with any image tool: list pending jobs, print a prompt, import a result.
#   python3 scripts/grok_jobs.py enqueue <SKU> <tpl,tpl,...>   switch nodes to the external channel and queue jobs
#   python3 scripts/grok_jobs.py list [pending|imported]        list jobs (reference image path, aspect ratio, prompt length)
#   python3 scripts/grok_jobs.py prompt <outputId>              print the full prompt of a job
#   python3 scripts/grok_jobs.py import <outputId> <image>      import a generated background and wait for compositing
# Env: WB_URL (default http://localhost:5180), WB_ACCESS_PASSWORD when the access gate is on.
import sys, json, time, urllib.request, urllib.error, hmac, hashlib, os
B = os.environ.get('WB_URL', 'http://localhost:' + os.environ.get('PORT', '5180'))
_pw = os.environ.get('WB_ACCESS_PASSWORD', '')
_pwf = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.access_password')
if not _pw and os.path.exists(_pwf): _pw = open(_pwf).read().strip()
# Same derivation as server/gate.js (HMAC-SHA256 of a fixed label keyed by the password).
COOKIE = ('wb_session=' + hmac.new(_pw.encode(), b'ecom-workbench-session-v1', hashlib.sha256).hexdigest()) if _pw else ''
H = {'x-role': 'designer', 'x-user': 'external-import', **({'Cookie': COOKIE} if COOKIE else {})}
def req(u, body=None, method='GET', raw=None, ctype='application/json'):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(B + u, data=data, method=method, headers={**H, 'Content-Type': ctype})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: sys.exit(f'{e.code} {e.read().decode()[:300]}')
def outputs(pid): return {o['id']: o for n in req(f'/api/products/{pid}')['nodes'] for o in n['outputs']}
cmd = sys.argv[1]
if cmd == 'enqueue':
    sku, tpls = sys.argv[2], sys.argv[3].split(',')
    pid = next(t for t in req('/api/tasks') if t['sku'] == sku)['id']
    nodes = {n['template_id']: n for n in req(f'/api/products/{pid}')['nodes']}
    for t in tpls:
        if t not in nodes: print(t, '无节点（缺原片）'); continue
        n = nodes[t]
        if n['provider_id'] != 'grok': req(f"/api/nodes/{n['id']}", {'provider_id': 'grok'}, 'PUT')
        oid = req(f"/api/nodes/{n['id']}/generate", {}, 'POST')['outputId']
        for _ in range(60):
            o = outputs(pid)[oid]
            if o['status'] != 'generating': break
            time.sleep(1)
        print(t, oid, o['status'], o.get('error') or '')
elif cmd == 'list':
    for j in req('/api/grok/jobs' + (f'?status={sys.argv[2]}' if len(sys.argv) > 2 else '')):
        print(j['outputId'], j['sku'], j['template'], j['status'], j['aspect_ratio'], j['reference_image'], len(j['prompt']))
elif cmd == 'prompt':
    print(next(j for j in req('/api/grok/jobs') if j['outputId'] == int(sys.argv[2]))['prompt'])
elif cmd == 'import':
    oid, f = int(sys.argv[2]), sys.argv[3]
    job = req(f'/api/grok/import/{oid}', method='POST', raw=open(f, 'rb').read(), ctype='image/png' if f.endswith('.png') else 'image/jpeg')
    pid = next(t for t in req('/api/tasks') if t['sku'] == job['sku'])['id']
    for _ in range(120):
        o = outputs(pid)[oid]
        if o['status'] != 'generating': break
        time.sleep(1)
    print(job['template'], oid, o['status'], o.get('model'), o.get('path') or '', (o.get('error') or '')[:300])
