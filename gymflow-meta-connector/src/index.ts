import { randomUUID } from 'node:crypto';

import { loadConfig } from './config.js';
import app from './app.js';

const config = loadConfig();

const server = app.listen(config.port, () => {
  process.stdout.write(
    `${JSON.stringify({
      at: new Date().toISOString(),
      level: 'info',
      msg: 'gymflow-meta-connector listening',
      port: config.port,
      readOnly: config.readOnly,
      instanceId: randomUUID(),
    })}\n`,
  );
});

function shutdown(signal: string): void {
  process.stdout.write(`${JSON.stringify({ level: 'info', msg: `received ${signal}, shutting down` })}\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
