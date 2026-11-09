import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API/file routes to the Node server (PORT, default 5180).
const target = `http://localhost:${process.env.PORT || 5180}`;
const proxy = Object.fromEntries(['/api', '/files', '/thumb', '/login', '/logout'].map((p) => [p, target]));
export default defineConfig({ plugins: [react()], server: { host: true, proxy, fs: { allow: ['..'] } } });
