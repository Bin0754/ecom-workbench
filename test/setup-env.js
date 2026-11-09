// Import this FIRST in every test file: isolates the test from the developer's environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Never let tests see real model keys (no paid calls, ever).
for (const k of ['OPENAI_API_KEY', 'FAL_KEY', 'OPENAI_BASE_URL']) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith('WB_HTTP_')) delete process.env[k];
process.env.WB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
process.env.WB_LOG_LEVEL = 'silent';
delete process.env.WB_DEFAULT_PROVIDER; // exercise the built-in default (mock)
if (!('WB_ACCESS_PASSWORD' in process.env)) process.env.WB_ACCESS_PASSWORD = '';
export const DATA_DIR = process.env.WB_DATA_DIR;
