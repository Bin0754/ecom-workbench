// Central runtime configuration. Everything is read from environment variables (see .env.example).
// No API keys are read here: each model adapter reads its own key from the env var it documents, at call time.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bool = (v, d = false) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: int(process.env.PORT, 5180),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(process.env.WB_DATA_DIR || path.join(ROOT, 'data')),
  // Shared access password. Empty = no gate (only safe on a trusted machine / LAN).
  accessPassword: process.env.WB_ACCESS_PASSWORD || '',
  // Set when running behind a reverse proxy (e.g. "1", "loopback", or a CIDR). Default: do not trust X-Forwarded-For,
  // otherwise the login rate limit could be bypassed by spoofing that header.
  trustProxy: process.env.WB_TRUST_PROXY || false,
  // Force the Secure cookie flag (otherwise it is set automatically when the request is HTTPS).
  cookieSecure: bool(process.env.WB_COOKIE_SECURE, false),
  // Provider used for newly created canvas nodes. Default: the free 'mock' channel (falls back to mock if the chosen one is disabled).
  defaultProvider: process.env.WB_DEFAULT_PROVIDER || '',
  // Time zone used to name shoot batches (YYYYMMDD folders). Empty = server local time.
  timeZone: process.env.WB_TZ || process.env.TZ || undefined,
  concurrency: int(process.env.WB_CONCURRENCY, 2),
  uploadMaxMb: int(process.env.WB_UPLOAD_MAX_MB, 60),
  logLevel: process.env.WB_LOG_LEVEL || 'info',
};

export const log = {
  debug: (...a) => config.logLevel === 'debug' && console.log('[debug]', ...a),
  info: (...a) => config.logLevel !== 'silent' && console.log(...a),
  warn: (...a) => config.logLevel !== 'silent' && console.warn(...a),
  error: (...a) => console.error(...a),
};
