// SQLite 数据层（Node 内置 node:sqlite，无需原生编译）
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

export { ROOT };
export const DATA = config.dataDir;
// Directories that may be served to the browser under /files (never the DB, job queue or tmp files).
export const PUBLIC_DIRS = ['sources', 'outputs', 'cutouts', 'genbg'];
for (const d of [...PUBLIC_DIRS, 'tmp', 'exports', 'grok_jobs']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

export const db = new DatabaseSync(path.join(DATA, 'workbench.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`);

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,          -- 款号
  asin TEXT,                          -- 亚马逊 ASIN
  name TEXT NOT NULL,                 -- 英文品名（上图用）
  name_zh TEXT,                       -- 中文品名（内部用）
  brand TEXT,
  category TEXT DEFAULT 'skincare',
  size_spec TEXT,                     -- 容量规格，如 30 ml / 1 fl oz
  dimensions TEXT,                    -- 外形尺寸，如 H 10.5 cm × Ø 3.4 cm
  ingredients TEXT,                   -- 每行一个：成分|说明
  benefits TEXT,                      -- 每行一个卖点
  usage_steps TEXT,                   -- 每行一步
  box_contents TEXT,                  -- 每行一项
  scene TEXT,                         -- 场景关键词
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS shoot_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  angles TEXT NOT NULL,               -- JSON 数组：必拍角度
  photographer TEXT,
  due_date TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS source_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  task_id INTEGER,
  angle TEXT NOT NULL,
  seq INTEGER DEFAULT 1,
  batch TEXT,                         -- 拍摄批次（日期）
  original_name TEXT,
  archive_name TEXT,                  -- 系统归档文件名
  path TEXT NOT NULL,                 -- 当前用于处理的文件（预览或原图）
  original_path TEXT,                 -- 原图（只读存档）
  original_received INTEGER DEFAULT 0,
  width INTEGER, height INTEGER, bytes INTEGER,
  warnings TEXT,                      -- JSON
  uploaded_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,                -- grok / mock / openai / fal / http / comfyui
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 0,
  config TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,                -- MAIN / PT01 ... / APLUS_HEADER
  name TEXT NOT NULL,
  slot TEXT NOT NULL,                 -- 亚马逊位置：MAIN / PT01 / APLUS
  width INTEGER NOT NULL, height INTEGER NOT NULL,
  spec TEXT NOT NULL,                 -- JSON：生成规格
  prompt TEXT,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES templates(id),
  source_id INTEGER REFERENCES source_assets(id),
  prompt TEXT,                        -- 本款覆盖的提示词
  provider_id TEXT,
  params TEXT DEFAULT '{}',
  pos TEXT,                           -- 画布坐标 JSON
  UNIQUE(product_id, template_id)
);
CREATE TABLE IF NOT EXISTS outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,               -- generating / failed / draft / pending / rejected / approved / void
  path TEXT,
  width INTEGER, height INTEGER,
  prompt TEXT, provider_id TEXT, model TEXT, seed INTEGER,
  precheck TEXT,                      -- JSON
  error TEXT,
  duration_ms INTEGER,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_id INTEGER NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
  result TEXT NOT NULL,               -- approved / rejected
  reasons TEXT,                       -- JSON 原因标签
  comment TEXT,
  reviewer TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS cost_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_id INTEGER, product_id INTEGER,
  provider_id TEXT, model TEXT, op TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  amount_usd REAL DEFAULT 0,
  duration_ms INTEGER, ok INTEGER, operator TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER, output_id INTEGER, kind TEXT, operator TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

try {
  db.exec('ALTER TABLE outputs ADD COLUMN bg_path TEXT');
} catch {}
for (const c of ['product_type', 'brand_colors', 'audience', 'palette']) {
  try {
    db.exec(`ALTER TABLE products ADD COLUMN ${c} TEXT`);
  } catch {}
}
try {
  db.exec('ALTER TABLE source_assets ADD COLUMN analysis TEXT');
} catch {}
for (const [col, type] of [
  ['ext_id', 'TEXT'],
  ['estimated', 'INTEGER DEFAULT 0'],
  ['error', 'TEXT'],
]) {
  try {
    db.exec(`ALTER TABLE cost_ledger ADD COLUMN ${col} ${type}`);
  } catch {}
}

// File paths are stored RELATIVE to the data dir so the data folder can be moved (Docker volumes, backups).
const DATA_SUBDIRS = [...PUBLIC_DIRS, 'grok_jobs', 'exports', 'tmp'];
export function toRel(p) {
  if (!p) return p ?? null;
  if (!path.isAbsolute(p)) return p.split(path.sep).join('/');
  const r = path.relative(DATA, p);
  if (!r.startsWith('..') && !path.isAbsolute(r)) return r.split(path.sep).join('/');
  const parts = p.split(/[\\/]/); // legacy absolute path from another location: rebase from the first known sub-dir
  const i = parts.findIndex((x, k) => DATA_SUBDIRS.includes(x) && k > 0);
  return i > 0 ? parts.slice(i).join('/') : p;
}
export function toAbs(p) {
  if (!p) return p ?? null;
  return path.isAbsolute(p) ? p : path.join(DATA, ...p.split('/'));
}
export function migrateAbsolutePaths() {
  const cols = [
    ['source_assets', 'path'],
    ['source_assets', 'original_path'],
    ['outputs', 'path'],
    ['outputs', 'bg_path'],
  ];
  for (const [t, c] of cols)
    for (const r of q(`SELECT id, ${c} v FROM ${t} WHERE ${c} LIKE '/%' OR ${c} LIKE '_:\\%'`)) run(`UPDATE ${t} SET ${c}=? WHERE id=?`, toRel(r.v), r.id);
}

export const q = (sql, ...a) => db.prepare(sql).all(...a);
export const q1 = (sql, ...a) => db.prepare(sql).get(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);
export const J = (s, d = null) => {
  try {
    return s ? JSON.parse(s) : d;
  } catch {
    return d;
  }
};
