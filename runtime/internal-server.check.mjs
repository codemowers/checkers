import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInternalServer } from './internal-server.mjs';

test('internal health is dependency-free and reflects startup and drain state', async t => {
  let ready = false, scrapes = 0;
  const server = createInternalServer({ isReady: () => ready, collectSessions: async () => { scrapes++; return { player: { anonymous: 3, authenticated: 1 }, spectator: { anonymous: 0, authenticated: 0 } }; } });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/ready')).status, 503);
  ready = true;
  assert.equal((await fetch(url + '/health')).status, 200);
  assert.equal(scrapes, 0);
  const metrics = await fetch(url + '/metrics');
  assert.match(await metrics.text(), /auth="anonymous"} 3/);
  assert.equal(scrapes, 1);
  ready = false;
  assert.equal((await fetch(url + '/ready')).status, 503);
  assert.equal((await fetch(url + '/private')).status, 404);
});

test('a failed metrics scrape returns 500 without making health depend on Redis', async t => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const server = createInternalServer({ isReady: () => true, collectSessions: async () => { throw new Error('Redis unavailable'); } });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const metrics = await fetch(url + '/metrics');
  assert.equal(metrics.status, 500);
  assert.equal(await metrics.text(), '');
  assert.equal((await fetch(url + '/ready')).status, 200);
  assert.equal(errors.length, 1);
});
