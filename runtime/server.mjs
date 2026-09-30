import http from 'node:http';
import https from 'node:https';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { collectSessions } from './metrics.mjs';
import { createInternalServer } from './internal-server.mjs';

const require = createRequire(import.meta.url);
const dir = resolve(import.meta.dirname, '..');
process.chdir(dir);
process.env.NODE_ENV = 'production';
// Use the same traced router as Next's generated standalone server. Keep covered by image smoke tests when upgrading Next.
const { config } = JSON.parse(readFileSync(resolve(dir, '.next/required-server-files.json'), 'utf8'));
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
const { getRequestHandlers } = require('next/dist/server/lib/start-server');
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? '::';
const { TLS_CERT_FILE: certFile, TLS_KEY_FILE: keyFile } = process.env;
if (Boolean(certFile) !== Boolean(keyFile)) throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be configured together');
const readCertificate = () => {
  const certificatePath = realpathSync(certFile);
  // Resolve the certificate once so Kubernetes Secret rotation cannot mix two projections.
  const keyPath = dirname(certFile) === dirname(keyFile)
    ? resolve(dirname(certificatePath), basename(keyFile)) : keyFile;
  return { cert: readFileSync(certificatePath), key: readFileSync(keyPath) };
};
let certificate = certFile ? readCertificate() : undefined;
const server = certificate ? https.createServer(certificate) : http.createServer();
let ready = false;
let draining = false;
const metricsServer = createInternalServer({ certificate, isReady: () => ready && !draining, collectSessions });
metricsServer.listen(Number(process.env.METRICS_PORT ?? 3002), hostname);
const { requestHandler: handleRequest, upgradeHandler: handleUpgrade } = await getRequestHandlers({ dir, port, hostname, server, isDev: false, experimentalHttpsServer: !!certificate });
server.on('request', (request, response) => {
  if (draining) { response.writeHead(503, { Connection: 'close' }); response.end(); return; }
  // Unexpected promise failures remain fatal; Next handles request errors at its own boundary.
  void handleRequest(request, response);
});
server.on('upgrade', (request, socket, head) => { void handleUpgrade(request, socket, head); });
// Kubernetes projects renewed Secrets atomically. Reload both files from the same projection.
const renewal = certificate ? setInterval(() => {
  const next = readCertificate();
  if (!next.cert.equals(certificate.cert) || !next.key.equals(certificate.key)) {
    server.setSecureContext(next);
    metricsServer.setSecureContext(next);
    certificate = next;
    console.info('Reloaded HTTPS certificate');
  }
}, 60_000).unref() : undefined;
function shutdown() {
  if (draining) return;
  draining = true;
  clearInterval(renewal);
  metricsServer.close();
  server.close(() => process.exit(0));
  // SSE connections otherwise last indefinitely. Bound draining below the pod's 30s grace period.
  setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 25_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(port, hostname, () => {
  ready = true;
  console.info(`Checkers listening on ${certificate ? 'https' : 'http'}://${hostname}:${port}`);
});
