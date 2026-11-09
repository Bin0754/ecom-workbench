// Server entry point: `npm start` / `node server/index.js`. Configuration: see .env.example.
import { createApp } from './app.js';
import { config, log } from './config.js';

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  log.info(`Ecom Workbench / 商品图工作台 listening on http://localhost:${config.port} (data: ${config.dataDir})`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
