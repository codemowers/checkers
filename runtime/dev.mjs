import http from 'node:http';
import next from 'next';
import { createInternalServer } from './internal-server.mjs';
import { collectOpenConnections } from './open-connections.mjs';

const hostname = process.env.HOSTNAME ?? '::';
const port = Number(process.env.PORT ?? 3000);
let ready = false;
const internal = createInternalServer({ isReady: () => ready, collectSessions: collectOpenConnections });
internal.listen(Number(process.env.METRICS_PORT ?? 3002), hostname);
const app = next({ dev: true, webpack: true, hostname, port });
await app.prepare();
const server = http.createServer(app.getRequestHandler());
server.on('upgrade', app.getUpgradeHandler());
server.listen(port, hostname, () => { ready = true; });
function shutdown() {
  ready = false;
  internal.close();
  server.close(() => { void app.close().then(() => process.exit(0)); });
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 25000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
