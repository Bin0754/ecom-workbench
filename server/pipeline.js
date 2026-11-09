// 出图流水线：抠图 → 商品层 → 背景（白底/纯色/模型生成）→ 原图商品贴回 → 排版叠字 → 预检
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { removeBackground } from '@imgly/background-removal-node';
import { q, q1, run, J, DATA, toRel, toAbs } from './db.js';
import { config, log } from './config.js';
import { getProvider, defaultProvider } from './providers/index.js';
import { fetchBilledCost } from './providers/fal.js';
import { checkTexts } from './compliance.js';
import { promptVars, buildPrompt, fillVars, analyzeCutout } from './prompts.js';
import { PROMPTS_V1 } from './templates.js';
import { pickRatio, GROK_RATIOS } from './providers/grok.js';

const FONT = "'Noto Sans','DejaVu Sans',sans-serif";
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const lines = (s) =>
  String(s || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

// ---------- 抠图（本地 ONNX 模型，确定性，不经过生图模型） ----------
const cutoutLocks = new Map();
export async function getCutout(source) {
  const out = path.join(DATA, 'cutouts', `${source.id}.png`);
  if (fs.existsSync(out)) return out;
  if (cutoutLocks.has(source.id)) return cutoutLocks.get(source.id);
  const p = (async () => {
    const t0 = Date.now();
    const blob = await removeBackground('file://' + toAbs(source.path), { model: 'medium', output: { format: 'image/png' } });
    fs.writeFileSync(out, Buffer.from(await blob.arrayBuffer()));
    run(
      'INSERT INTO cost_ledger(product_id,provider_id,model,op,amount_usd,duration_ms,ok,operator) VALUES(?,?,?,?,?,?,?,?)',
      source.product_id,
      'local',
      'imgly-bg-removal-medium',
      'removeBg',
      0,
      Date.now() - t0,
      1,
      'system',
    );
    return out;
  })().finally(() => cutoutLocks.delete(source.id));
  cutoutLocks.set(source.id, p);
  return p;
}

// 取透明商品层并裁掉四周空白
export async function trimmedProduct(cutPath) {
  const { data, info } = await sharp(cutPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width,
    y0 = info.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 100) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) throw new Error('抠图失败：没有识别到商品主体');
  // 清掉极淡的残留像素，避免白底上出现灰边
  for (let i = 3; i < data.length; i += 4) if (data[i] < 24) data[i] = 0;
  const buf = await sharp(data, { raw: info })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png()
    .toBuffer();
  return { buf, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export async function placeProduct(prod, W, H, spec) {
  let tw, th;
  if (spec.product.fill) {
    // 主图：最长边占画面 fill 比例
    const k = Math.min((W * spec.product.fill) / prod.w, (H * spec.product.fill) / prod.h);
    tw = Math.round(prod.w * k);
    th = Math.round(prod.h * k);
  } else {
    th = Math.round(H * spec.product.h);
    tw = Math.round((prod.w * th) / prod.h);
    const maxW = W * (spec.product.maxW ?? 0.8);
    if (tw > maxW) {
      tw = Math.round(maxW);
      th = Math.round((prod.h * tw) / prod.w);
    }
  }
  const cx = spec.product.cx ?? 0.5,
    cy = spec.product.cy ?? 0.5;
  const left = Math.round(W * cx - tw / 2);
  // 底部对齐到原定位置（商品「站」在同一高度），主图仍居中
  const top = spec.product.fill ? Math.round(H * cy - th / 2) : Math.round(H * (cy + spec.product.h / 2) - th);
  const layer = await sharp(prod.buf).resize(tw, th).png().toBuffer();
  return { layer, left: Math.max(0, left), top: Math.max(0, top), w: tw, h: th };
}

async function shadowFor(pl, W, H) {
  const sh = Math.max(8, Math.round(pl.h * 0.06));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b"><feGaussianBlur stdDeviation="${Math.round(sh / 2)}"/></filter></defs>
    <ellipse cx="${pl.left + pl.w / 2}" cy="${pl.top + pl.h - sh * 0.15}" rx="${pl.w * 0.52}" ry="${sh}" fill="#000" opacity="0.22" filter="url(#b)"/></svg>`;
  return Buffer.from(svg);
}

// 贴回原图商品时做融合：边缘收 1px 并羽化（去黑边/白边），按模型重绘的同位置商品做轻度色温/曝光匹配（±8% 内），
// 边缘一圈混入少量模糊背景（light wrap），再加一层贴地接触阴影。商品像素本身（标签文字、形状）不改动。
async function harmonize(pl, baseBuf, W, H) {
  const { data: P, info } = await sharp(pl.layer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height,
    N = w * h;
  const rw = Math.min(w, W - pl.left),
    rh = Math.min(h, H - pl.top);
  const bgR = await sharp(baseBuf)
    .removeAlpha()
    .extract({ left: pl.left, top: pl.top, width: rw, height: rh })
    .extend({ right: w - rw, bottom: h - rh, extendWith: 'copy' })
    .raw()
    .toBuffer();
  const raw1 = { raw: { width: w, height: h, channels: 1 } };
  const bgBlur = await sharp(bgR, { raw: { width: w, height: h, channels: 3 } })
    .blur(Math.max(2, w / 60))
    .raw()
    .toBuffer();
  const alpha = Buffer.alloc(N);
  for (let i = 0; i < N; i++) alpha[i] = P[i * 4 + 3];
  const s = Math.max(1, Math.round(Math.max(w, h) / 700));
  const aEdge = await sharp(alpha, raw1)
    .erode(s)
    .blur(0.5 + s * 0.6)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const inner = await sharp(alpha, raw1)
    .erode(s * 5)
    .blur(s * 4)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const sp = [0, 0, 0],
    sb = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < N; i++)
    if (inner[i] > 230) {
      n++;
      for (let c = 0; c < 3; c++) {
        sp[c] += P[i * 4 + c];
        sb[c] += bgR[i * 3 + c];
      }
    }
  const g = [1, 1, 1];
  if (n > 500) for (let c = 0; c < 3; c++) g[c] = Math.min(1.08, Math.max(0.92, Math.pow((sb[c] + 1) / (sp[c] + 1), 0.35)));
  const out = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    const a = Math.min(alpha[i], aEdge[i]);
    const wrap = 0.38 * (1 - inner[i] / 255) * (a / 255);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(P[i * 4 + c] * g[c] * (1 - wrap) + bgBlur[i * 3 + c] * wrap)));
    out[i * 4 + 3] = a;
  }
  const layer = await sharp(out, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
  return { ...pl, layer, gains: g.map((x) => +x.toFixed(3)) };
}

// 模型常常无视遮罩把商品「重画」得略大/略偏，贴回原位后模型那只会从边缘露出来（重影）。
// 这里在模型背景里找它画的那只商品（模板匹配：缩放+平移），找到就把原图商品贴到同一位置/大小，正好盖住它。
async function tmpl(prod, w, h) {
  const { data, info } = await sharp(prod.buf).resize(Math.max(4, w), Math.max(4, h)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 220) px.push(x, y, data[i], data[i + 1], data[i + 2]);
    }
  return { w: info.width, h: info.height, px };
}
function mad(img, iw, ih, t, ox, oy, step = 1) {
  let s = 0,
    n = 0;
  const p = t.px;
  for (let k = 0; k < p.length; k += 5 * step) {
    const x = ox + p[k],
      y = oy + p[k + 1];
    if (x < 0 || y < 0 || x >= iw || y >= ih) {
      s += 255;
      n++;
      continue;
    }
    const i = (y * iw + x) * 3;
    s += Math.abs(img[i] - p[k + 2]) + Math.abs(img[i + 1] - p[k + 3]) + Math.abs(img[i + 2] - p[k + 4]);
    n++;
  }
  return n ? s / n / 3 : 1e9;
}
export async function alignToModel(prod, pl, baseBuf, W, H) {
  const f = 256 / W,
    sw = 256,
    sh = Math.round(H * f);
  const small = await sharp(baseBuf).removeAlpha().resize(sw, sh, { fit: 'fill' }).raw().toBuffer();
  const t0 = await tmpl(prod, Math.round(pl.w * f), Math.round(pl.h * f));
  const orig = mad(small, sw, sh, t0, Math.round(pl.left * f), Math.round(pl.top * f));
  let best = { score: orig, s: 1, x: Math.round(pl.left * f), y: Math.round(pl.top * f) };
  const R = Math.round(sw * 0.15);
  for (let s = 0.7; s <= 1.351; s += 0.05) {
    const t = await tmpl(prod, Math.round(pl.w * s * f), Math.round(pl.h * s * f));
    const cx = pl.left * f + (pl.w * f) / 2,
      by = (pl.top + pl.h) * f;
    const bx = Math.round(cx - t.w / 2),
      byy = Math.round(by - t.h);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (byy + dy + t.h > sh + 1 || byy + dy < -1 || bx + dx < -1 || bx + dx + t.w > sw + 1) continue; // 不允许挪到画面外（会被裁切）
        const sc = mad(small, sw, sh, t, bx + dx, byy + dy, 2);
        if (sc < best.score) best = { score: sc, s, x: bx + dx, y: byy + dy };
      }
  }
  const info = { orig: +orig.toFixed(1), best: +best.score.toFixed(1), scale: +best.s.toFixed(2) };
  // 只有「模型确实在别处画了这只商品」（匹配明显优于原位且误差足够小）才挪
  if (!(best.score < orig * 0.6 && best.score < 35) || (best.s === 1 && best.x === Math.round(pl.left * f) && best.y === Math.round(pl.top * f)))
    return { pl, info: { ...info, moved: false } };
  // 全分辨率细化
  const full = await sharp(baseBuf).removeAlpha().raw().toBuffer();
  let fb = { score: 1e9 };
  for (let s = best.s - 0.04; s <= best.s + 0.041; s += 0.01) {
    const tw = Math.round(pl.w * s),
      th = Math.round(pl.h * s);
    const t = await tmpl(prod, tw, th);
    const cx0 = best.x / f + (pl.w * best.s) / 2,
      by0 = best.y / f + pl.h * best.s;
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const x = Math.round(cx0 - tw / 2) + dx,
          y = Math.round(by0 - th) + dy;
        const sc = mad(full, W, H, t, x, y, 3);
        if (sc < fb.score) fb = { score: sc, s, x, y, tw, th };
      }
  }
  const left = Math.max(0, Math.min(W - 1, fb.x)),
    top = Math.max(0, Math.min(H - 1, fb.y));
  const layer = await sharp(prod.buf).resize(fb.tw, fb.th).png().toBuffer();
  return { pl: { layer, left, top, w: fb.tw, h: fb.th }, info: { ...info, moved: true, fine: +fb.score.toFixed(1), left, top, w: fb.tw, h: fb.th } };
}

function contactShadow(pl, W, H) {
  const ry = Math.max(4, Math.round(pl.h * 0.018));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="c"><feGaussianBlur stdDeviation="${Math.max(2, Math.round(ry * 0.7))}"/></filter></defs>
    <ellipse cx="${pl.left + pl.w / 2}" cy="${pl.top + pl.h - ry * 0.6}" rx="${pl.w * 0.44}" ry="${ry}" fill="#1a1410" opacity="0.38" filter="url(#c)"/></svg>`;
  return Buffer.from(svg);
}

// ---------- 提示词变量 ----------
export { promptVars, fillVars } from './prompts.js';

// ---------- 排版引擎：所有文字由程序叠加 ----------
export function overlayTexts(layout, product, params = {}) {
  const ing = lines(product.ingredients).map((l) => {
    const [n, d] = l.split('|');
    return { n: n?.trim(), d: d?.trim() || '' };
  });
  const ben = lines(product.benefits),
    steps = lines(product.usage_steps),
    box = lines(product.box_contents);
  const D = {
    ingredients: { headline: 'KEY INGREDIENTS', sub: product.name, items: ing.slice(0, 4).map((i) => `${i.n}|${i.d}`) },
    howto: { headline: 'HOW TO USE', sub: product.name, items: steps.slice(0, 4) },
    texture: {
      headline: 'SILKY, LIGHTWEIGHT TEXTURE',
      sub: params.texture ? `A ${params.texture} that absorbs quickly` : 'Absorbs quickly with no sticky finish',
      items: [],
    },
    benefits: { headline: 'WHY YOU WILL LOVE IT', sub: 'For cosmetic use. Individual results may vary.', items: ben.slice(0, 4) },
    size: { headline: product.size_spec || '', sub: product.dimensions || '', items: [] },
    inbox: { headline: "WHAT'S IN THE BOX", sub: '', items: box.length ? box : [`1 × ${product.name}`] },
    aplus_header: { headline: (product.brand || '').toUpperCase(), sub: product.name, items: ben.slice(0, 1) },
    aplus_banner: { headline: ben[0] || product.name, sub: '', items: [] },
    none: { headline: '', sub: '', items: [] },
  }[layout] || { headline: '', sub: '', items: [] };
  return {
    headline: params.headline ?? D.headline,
    sub: params.sub ?? D.sub,
    items: params.items ? lines(params.items) : D.items,
  };
}

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const out = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
function tspanBlock(x, y, text, size, maxChars, attrs = '') {
  return wrap(text, maxChars)
    .map((l, i) => `<text x="${x}" y="${y + i * size * 1.25}" font-size="${size}" font-family="${FONT}" ${attrs}>${esc(l)}</text>`)
    .join('');
}

const tick = (cx, cy, r) =>
  `<path d="M ${cx - r * 0.45} ${cy} L ${cx - r * 0.1} ${cy + r * 0.35} L ${cx + r * 0.5} ${cy - r * 0.35}" stroke="#fff" stroke-width="${r * 0.22}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
function layoutSvg(layout, W, H, t, pl) {
  const s = W / 2000,
    ink = '#2B2622',
    acc = '#9A7350';
  let g = '';
  if (layout === 'ingredients') {
    g += tspanBlock(130 * s, 230 * s, t.headline, 92 * s, 22, `font-weight="700" fill="${ink}" letter-spacing="${4 * s}"`);
    g += tspanBlock(130 * s, 320 * s, t.sub, 46 * s, 40, `fill="${acc}"`);
    t.items.forEach((it, i) => {
      const [n, d] = it.split('|');
      const y = (520 + i * 330) * s;
      g += `<rect x="${110 * s}" y="${y - 90 * s}" width="${860 * s}" height="${270 * s}" rx="${36 * s}" fill="#FFFFFF" opacity="0.82"/>`;
      g += `<circle cx="${190 * s}" cy="${y + 40 * s}" r="${40 * s}" fill="${acc}" opacity="0.9"/>`;
      g += tspanBlock(260 * s, y + 10 * s, n || '', 56 * s, 22, `font-weight="700" fill="${ink}"`);
      g += tspanBlock(260 * s, y + 85 * s, d || '', 40 * s, 32, `fill="#4A4440"`);
    });
  } else if (layout === 'howto') {
    g += tspanBlock(130 * s, 240 * s, t.headline, 100 * s, 20, `font-weight="700" fill="${ink}" letter-spacing="${6 * s}"`);
    g += tspanBlock(130 * s, 330 * s, t.sub, 46 * s, 40, `fill="${acc}"`);
    t.items.forEach((it, i) => {
      const y = (560 + i * 340) * s;
      g += `<circle cx="${200 * s}" cy="${y}" r="${72 * s}" fill="${acc}"/><text x="${200 * s}" y="${y + 30 * s}" text-anchor="middle" font-size="${84 * s}" font-weight="700" font-family="${FONT}" fill="#fff">${i + 1}</text>`;
      g += tspanBlock(320 * s, y - 10 * s, it, 52 * s, 26, `fill="${ink}"`);
    });
  } else if (layout === 'texture') {
    g += `<rect x="${90 * s}" y="${1480 * s}" width="${1200 * s}" height="${380 * s}" rx="${40 * s}" fill="#fff" opacity="0.85"/>`;
    g += tspanBlock(150 * s, 1600 * s, t.headline, 72 * s, 26, `font-weight="700" fill="${ink}"`);
    g += tspanBlock(150 * s, 1720 * s, t.sub, 48 * s, 42, `fill="#4A4440"`);
  } else if (layout === 'benefits') {
    g += `<text x="${W / 2}" y="${200 * s}" text-anchor="middle" font-size="${88 * s}" font-weight="700" font-family="${FONT}" fill="${ink}" letter-spacing="${4 * s}">${esc(t.headline)}</text>`;
    const pos = [
      [90, 420],
      [1330, 420],
      [90, 1200],
      [1330, 1200],
    ];
    t.items.forEach((it, i) => {
      const [x, y] = pos[i];
      g += `<rect x="${x * s}" y="${y * s}" width="${580 * s}" height="${330 * s}" rx="${40 * s}" fill="#fff" opacity="0.9"/>`;
      g += `<circle cx="${(x + 90) * s}" cy="${(y + 90) * s}" r="${44 * s}" fill="${acc}"/>${tick((x + 90) * s, (y + 90) * s, 44 * s)}`;
      g += tspanBlock((x + 50) * s, (y + 210) * s, it, 46 * s, 22, `font-weight="600" fill="${ink}"`);
    });
    g += `<text x="${W / 2}" y="${1900 * s}" text-anchor="middle" font-size="${36 * s}" font-family="${FONT}" fill="#6B625B">${esc(t.sub)}</text>`;
  } else if (layout === 'size') {
    const x = pl.left + pl.w + 90 * s,
      y0 = pl.top,
      y1 = pl.top + pl.h;
    g += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="${ink}" stroke-width="${5 * s}"/>`;
    g += `<line x1="${x - 30 * s}" y1="${y0}" x2="${x + 30 * s}" y2="${y0}" stroke="${ink}" stroke-width="${5 * s}"/><line x1="${x - 30 * s}" y1="${y1}" x2="${x + 30 * s}" y2="${y1}" stroke="${ink}" stroke-width="${5 * s}"/>`;
    const y2 = pl.top + pl.h + 90 * s;
    g += `<line x1="${pl.left}" y1="${y2}" x2="${pl.left + pl.w}" y2="${y2}" stroke="${ink}" stroke-width="${5 * s}"/>`;
    const dims = String(t.sub || '')
      .split(/[×x*]/)
      .map((d) => d.trim());
    g += `<text x="${x + 50 * s}" y="${(y0 + y1) / 2}" font-size="${60 * s}" font-family="${FONT}" fill="${ink}">${esc(dims[0] || '')}</text>`;
    g += `<text x="${pl.left + pl.w / 2}" y="${y2 + 80 * s}" text-anchor="middle" font-size="${60 * s}" font-family="${FONT}" fill="${ink}">${esc(dims[1] || '')}</text>`;
    g += `<text x="${1880 * s}" y="${260 * s}" text-anchor="end" font-size="${130 * s}" font-weight="700" font-family="${FONT}" fill="${acc}">${esc(t.headline)}</text>`;
  } else if (layout === 'inbox') {
    g += tspanBlock(1100 * s, 420 * s, t.headline, 76 * s, 18, `font-weight="700" fill="${ink}"`);
    t.items.forEach((it, i) => {
      const y = (640 + i * 150) * s;
      g += `<circle cx="${1130 * s}" cy="${y - 18 * s}" r="${30 * s}" fill="${acc}"/>${tick(1130 * s, y - 18 * s, 30 * s)}`;
      g += tspanBlock(1190 * s, y, it, 50 * s, 26, `fill="${ink}"`);
    });
  } else if (layout === 'aplus_header') {
    g += tspanBlock(60, 200, t.headline, 54, 20, `font-weight="700" fill="${ink}" letter-spacing="8"`);
    g += tspanBlock(60, 280, t.sub, 40, 24, `fill="${ink}"`);
    if (t.items[0]) g += tspanBlock(60, 400, t.items[0], 26, 36, `fill="#5A524C"`);
  } else if (layout === 'aplus_banner') {
    g += `<rect x="30" y="90" width="520" height="120" rx="16" fill="#fff" opacity="0.8"/>`;
    g += tspanBlock(60, 145, t.headline, 32, 30, `font-weight="700" fill="${ink}"`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g}</svg>`);
}

// ---------- 预检 ----------
export async function precheck(filePath, tpl, ctx) {
  const items = [];
  const add = (key, label, level, detail) => items.push({ key, label, level, detail });
  const meta = await sharp(filePath).metadata();
  add(
    'size',
    '尺寸',
    meta.width === tpl.width && meta.height === tpl.height ? 'pass' : 'fail',
    `${meta.width}×${meta.height}，要求 ${tpl.width}×${tpl.height}`,
  );
  if (tpl.slot !== 'APLUS')
    add('zoom', '可放大（长边≥1000）', Math.max(meta.width, meta.height) >= 1000 ? 'pass' : 'fail', `长边 ${Math.max(meta.width, meta.height)}px`);
  add('format', '格式/色彩', meta.format === 'jpeg' && (meta.space === 'srgb' || !meta.space) ? 'pass' : 'warn', `${meta.format} / ${meta.space}`);
  const bytes = fs.statSync(filePath).size;
  const limit = tpl.slot === 'APLUS' ? 2 : 10;
  add('bytes', '文件大小', bytes < limit * 1024 * 1024 ? 'pass' : 'fail', `${(bytes / 1024).toFixed(0)} KB（上限 ${limit} MB）`);
  const spec = J(tpl.spec, {});
  if ((spec.checks || []).length) {
    const { data, info } = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width,
      H = info.height,
      px = (x, y) => (y * W + x) * 3;
    let edge = 0,
      edgeWhite = 0;
    for (let x = 0; x < W; x++)
      for (const y of [0, 1, H - 2, H - 1]) {
        edge++;
        const i = px(x, y);
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) edgeWhite++;
      }
    for (let y = 0; y < H; y++)
      for (const x of [0, 1, W - 2, W - 1]) {
        edge++;
        const i = px(x, y);
        if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) edgeWhite++;
      }
    const er = edgeWhite / edge;
    add('whiteBg', '纯白底 RGB 255', er >= 0.999 ? 'pass' : er > 0.97 ? 'warn' : 'fail', `四边纯白像素 ${(er * 100).toFixed(2)}%`);
    let x0 = W,
      y0 = H,
      x1 = -1,
      y1 = -1;
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x += 2) {
        const i = px(x, y);
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    const fill = x1 < 0 ? 0 : Math.max((x1 - x0) / W, (y1 - y0) / H);
    add('fill85', '商品占比（亚马逊建议 85%）', fill >= 0.83 ? 'pass' : fill >= 0.75 ? 'warn' : 'fail', `商品最长边占画面 ${(fill * 100).toFixed(1)}%`);
  }
  if (ctx.sourceWarn) add('source', '原片质量', 'warn', ctx.sourceWarn);
  const hits = checkTexts(ctx.texts || []);
  if (!hits.length) add('compliance', '宣称合规（FDA/亚马逊）', 'pass', '未命中风险词');
  for (const h of hits)
    add('compliance', '宣称合规（FDA/亚马逊）', h.level === 'high' ? 'fail' : 'warn', `「${h.match}」@${h.field}：${h.msg}；建议：${h.fix}`);
  if (ctx.mock) add('mock', '模拟输出', 'warn', '本图背景由「模拟」通道程序生成，仅用于走通流程，不可上架');
  const overall = items.some((i) => i.level === 'fail') ? 'fail' : items.some((i) => i.level === 'warn') ? 'warn' : 'pass';
  return { overall, items };
}

// ---------- 任务队列 ----------
const queue = [];
let active = 0;
const CONCURRENCY = Math.max(1, config.concurrency);
function pump() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active++;
    runJob(job)
      .catch((e) => log.error('job error', e))
      .finally(() => {
        active--;
        pump();
      });
  }
}
export function queueStats() {
  return { queued: queue.length, active };
}

export function generateNode(nodeId, operator = 'system', opts = {}) {
  const node = q1('SELECT * FROM nodes WHERE id=?', nodeId);
  if (!node) throw new Error('节点不存在');
  if (!node.source_id) throw new Error('该节点还没有原片，请先上传对应角度');
  const v = (q1('SELECT MAX(version) v FROM outputs WHERE node_id=?', nodeId)?.v || 0) + 1;
  let reuse = null;
  if (opts.recomposite) {
    // 只重新合成：复用上一版模型背景，不调用模型、不花钱
    reuse = q1('SELECT * FROM outputs WHERE node_id=? AND bg_path IS NOT NULL ORDER BY version DESC LIMIT 1', nodeId);
    if (!reuse || !fs.existsSync(toAbs(reuse.bg_path))) throw new Error('没有可复用的模型背景，请先正常生成一次');
  }
  const r = run(
    "INSERT INTO outputs(node_id,version,status,provider_id,created_by) VALUES(?,?,'generating',?,?)",
    nodeId,
    v,
    reuse ? reuse.provider_id : node.provider_id,
    operator,
  );
  queue.push({ outputId: Number(r.lastInsertRowid), nodeId, operator, reuse });
  pump();
  return Number(r.lastInsertRowid);
}

async function runJob({ outputId, nodeId, operator, reuse }) {
  const t0 = Date.now();
  const node = q1('SELECT * FROM nodes WHERE id=?', nodeId);
  const tpl = q1('SELECT * FROM templates WHERE id=?', node.template_id);
  const product = q1('SELECT * FROM products WHERE id=?', node.product_id);
  const source = q1('SELECT * FROM source_assets WHERE id=?', node.source_id);
  const spec = J(tpl.spec, {});
  const params = J(node.params, {});
  const W = tpl.width,
    H = tpl.height;
  const promptRaw = node.prompt ?? tpl.prompt;
  let prompt = fillVars(promptRaw, promptVars(product, params, { spec, angle: source.angle, analysis: J(source.analysis) }));
  let usedProvider = 'local',
    model = 'layout-engine',
    mock = false,
    bgPath = null;
  try {
    const cut = await getCutout(source);
    if (spec.bg === 'generate') {
      // 提示词 v2：原片分析（主色、光线方向）缓存到原片记录
      let analysis = J(source.analysis);
      if (!analysis) {
        analysis = await analyzeCutout(cut);
        run('UPDATE source_assets SET analysis=? WHERE id=?', JSON.stringify(analysis), source.id);
      }
      prompt = buildPrompt(promptRaw, promptVars(product, params, { spec, angle: source.angle, analysis }), spec);
      if (params.prompt_v1 && PROMPTS_V1[tpl.id])
        // 仅用于新旧提示词对比测试：还原 v1 提示词 + v1 尾部约束
        prompt =
          fillVars(PROMPTS_V1[tpl.id], promptVars(product, params, { spec })) +
          ' Keep exactly one product: the one already in the image, at the same position, size and angle. Do not duplicate it or add any other bottles, jars or packaging. Do not add any text or logos. The product must rest naturally on the surface directly beneath it (no floating), with a soft contact shadow matching the scene lighting.';
    }
    const prod = await trimmedProduct(cut);
    let pl = await placeProduct(prod, W, H, spec);
    let base;
    if (spec.bg === 'white') {
      model = 'cutout+white-composite';
    } else if (spec.bg === 'solid') {
      model = 'cutout+layout-engine';
    }
    if (spec.bg === 'white') base = sharp({ create: { width: W, height: H, channels: 3, background: '#FFFFFF' } }).png();
    else if (spec.bg === 'solid') base = sharp({ create: { width: W, height: H, channels: 3, background: spec.color || '#F5F5F5' } }).png();
    else if (reuse) {
      usedProvider = reuse.provider_id;
      model = reuse.fresh ? reuse.model : (reuse.model || '').replace(/ · 复用背景重合成/g, '') + ' · 复用背景重合成';
      mock = usedProvider === 'mock';
      bgPath = reuse.bg_path;
      base = sharp(await sharp(toAbs(reuse.bg_path)).resize(W, H, { fit: 'cover' }).png().toBuffer());
    } else {
      const { row, adapter } = getProvider(node.provider_id);
      usedProvider = row.id;
      mock = row.type === 'mock';
      const [gw, gh] = spec.genSize.split('x').map(Number);
      if (row.type === 'grok') {
        await writeGrokJob({ outputId, node, tpl, product, prompt, prod, spec, W, H });
        return;
      }
      // 给模型的输入：商品按目标构图放在白底上，模型只负责背景和氛围
      const gpl = await placeProduct(prod, gw, gh, spec);
      const input = await sharp({ create: { width: gw, height: gh, channels: 3, background: '#FFFFFF' } })
        .composite([{ input: gpl.layer, left: gpl.left, top: gpl.top }])
        .png()
        .toBuffer();
      // 遮罩：商品区域（略收边）为黑=保留，其余白=可编辑，减少模型重画/挪动商品造成的「重影」
      const pa = await sharp(gpl.layer).ensureAlpha().extractChannel(3).erode(2).threshold(128).negate().png().toBuffer();
      const mask = await sharp({ create: { width: gw, height: gh, channels: 3, background: '#FFFFFF' } })
        .composite([{ input: await sharp(pa).toColourspace('srgb').png().toBuffer(), left: gpl.left, top: gpl.top, blend: 'darken' }])
        .flatten({ background: '#FFFFFF' })
        .png()
        .toBuffer();
      const gt = Date.now();
      let res;
      try {
        res = await adapter.generate({
          prompt,
          image: input,
          mask: row.config.useMask === false ? null : mask,
          size: spec.genSize,
          seed: params.seed,
          config: { ...row.config, ...(params.quality ? { quality: params.quality } : {}) },
        });
      } catch (e) {
        run(
          'INSERT INTO cost_ledger(output_id,product_id,provider_id,model,op,amount_usd,duration_ms,ok,operator,error) VALUES(?,?,?,?,?,?,?,?,?,?)',
          outputId,
          product.id,
          row.id,
          row.config.model || row.type,
          'img2img',
          0,
          Date.now() - gt,
          0,
          operator,
          String(e.message || e).slice(0, 500),
        );
        throw e;
      }
      model = res.model;
      const led = run(
        'INSERT INTO cost_ledger(output_id,product_id,provider_id,model,op,input_tokens,output_tokens,amount_usd,duration_ms,ok,operator,ext_id,estimated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        outputId,
        product.id,
        row.id,
        res.model,
        'img2img',
        res.usage?.input_tokens ?? null,
        res.usage?.output_tokens ?? null,
        res.cost || 0,
        Date.now() - gt,
        1,
        operator,
        res.requestId || null,
        res.costEstimated ? 1 : 0,
      );
      if (row.type === 'fal' && res.requestId) reconcileFalCost(Number(led.lastInsertRowid), res.requestId);
      const bgDir = path.join(DATA, 'genbg');
      fs.mkdirSync(bgDir, { recursive: true });
      bgPath = path.join(bgDir, `${outputId}.png`);
      fs.writeFileSync(bgPath, res.buffer);
      base = sharp(await sharp(res.buffer).resize(W, H, { fit: 'cover' }).png().toBuffer());
    }
    const layers = [];
    let paste = pl;
    if (spec.bg === 'generate' && spec.pasteBack) {
      // 模型背景：融合贴回
      const baseBuf = await base.clone().png().toBuffer();
      if (!mock) {
        const al = await alignToModel(prod, pl, baseBuf, W, H);
        pl = al.pl;
        log.debug('[align]', outputId, JSON.stringify(al.info));
      }
      paste = await harmonize(pl, baseBuf, W, H);
      layers.push({ input: await shadowFor(pl, W, H), left: 0, top: 0 }, { input: contactShadow(pl, W, H), left: 0, top: 0 });
    } else if (spec.bg !== 'white' && spec.pasteBack) layers.push({ input: await shadowFor(pl, W, H), left: 0, top: 0 });
    layers.push({ input: paste.layer, left: paste.left, top: paste.top }); // 原图商品像素贴回
    const texts = overlayTexts(spec.layout || 'none', product, params);
    if (spec.layout && spec.layout !== 'none') layers.push({ input: layoutSvg(spec.layout, W, H, texts, pl), left: 0, top: 0 });
    const outDir = path.join(DATA, 'outputs', product.sku);
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${product.sku}_${tpl.id}_v${q1('SELECT version FROM outputs WHERE id=?', outputId).version}.jpg`);
    let img = await base.composite(layers).flatten({ background: '#FFFFFF' }).png().toBuffer();
    if (spec.bg === 'white') {
      // 保证白底四周严格 RGB 255
      const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i++) if (data[i] >= 250) data[i] = 255;
      img = await sharp(data, { raw: info }).png().toBuffer();
    }
    await sharp(img).toColorspace('srgb').jpeg({ quality: 92, mozjpeg: true }).withMetadata({ icc: 'srgb' }).toFile(file);
    const sw = J(source.warnings, []);
    const textList = [
      { field: '画面标题', text: texts.headline },
      { field: '画面副标题', text: texts.sub },
      ...texts.items.map((t, i) => ({ field: `画面文案${i + 1}`, text: t })),
      { field: '提示词', text: prompt },
    ];
    const pc = await precheck(file, tpl, { texts: textList, mock, sourceWarn: sw.length ? sw.join('；') : null });
    run(
      "UPDATE outputs SET status='draft', path=?, width=?, height=?, prompt=?, provider_id=?, model=?, precheck=?, duration_ms=?, bg_path=?, updated_at=datetime('now','localtime') WHERE id=?",
      toRel(file),
      W,
      H,
      prompt,
      usedProvider,
      model,
      JSON.stringify(pc),
      Date.now() - t0,
      toRel(bgPath),
      outputId,
    );
  } catch (e) {
    run(
      "UPDATE outputs SET status='failed', error=?, prompt=?, duration_ms=?, updated_at=datetime('now','localtime') WHERE id=?",
      String(e.message || e),
      prompt,
      Date.now() - t0,
      outputId,
    );
  }
}

