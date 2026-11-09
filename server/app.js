// HTTP API + static frontend. createApp() is used by server/index.js and by the test suite.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ZipArchive } from 'archiver';
import { q, q1, run, J, DATA, ROOT, PUBLIC_DIRS, toRel, toAbs, migrateAbsolutePaths } from './db.js';
import { config, log } from './config.js';
import { amazonName, csvRow, SKU_RE, ASIN_RE } from './exporter.js';
import { TEMPLATES, ANGLES, DEFAULT_ANGLES, PROMPTS_V1 } from './templates.js';
import { RULES } from './compliance.js';
import { installGate } from './gate.js';
import { seedProviders, listProviders, updateProvider, ADAPTERS } from './providers/index.js';
import {
  ensureGraph,
  generateNode,
  recoverInterrupted,
  queueStats,
  overlayTexts,
  defaultProvider,
  listGrokJobs,
  importGrokImage,
  GROK_DIR,
} from './pipeline.js';
import { promptVars, buildPrompt, PRODUCT_TYPES, inferProductType, SECTION_LABELS } from './prompts.js';

const REASONS = ['商品变形', '颜色偏差', 'logo/文字错', '背景不合规', '占比/构图', '光影不真实', '风格不统一', '文案错误', '宣称违规', '规格不符', '其他'];
const ROLES = [
  { id: 'photographer', label: '摄影' },
  { id: 'designer', label: '美工' },
  { id: 'reviewer', label: '审核' },
  { id: 'admin', label: '管理员' },
];

// Allowed upload formats (checked by extension AND by decoding with sharp).
const UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.tif', '.tiff', '.avif']);
const UPLOAD_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'tiff', 'avif']);
const safeExt = (name) => {
  const e = path.extname(String(name || '')).toLowerCase();
  return UPLOAD_EXT.has(e) ? e : '.jpg';
};
const httpError = (status, msg) => Object.assign(new Error(msg), { status });

let initialized = false;
export function initData() {
  if (initialized) return;
  initialized = true;
  migrateAbsolutePaths();
  seedProviders();
  for (const t of TEMPLATES)
    run(
      'INSERT INTO templates(id,name,slot,width,height,spec,prompt,sort) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,slot=excluded.slot,width=excluded.width,height=excluded.height,spec=excluded.spec,sort=excluded.sort',
      t.id,
      t.name,
      t.slot,
      t.width,
      t.height,
      JSON.stringify(t.spec),
      t.prompt,
      t.sort,
    );
  for (const t of TEMPLATES)
    if (PROMPTS_V1[t.id]) run("UPDATE templates SET prompt=? WHERE id=? AND (prompt=? OR prompt IS NULL OR prompt='')", t.prompt, t.id, PROMPTS_V1[t.id]);
  recoverInterrupted();
}

