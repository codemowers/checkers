import http from 'node:http';
import { renderSessions } from './metrics.mjs';

export function createInternalServer({ isReady, collectSessions }) {
  const server = http.createServer();
  server.on('request', (request, response) => {
    if (request.url === '/health' || request.url === '/ready') {
      response.writeHead(isReady() ? 200 : 503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ready: isReady() }));
      return;
    }
    if (request.url !== '/metrics') { response.writeHead(404); response.end(); return; }
    // A failed scrape is visible as HTTP 500 and in the log; never report zero sessions on failure.
    void collectSessions().then(counts => {
      const body = renderSessions(counts);
      response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(body);
    }).catch(error => {
      console.error('Session metrics scrape failed:', error);
      response.writeHead(500);
      response.end();
    });
  });
  return server;
}