// ---------- 上传后自动铺画布并开跑 ----------
export { defaultProvider };

// fal 账单有延迟：先记估算价，随后按 request_id 查 billing-events，查到就改成实付金额
export function reconcileFalCost(ledgerId, requestId, tries = 0) {
  const delays = [20e3, 60e3, 180e3, 600e3];
  if (tries >= delays.length) return;
  setTimeout(async () => {
    const c = await fetchBilledCost(requestId);
    if (typeof c === 'number') run('UPDATE cost_ledger SET amount_usd=?, estimated=0 WHERE id=?', +c.toFixed(5), ledgerId);
    else if (c?.status === 401 || c?.status === 403)
      return; // 密钥没有账单查询权限：保留按官方价目表的估算
    else reconcileFalCost(ledgerId, requestId, tries + 1);
  }, delays[tries]).unref?.();
}
export function ensureGraph(productId, operator = 'system') {
  const sources = q('SELECT * FROM source_assets WHERE product_id=? ORDER BY id DESC', productId);
  const byAngle = {};
  for (const s of sources) if (!byAngle[s.angle]) byAngle[s.angle] = s;
  const started = [];
  for (const tpl of q('SELECT * FROM templates ORDER BY sort')) {
    const spec = J(tpl.spec, {});
    const src = (spec.sources || ['front']).map((a) => byAngle[a]).find(Boolean);
    if (!src) continue;
    let node = q1('SELECT * FROM nodes WHERE product_id=? AND template_id=?', productId, tpl.id);
    if (!node) {
      run('INSERT INTO nodes(product_id,template_id,source_id,provider_id) VALUES(?,?,?,?)', productId, tpl.id, src.id, defaultProvider());
      node = q1('SELECT * FROM nodes WHERE product_id=? AND template_id=?', productId, tpl.id);
      started.push(generateNode(node.id, operator));
    } else if (!node.source_id) {
      run('UPDATE nodes SET source_id=? WHERE id=?', src.id, node.id);
      started.push(generateNode(node.id, operator));
    }
  }
  return started;
}