export function createApp() {
  initData();
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  installGate(app, express);
  app.use(express.json({ limit: '2mb' }));
  const upload = multer({
    dest: path.join(DATA, 'tmp'),
    limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1, fields: 20 },
    fileFilter: (req, file, cb) =>
      /^image\//.test(file.mimetype) || file.mimetype === 'application/octet-stream' ? cb(null, true) : cb(httpError(415, '只能上传图片文件')),
  });
  // Validate an uploaded temp file really is an image we can decode; delete it otherwise.
  async function checkImage(file) {
    try {
      const m = await sharp(file.path).metadata();
      if (!UPLOAD_FORMATS.has(m.format)) throw new Error('format');
      return m;
    } catch {
      fs.rmSync(file.path, { force: true });
      throw httpError(415, '无法识别的图片格式（支持 JPEG / PNG / WebP / TIFF / AVIF；HEIC 取决于服务器的 libvips 支持）');
    }
  }
  const who = (req) => decodeURIComponent(req.get('x-user') || '') || req.get('x-role') || 'anonymous';
  const role = (req) => req.get('x-role') || 'admin';
  const need =
    (...roles) =>
    (req, res, next) =>
      roles.includes(role(req))
        ? next()
        : res.status(403).json({ error: `当前角色无权限（需要：${roles.map((r) => ROLES.find((x) => x.id === r)?.label).join('/')}）` });
  const wrap = (fn) => (req, res) =>
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((e) => {
        if (req.file?.path) fs.rmSync(req.file.path, { force: true });
        const status = e.status || 400;
        if (status >= 500) log.error(e);
        else log.debug(e.message);
        if (!res.headersSent) res.status(status).json({ error: e.message });
      });

  const fileUrl = (p) => (p ? '/files/' + toRel(p).split('/').map(encodeURIComponent).join('/') : null);
  const thumbUrl = (p, w = 480) => (p ? `/thumb/${w}/` + toRel(p).split('/').map(encodeURIComponent).join('/') : null);

  function outputDto(o) {
    if (!o) return null;
    return {
      ...o,
      precheck: J(o.precheck),
      url: fileUrl(o.path),
      thumb: thumbUrl(o.path),
      reviews: q('SELECT * FROM reviews WHERE output_id=? ORDER BY id DESC', o.id).map((r) => ({ ...r, reasons: J(r.reasons, []) })),
    };
  }
  function sourceDto(s) {
    return s && { ...s, warnings: J(s.warnings, []), url: fileUrl(s.path), thumb: thumbUrl(s.path, 360), originalUrl: fileUrl(s.original_path) };
  }

  function productStatus(pid, task) {
    const srcs = q('SELECT angle FROM source_assets WHERE product_id=?', pid).map((s) => s.angle);
    const req = task ? J(task.angles, []) : [];
    const missing = req.filter((a) => !srcs.includes(a));
    if (!srcs.length) return { code: 'todo', label: '待拍摄', missing };
    const latest = q(
      'SELECT o.* FROM outputs o JOIN nodes n ON n.id=o.node_id WHERE n.product_id=? AND o.id=(SELECT MAX(id) FROM outputs WHERE node_id=o.node_id)',
      pid,
    );
    const approvedAny = q1("SELECT COUNT(*) c FROM outputs o JOIN nodes n ON n.id=o.node_id WHERE n.product_id=? AND o.status='approved'", pid).c;
    const st = latest.map((o) => o.status);
    let r;
    if (st.includes('generating')) r = { code: 'generating', label: '生成中' };
    else if (missing.length && !latest.length) r = { code: 'uploaded', label: '缺角度' };
    else if (st.length && st.every((s) => s === 'approved')) r = { code: 'done', label: '已入库' };
    else if (st.includes('pending')) r = { code: 'review', label: '待审核' };
    else if (st.includes('rejected')) r = { code: 'rejected', label: '已打回' };
    else if (approvedAny) r = { code: 'partial', label: '部分通过' };
    else r = { code: 'refine', label: '待精修' };
    return { ...r, missing };
  }

  // ---- 基础信息 ----
  app.get('/api/meta', (req, res) =>
    res.json({
      angles: ANGLES,
      defaultAngles: DEFAULT_ANGLES,
      roles: ROLES,
      reasons: REASONS,
      productTypes: Object.fromEntries(Object.entries(PRODUCT_TYPES).map(([k, v]) => [k, v.label])),
      sectionLabels: SECTION_LABELS,
      rules: RULES.map((r) => ({ ...r, re: r.re.source })),
      templates: q('SELECT * FROM templates ORDER BY sort').map((t) => ({ ...t, spec: J(t.spec) })),
      queue: queueStats(),
      defaultProvider: defaultProvider(),
    }),
  );

  // ---- 任务单 / 商品 ----
  app.get('/api/tasks', (req, res) => {
    const rows = q(
      'SELECT p.*, t.id task_id, t.angles, t.photographer, t.due_date, t.notes, t.created_at task_created FROM products p LEFT JOIN shoot_tasks t ON t.product_id=p.id ORDER BY p.id DESC',
    );
    res.json(
      rows.map((r) => {
        const cover = q1("SELECT path FROM source_assets WHERE product_id=? ORDER BY (angle='front') DESC, id LIMIT 1", r.id);
        return {
          ...r,
          angles: J(r.angles, []),
          status: productStatus(r.id, r.task_id ? { angles: r.angles } : null),
          cover: thumbUrl(cover?.path, 240),
          sourceCount: q1('SELECT COUNT(*) c FROM source_assets WHERE product_id=?', r.id).c,
          shotAngles: q('SELECT DISTINCT angle FROM source_assets WHERE product_id=?', r.id).map((x) => x.angle),
          nodeCount: q1('SELECT COUNT(*) c FROM nodes WHERE product_id=?', r.id).c,
          approvedCount: q1("SELECT COUNT(DISTINCT n.id) c FROM nodes n JOIN outputs o ON o.node_id=n.id WHERE n.product_id=? AND o.status='approved'", r.id).c,
          pendingCount: q1("SELECT COUNT(*) c FROM outputs o JOIN nodes n ON n.id=o.node_id WHERE n.product_id=? AND o.status='pending'", r.id).c,
        };
      }),
    );
  });

  const PFIELDS = [
    'sku',
    'asin',
    'name',
    'name_zh',
    'brand',
    'category',
    'size_spec',
    'dimensions',
    'ingredients',
    'benefits',
    'usage_steps',
    'box_contents',
    'scene',
    'product_type',
    'brand_colors',
    'audience',
    'palette',
  ];
  app.post(
    '/api/products',
    need('admin', 'designer'),
    wrap((req, res) => {
      const b = req.body;
      if (!b.sku || !b.name) throw new Error('款号和英文品名必填');
      if (!SKU_RE.test(b.sku)) throw new Error('款号只能包含字母、数字、点、下划线和短横线（最长 64 位）');
      if (b.asin && !ASIN_RE.test(b.asin)) throw new Error('ASIN 应为 10 位大写字母或数字');
      if (q1('SELECT id FROM products WHERE sku=?', b.sku)) throw new Error('款号已存在');
      const r = run(`INSERT INTO products(${PFIELDS.join(',')}) VALUES(${PFIELDS.map(() => '?').join(',')})`, ...PFIELDS.map((f) => b[f] ?? null));
      const pid = Number(r.lastInsertRowid);
      run(
        'INSERT INTO shoot_tasks(product_id,angles,photographer,due_date,notes,created_by) VALUES(?,?,?,?,?,?)',
        pid,
        JSON.stringify(b.angles?.length ? b.angles : DEFAULT_ANGLES),
        b.photographer || null,
        b.due_date || null,
        b.notes || null,
        who(req),
      );
      res.json({ id: pid });
    }),
  );
  app.put(
    '/api/products/:id',
    need('admin', 'designer'),
    wrap((req, res) => {
      const b = req.body;
      const f = PFIELDS.filter((k) => k in b && k !== 'sku');
      if (b.asin && !ASIN_RE.test(b.asin)) throw new Error('ASIN 应为 10 位大写字母或数字');
      if (f.length) run(`UPDATE products SET ${f.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...f.map((k) => b[k]), req.params.id);
      if (b.angles) run('UPDATE shoot_tasks SET angles=? WHERE product_id=?', JSON.stringify(b.angles), req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    '/api/products/:id',
    wrap((req, res) => {
      const p = q1('SELECT * FROM products WHERE id=?', req.params.id);
      if (!p) throw httpError(404, '商品不存在');
      const task = q1('SELECT * FROM shoot_tasks WHERE product_id=?', p.id);
      const nodes = q(
        'SELECT n.*, t.name tname, t.slot, t.width, t.height, t.spec, t.prompt tprompt FROM nodes n JOIN templates t ON t.id=n.template_id WHERE n.product_id=? ORDER BY t.sort',
        p.id,
      ).map((n) => {
        const params = J(n.params, {});
        const spec = J(n.spec, {});
        return {
          ...n,
          spec,
          params,
          pos: J(n.pos),
          effectivePrompt: n.prompt ?? n.tprompt,
          resolvedPrompt:
            spec.bg === 'generate'
              ? (() => {
                  const src = q1('SELECT angle, analysis FROM source_assets WHERE id=?', n.source_id);
                  return buildPrompt(n.prompt ?? n.tprompt, promptVars(p, params, { spec, angle: src?.angle, analysis: J(src?.analysis) }), spec);
                })()
              : '',
          texts: overlayTexts(spec.layout || 'none', p, params),
          outputs: q('SELECT * FROM outputs WHERE node_id=? ORDER BY version DESC', n.id).map(outputDto),
        };
      });
      res.json({
        productType: inferProductType(p),
        product: p,
        task: task && { ...task, angles: J(task.angles, []) },
        status: productStatus(p.id, task),
        sources: q('SELECT * FROM source_assets WHERE product_id=? ORDER BY id', p.id).map(sourceDto),
        nodes,
      });
    }),
  );
  app.delete(
    '/api/products/:id',
    need('admin'),
    wrap((req, res) => {
      run('DELETE FROM products WHERE id=?', req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- 上传：按槽位 / 文件名自动归档 ----
  app.post(
    '/api/upload',
    upload.single('file'),
    wrap(async (req, res) => {
      const { productId, angle } = req.body;
      const isPreview = req.body.preview === '1';
      const p = q1('SELECT * FROM products WHERE id=?', productId);
      if (!p) throw new Error('款号不存在');
      if (!ANGLES.find((a) => a.id === angle)) throw new Error('未知角度：' + angle);
      if (!req.file) throw new Error('没有收到文件');
      await checkImage(req.file);
      const task = q1('SELECT * FROM shoot_tasks WHERE product_id=?', p.id);
      const batch = new Date().toLocaleDateString('sv-SE', { timeZone: config.timeZone }).replace(/-/g, '');
      const seq = (q1('SELECT MAX(seq) s FROM source_assets WHERE product_id=? AND angle=?', p.id, angle)?.s || 0) + 1;
      const dir = path.join(DATA, 'sources', p.sku, batch);
      fs.mkdirSync(dir, { recursive: true });
      const ext = safeExt(req.body.originalName || req.file.originalname);
      const archive = `${p.sku}_${angle}_${String(seq).padStart(2, '0')}_${batch}`;
      // 统一转正方向（手机 EXIF 旋转）后存工作副本
      const work = path.join(dir, `${archive}${isPreview ? '_preview' : ''}.jpg`);
      const meta = await sharp(req.file.path).metadata();
      await sharp(req.file.path).rotate().jpeg({ quality: 95 }).toFile(work);
      const wm = await sharp(work).metadata();
      let original = null;
      if (!isPreview) {
        original = path.join(dir, `${archive}_original${ext}`);
        fs.renameSync(req.file.path, original);
      } else fs.unlinkSync(req.file.path);
      const warnings = [];
      const longEdge = Math.max(wm.width, wm.height);
      if (!isPreview && longEdge < 2000) warnings.push(`原片长边 ${longEdge}px，低于建议的 2000px，主图会被放大`);
      if (longEdge < 1000) warnings.push('分辨率过低，建议重拍');
      const stats = await sharp(work).stats();
      if (stats.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3 < 60) warnings.push('画面偏暗，建议补光重拍');
      if (stats.sharpness !== undefined && stats.sharpness < 0.6) warnings.push('画面可能模糊');
      const r = run(
        'INSERT INTO source_assets(product_id,task_id,angle,seq,batch,original_name,archive_name,path,original_path,original_received,width,height,bytes,warnings,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        p.id,
        task?.id ?? null,
        angle,
        seq,
        batch,
        req.body.originalName || req.file.originalname,
        archive + ext,
        toRel(work),
        toRel(original),
        isPreview ? 0 : 1,
        wm.width,
        wm.height,
        req.file.size,
        JSON.stringify(warnings),
        who(req),
      );
      const started = ensureGraph(p.id, who(req));
      res.json({
        source: sourceDto(q1('SELECT * FROM source_assets WHERE id=?', r.lastInsertRowid)),
        started: started.length,
        exifOrientation: meta.orientation || 1,
      });
    }),
  );
  // 省流模式：先传压缩版开始出图，原图随后补传，只做存档
  app.put(
    '/api/sources/:id/original',
    upload.single('file'),
    wrap(async (req, res) => {
      const s = q1('SELECT * FROM source_assets WHERE id=?', req.params.id);
      if (!s) throw httpError(404, '原片不存在');
      if (!req.file) throw new Error('没有收到文件');
      await checkImage(req.file);
      const ext = safeExt(req.file.originalname);
      const dest = path.join(path.dirname(toAbs(s.path)), `${s.archive_name.replace(/\.[^.]+$/, '')}_original${ext}`);
      fs.renameSync(req.file.path, dest);
      const m = await sharp(dest).rotate().metadata();
      const longEdge = Math.max(m.width, m.height);
      const warnings = J(s.warnings, []).filter((w) => !w.startsWith('原片长边'));
      if (longEdge < 2000) warnings.unshift(`原片长边 ${longEdge}px，低于建议的 2000px，主图会被放大`);
      run(
        'UPDATE source_assets SET original_path=?, original_received=1, bytes=?, warnings=? WHERE id=?',
        toRel(dest),
        req.file.size,
        JSON.stringify(warnings),
        s.id,
      );
      res.json({ ok: true });
    }),
  );
  app.delete(
    '/api/sources/:id',
    need('admin', 'photographer'),
    wrap((req, res) => {
      const used = q1('SELECT COUNT(*) c FROM nodes WHERE source_id=?', req.params.id).c;
      if (used) throw new Error('该原片已被画布节点使用，不能删除（原片只读存档）');
      run('DELETE FROM source_assets WHERE id=?', req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- 画布节点 ----
  app.put(
    '/api/nodes/:id',
    wrap((req, res) => {
      const b = req.body;
      const n = q1('SELECT * FROM nodes WHERE id=?', req.params.id);
      if (!n) throw httpError(404, '节点不存在');
      if ('pos' in b) run('UPDATE nodes SET pos=? WHERE id=?', JSON.stringify(b.pos), n.id);
      if (role(req) === 'photographer' || role(req) === 'reviewer') {
        if (Object.keys(b).some((k) => k !== 'pos')) throw new Error('当前角色不能修改节点');
        return res.json({ ok: true });
      }
      if ('prompt' in b) run('UPDATE nodes SET prompt=? WHERE id=?', b.prompt, n.id);
      if ('provider_id' in b) {
        if (!ADAPTERS[q1('SELECT type FROM providers WHERE id=?', b.provider_id)?.type]) throw new Error('未知通道');
        run('UPDATE nodes SET provider_id=? WHERE id=?', b.provider_id, n.id);
      }
      if ('source_id' in b) {
        if (!q1('SELECT id FROM source_assets WHERE id=? AND product_id=?', b.source_id, n.product_id)) throw new Error('原片不属于该款号');
        run('UPDATE nodes SET source_id=? WHERE id=?', b.source_id, n.id);
      }
      if ('params' in b) run('UPDATE nodes SET params=? WHERE id=?', JSON.stringify(b.params || {}), n.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/nodes/:id/generate',
    need('designer', 'admin'),
    wrap((req, res) => res.json({ outputId: generateNode(Number(req.params.id), who(req), { recomposite: !!req.body?.recomposite }) })),
  );
  app.post(
    '/api/products/:id/generate-all',
    need('designer', 'admin'),
    wrap((req, res) => {
      const ids = q('SELECT id FROM nodes WHERE product_id=?', req.params.id).map((n) => generateNode(n.id, who(req)));
      res.json({ started: ids.length });
    }),
  );
  app.post(
    '/api/products/:id/ensure',
    need('designer', 'admin'),
    wrap((req, res) => res.json({ started: ensureGraph(Number(req.params.id), who(req)).length })),
  );

  // ---- 提交审核 / 审核 ----
  app.post(
    '/api/outputs/:id/submit',
    need('designer', 'admin'),
    wrap((req, res) => {
      const o = q1('SELECT * FROM outputs WHERE id=?', req.params.id);
      if (!o || !['draft', 'rejected'].includes(o.status)) throw new Error('只有草稿可以提交审核');
      if (o.status === 'rejected') throw new Error('已打回的版本请修改后重新生成新版本再提交');
      run("UPDATE outputs SET status='pending', updated_at=datetime('now','localtime') WHERE id=?", o.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/products/:id/submit-all',
    need('designer', 'admin'),
    wrap((req, res) => {
      const r = run(
        "UPDATE outputs SET status='pending', updated_at=datetime('now','localtime') WHERE status='draft' AND id IN (SELECT MAX(o.id) FROM outputs o JOIN nodes n ON n.id=o.node_id WHERE n.product_id=? GROUP BY o.node_id)",
        req.params.id,
      );
      res.json({ submitted: Number(r.changes) });
    }),
  );
  app.get('/api/review/queue', (req, res) => {
    const rows = q(
      "SELECT o.*, n.template_id, n.source_id, n.product_id, t.name tname, t.slot, p.sku, p.asin, p.name pname FROM outputs o JOIN nodes n ON n.id=o.node_id JOIN templates t ON t.id=n.template_id JOIN products p ON p.id=n.product_id WHERE o.status='pending' ORDER BY p.id, t.sort",
    );
    res.json(
      rows.map((o) => {
        const prev = q1(
          "SELECT * FROM outputs WHERE node_id=? AND version<? AND status IN ('rejected','approved') ORDER BY version DESC LIMIT 1",
          o.node_id,
          o.version,
        );
        return { ...outputDto(o), source: sourceDto(q1('SELECT * FROM source_assets WHERE id=?', o.source_id)), previous: outputDto(prev) };
      }),
    );
  });
  app.post(
    '/api/outputs/:id/review',
    need('reviewer', 'admin'),
    wrap((req, res) => {
      const { result, reasons = [], comment = '' } = req.body;
      const o = q1('SELECT * FROM outputs WHERE id=?', req.params.id);
      if (!o || o.status !== 'pending') throw new Error('该图不在待审核状态');
      if (!['approved', 'rejected'].includes(result)) throw new Error('结果无效');
      if (result === 'rejected' && !reasons.length) throw new Error('打回请至少选择一个原因标签');
      run('INSERT INTO reviews(output_id,result,reasons,comment,reviewer) VALUES(?,?,?,?,?)', o.id, result, JSON.stringify(reasons), comment, who(req));
      run("UPDATE outputs SET status=?, updated_at=datetime('now','localtime') WHERE id=?", result, o.id);
      res.json({ ok: true });
    }),
  );
  app.post(
    '/api/review/batch-approve',
    need('reviewer', 'admin'),
    wrap((req, res) => {
      let n = 0;
      for (const id of req.body.ids || []) {
        const o = q1("SELECT * FROM outputs WHERE id=? AND status='pending'", id);
        if (!o) continue;
        run("INSERT INTO reviews(output_id,result,reasons,comment,reviewer) VALUES(?,'approved','[]','批量通过',?)", id, who(req));
        run("UPDATE outputs SET status='approved' WHERE id=?", id);
        n++;
      }
      res.json({ approved: n });
    }),
  );
  app.post(
    '/api/outputs/:id/void',
    need('admin'),
    wrap((req, res) => {
      run("UPDATE outputs SET status='void' WHERE id=? AND status='approved'", req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- 素材库 / 亚马逊导出 ----
  function approvedFor(pid) {
    // 每个模板取最新一个通过的版本
    return q(
      "SELECT o.*, n.template_id, t.name tname, t.slot, t.width tw, t.height th, t.sort FROM outputs o JOIN nodes n ON n.id=o.node_id JOIN templates t ON t.id=n.template_id WHERE n.product_id=? AND o.status='approved' AND o.id=(SELECT MAX(o2.id) FROM outputs o2 WHERE o2.node_id=o.node_id AND o2.status='approved') ORDER BY t.sort",
      pid,
    );
  }
  app.get('/api/library', (req, res) => {
    res.json(
      q('SELECT * FROM products ORDER BY id DESC')
        .map((p) => ({ ...p, assets: approvedFor(p.id).map((o) => ({ ...outputDto(o), exportName: amazonName(p.asin || p.sku, o) })) }))
        .filter((p) => p.assets.length),
    );
  });
  app.get(
    '/api/products/:id/export/amazon',
    wrap(async (req, res) => {
      const p = q1('SELECT * FROM products WHERE id=?', req.params.id);
      if (!p) throw httpError(404, '商品不存在');
      const assets = approvedFor(p.id);
      if (!assets.length) throw new Error('该款还没有审核通过的图');
      const id = p.asin || p.sku;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${id}_amazon_${Date.now()}.zip"`);
      const zip = new ZipArchive({ zlib: { level: 6 } });
      zip.pipe(res);
      const csv = [csvRow(['filename', 'asin', 'sku', 'slot', 'template', 'width', 'height', 'version', 'provider', 'model', 'approved_by'])];
      for (const o of assets) {
        const name = amazonName(id, o);
        zip.file(toAbs(o.path), { name });
        const rv = q1("SELECT reviewer FROM reviews WHERE output_id=? AND result='approved' ORDER BY id DESC", o.id);
        csv.push(csvRow([name, p.asin || '', p.sku, o.slot, o.template_id, o.width, o.height, o.version, o.provider_id, o.model, rv?.reviewer || '']));
        run('INSERT INTO downloads(product_id,output_id,kind,operator) VALUES(?,?,?,?)', p.id, o.id, 'amazon-zip', who(req));
      }
      zip.append(csv.join('\n'), { name: 'manifest.csv' });
      if (!p.asin) zip.append('该款未填写 ASIN，文件名暂用款号代替，上传亚马逊前请改为 ASIN。\n', { name: 'README_缺少ASIN.txt' });
      await zip.finalize();
    }),
  );
  app.get(
    '/api/outputs/:id/download',
    wrap((req, res) => {
      const o = q1(
        'SELECT o.*, n.product_id, n.template_id, t.slot, t.width tw, t.height th FROM outputs o JOIN nodes n ON n.id=o.node_id JOIN templates t ON t.id=n.template_id WHERE o.id=?',
        req.params.id,
      );
      if (!o?.path) throw new Error('文件不存在');
      const p = q1('SELECT * FROM products WHERE id=?', o.product_id);
      run('INSERT INTO downloads(product_id,output_id,kind,operator) VALUES(?,?,?,?)', p.id, o.id, 'single', who(req));
      res.download(toAbs(o.path), amazonName(p.asin || p.sku, o).replace('APLUS/', ''));
    }),
  );

  // ---- 设置：模型通道 / 模板 / 成本 ----
  // Grok 生图（内置）：待出图任务列表 / 参考图 / 导入背景
  app.get('/api/grok/jobs', (req, res) => res.json(listGrokJobs(req.query.status)));
  app.get('/api/grok/jobs/:id/ref.png', (req, res) => {
    const f = path.join(GROK_DIR, `${Number(req.params.id)}_ref.png`);
    if (!fs.existsSync(f)) return res.status(404).end();
    res.sendFile(f);
  });
  app.post(
    '/api/grok/import/:id',
    need('designer', 'admin'),
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '25mb' }),
    wrap(async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new Error('请以图片二进制上传（Content-Type: image/png 或 image/jpeg）');
      res.json(await importGrokImage(Number(req.params.id), req.body, who(req)));
    }),
  );
  app.get('/api/providers', (req, res) => res.json(listProviders()));
  app.put(
    '/api/providers/:id',
    need('admin'),
    wrap((req, res) => {
      updateProvider(req.params.id, req.body || {});
      res.json({ ok: true });
    }),
  );
  app.put(
    '/api/templates/:id',
    need('admin'),
    wrap((req, res) => {
      run('UPDATE templates SET prompt=? WHERE id=?', req.body.prompt ?? '', req.params.id);
      res.json({ ok: true });
    }),
  );
  app.get('/api/costs', (req, res) => {
    res.json({
      rows: q('SELECT c.*, p.sku FROM cost_ledger c LEFT JOIN products p ON p.id=c.product_id ORDER BY c.id DESC LIMIT 300'),
      byProvider: q(
        'SELECT provider_id, model, COUNT(*) calls, SUM(ok) ok_calls, ROUND(SUM(amount_usd),4) usd, ROUND(AVG(duration_ms)) avg_ms FROM cost_ledger GROUP BY provider_id, model',
      ),
      byProduct: q('SELECT p.sku, COUNT(*) calls, ROUND(SUM(c.amount_usd),4) usd FROM cost_ledger c JOIN products p ON p.id=c.product_id GROUP BY p.sku'),
      downloads: q('SELECT d.*, p.sku FROM downloads d LEFT JOIN products p ON p.id=d.product_id ORDER BY d.id DESC LIMIT 50'),
    });
  });

  // ---- 文件与缩略图 ----
  // Only image folders are public; the SQLite DB, job queue, tmp and exports are never served.
  for (const d of PUBLIC_DIRS) app.use(`/files/${d}`, express.static(path.join(DATA, d), { maxAge: '1h', fallthrough: false, dotfiles: 'deny', index: false }));
  app.use('/files', (req, res) => res.status(404).end());
  app.get(
    /^\/thumb\/(\d+)\/(.+)$/,
    wrap(async (req, res) => {
      const w = Math.max(32, Math.min(1200, Number(req.params[0])));
      let rel;
      try {
        rel = decodeURIComponent(req.params[1]);
      } catch {
        return res.status(400).end();
      }
      const src = path.resolve(DATA, rel);
      const top = path.relative(DATA, src).split(path.sep)[0];
      if (!PUBLIC_DIRS.includes(top) || !src.startsWith(DATA + path.sep) || !fs.existsSync(src)) return res.status(404).end();
      const cache = path.join(DATA, 'tmp', 'thumbs', `${w}_${rel.replace(/[\\/]/g, '__')}.webp`);
      if (!fs.existsSync(cache) || fs.statSync(cache).mtimeMs < fs.statSync(src).mtimeMs) {
        fs.mkdirSync(path.dirname(cache), { recursive: true });
        await sharp(src).rotate().resize(w, w, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(cache);
      }
      res.set('Cache-Control', 'public, max-age=3600');
      res.sendFile(cache);
    }),
  );

  app.get('/api/health', (req, res) => res.json({ ok: true, queue: queueStats() }));
  app.use('/api', (req, res) => res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` }));

  // ---- 前端 ----
  const dist = path.join(ROOT, 'web', 'dist');
  app.use(express.static(dist));
  app.get(/^\/(?!api|files|thumb).*/, (req, res) =>
    fs.existsSync(path.join(dist, 'index.html'))
      ? res.sendFile(path.join(dist, 'index.html'))
      : res.status(503).send('Frontend not built yet: run `npm run build`（前端尚未构建）'),
  );

  // Last-resort error handler (multer limits, malformed JSON, etc.).
  app.use((err, req, res, next) => {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) log.error(err);
    res
      .status(status)
      .json({ error: status === 413 ? `文件太大（上限 ${config.uploadMaxMb} MB）` : err.expose === false || status >= 500 ? '服务器内部错误' : err.message });
  });
  return app;
}
