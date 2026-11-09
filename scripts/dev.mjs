#!/usr/bin/env node
// `npm run dev`: API server with --watch (port $PORT, default 5180) + Vite dev server with HMR (port 5173, proxies /api).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Same settings as `npm start`: load .env if present (existing environment variables win).
if (fs.existsSync('.env')) process.loadEnvFile('.env');

const procs = [
  spawn(process.execPath, ['--watch-path=server', 'server/index.js'], { stdio: 'inherit', env: process.env }),
  spawn('npm', ['--prefix', 'web', 'run', 'dev'], { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs)
  p.on('exit', (code) => {
    if (code) {
      console.error(`child exited with ${code}`);
      stop();
    }
  });