export function recoverInterrupted() {
  run("UPDATE outputs SET status='failed', error='服务重启，任务中断，请重新生成' WHERE status='generating'");
}

// ---------- Grok 生图（内置）：外部出图任务队列 ----------
export const GROK_DIR = path.join(DATA, 'grok_jobs');
async function writeGrokJob({ outputId, node, tpl, product, prompt, prod, spec, W, H }) {
  fs.mkdirSync(GROK_DIR, { recursive: true });
  const ratio = pickRatio(W, H),
    rv = GROK_RATIOS[ratio];
  // 参考图：按最终画幅摆好商品的白底图，再补白到 Grok 支持的画幅（导入时按 crop 裁回）
  const RW = 1024,
    RH = Math.round(RW / (W / H));
  const gpl = await placeProduct(prod, RW, RH, spec);
  const inner = await sharp({ create: { width: RW, height: RH, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: gpl.layer, left: gpl.left, top: gpl.top }])
    .png()
    .toBuffer();
  let CW = RW,
    CH = RH;
  if (RW / RH > rv) CH = Math.round(RW / rv);
  else CW = Math.round(RH * rv);
  const crop = { left: Math.round((CW - RW) / 2), top: Math.round((CH - RH) / 2), width: RW, height: RH, canvasW: CW, canvasH: CH };
  const ref = path.join(GROK_DIR, `${outputId}_ref.png`);
  await sharp({ create: { width: CW, height: CH, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: inner, left: crop.left, top: crop.top }])
    .png()
    .toFile(ref);
  const letterbox = CW !== RW || CH !== RH;
  const fullPrompt = prompt.replace(
    /- Image 1 is the layout reference:[^\n]*/,
    '- Image 1 is the layout reference: the real product photo already sits at its final position and size on a plain white placeholder. Replace the white with the scene, keep the product exactly where it is (same position, size and angle) and do not add a second copy anywhere.' +
      (letterbox ? ' Extend the scene naturally to the full frame.' : ''),
  );
  const refPl = { left: gpl.left + crop.left, top: gpl.top + crop.top, w: gpl.w, h: gpl.h };
  const job = {
    refPl,
    outputId,
    nodeId: node.id,
    sku: product.sku,
    template: tpl.id,
    status: 'pending',
    provider: 'grok',
    aspect_ratio: ratio,
    size: `${W}x${H}`,
    crop,
    reference_image: ref,
    prompt: fullPrompt,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(GROK_DIR, `${outputId}.json`), JSON.stringify(job, null, 2));
  run(
    "UPDATE outputs SET status='awaiting', prompt=?, provider_id='grok', model='grok-builtin（待导入）', updated_at=datetime('now','localtime') WHERE id=?",
    fullPrompt,
    outputId,
  );
}
export function listGrokJobs(status) {
  if (!fs.existsSync(GROK_DIR)) return [];
  return fs
    .readdirSync(GROK_DIR)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(GROK_DIR, f), 'utf8')))
    .filter((j) => !status || j.status === status)
    .sort((a, b) => a.outputId - b.outputId);
}
// 导入 Grok 出的背景：裁回目标画幅 → 存为该版本的模型背景 → 正常合成
export async function importGrokImage(outputId, buf, operator = 'grok-bot') {
  const jf = path.join(GROK_DIR, `${outputId}.json`);
  if (!fs.existsSync(jf)) throw new Error('找不到该 Grok 任务');
  const job = JSON.parse(fs.readFileSync(jf, 'utf8'));
  const o = q1('SELECT * FROM outputs WHERE id=?', outputId);
  if (!o) throw new Error('版本不存在');
  const c = { ...job.crop };
  const canvas = await sharp(buf).resize(c.canvasW, c.canvasH, { fit: 'cover' }).png().toBuffer();
  // 补白画幅（如 3:1 横幅用 16:9 出图）：Grok 常把商品画得偏大/偏下，按它实际画的商品位置挪裁切窗，保证商品完整落在画面里
  if (job.refPl && (c.canvasH > c.height || c.canvasW > c.width)) {
    const node = q1('SELECT * FROM nodes WHERE id=?', o.node_id);
    const src = q1('SELECT * FROM source_assets WHERE id=?', node.source_id);
    const prod = await trimmedProduct(await getCutout(src));
    const lay = await sharp(prod.buf).resize(job.refPl.w, job.refPl.h).png().toBuffer();
    const al = await alignToModel(prod, { ...job.refPl, layer: lay }, canvas, c.canvasW, c.canvasH);
    if (al.info.moved) {
      const p = al.pl,
        m = Math.round(c.height * 0.03),
        want = (job.refPl.top + job.refPl.h - c.top) / c.height; // 原定底边位置
      if (c.canvasH > c.height) {
        let t = Math.round(p.top + p.h - want * c.height);
        t = Math.min(t, p.top - m);
        t = Math.max(t, p.top + p.h + m - c.height);
        c.top = Math.max(0, Math.min(c.canvasH - c.height, t));
      }
      if (c.canvasW > c.width) {
        let l = Math.round(p.left + p.w / 2 - (job.refPl.left + job.refPl.w / 2 - c.left));
        l = Math.min(l, p.left - m);
        l = Math.max(l, p.left + p.w + m - c.width);
        c.left = Math.max(0, Math.min(c.canvasW - c.width, l));
      }
      log.debug('[grok-crop]', outputId, JSON.stringify({ from: job.crop.top, to: c.top, product: { top: p.top, h: p.h } }));
    }
  }
  const bg = await sharp(canvas).extract({ left: c.left, top: c.top, width: c.width, height: c.height }).png().toBuffer();
  const bgDir = path.join(DATA, 'genbg');
  fs.mkdirSync(bgDir, { recursive: true });
  const bgPath = path.join(bgDir, `${outputId}.png`);
  fs.writeFileSync(bgPath, bg);
  run(
    'INSERT INTO cost_ledger(output_id,product_id,provider_id,model,op,amount_usd,duration_ms,ok,operator,estimated) VALUES(?,?,?,?,?,?,?,?,?,?)',
    outputId,
    q1('SELECT product_id FROM nodes WHERE id=?', o.node_id).product_id,
    'grok',
    'grok-builtin',
    'img2img',
    0,
    0,
    1,
    operator,
    0,
  );
  run("UPDATE outputs SET status='generating', bg_path=? WHERE id=?", toRel(bgPath), outputId);
  Object.assign(job, { usedCrop: c, status: 'imported', imported_at: new Date().toISOString(), bg_path: bgPath });
  fs.writeFileSync(jf, JSON.stringify(job, null, 2));
  queue.push({ outputId, nodeId: o.node_id, operator, reuse: { provider_id: 'grok', model: 'grok-builtin', bg_path: bgPath, fresh: true } });
  pump();
  return job;
}
