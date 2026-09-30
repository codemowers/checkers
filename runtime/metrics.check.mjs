import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSessions, renderSessions } from './metrics.mjs';

test('counts seats, not sockets or games; excludes finished, expired and stale assignments', async () => {
  const games = {
    mixed: { id: 'mixed', status: 'playing', players: [{ id: 'anon:a' }, { id: 'member' }] },
    waiting: { id: 'waiting', status: 'playing', waiting: true, players: [{ id: 'anon:b' }, { id: '' }] },
    computer: { id: 'computer', status: 'playing', players: [{ id: 'solo' }, { id: 'computer:bot' }] },
    finished: { id: 'finished', status: 'finished', players: [{ id: 'done' }, { id: 'anon:done' }] },
    stale: { id: 'stale', status: 'playing', players: [{ id: 'former' }, { id: '' }] },
  };
  const client = {
    async zremrangebyscore() {}, async zrangebyscore() { return []; },
    async hscan(_key, cursor) {
      return cursor === '0'
        ? ['7', ['anon:a', 'mixed', 'member', 'mixed', 'anon:b', 'waiting']]
        : ['0', ['member', 'mixed', 'solo', 'computer', 'done', 'finished', 'expired', 'missing', 'changed', 'stale']];
    },
    async mget(...keys) { return keys.map(key => games[key.replace('checkers:game:', '')]).map(game => game ? JSON.stringify(game) : null); },
  };
  const counts = await collectSessions(client);
  assert.deepEqual(counts, { player: { anonymous: 2, authenticated: 2 }, spectator: { anonymous: 0, authenticated: 0 } });
  const output = renderSessions(counts);
  assert.match(output, /# TYPE checkers_open_game_sessions gauge/);
  assert.match(output, /auth="anonymous"} 2/);
  assert.doesNotMatch(output, /anon:a|member|mixed|computer:bot/);
});

test('emits all four zero series on an empty database', async () => {
  const counts = await collectSessions({ async hscan() { return ['0', []]; }, async zremrangebyscore() {}, async zrangebyscore() { return []; } });
  assert.deepEqual(counts, { player: { anonymous: 0, authenticated: 0 }, spectator: { anonymous: 0, authenticated: 0 } });
});

test('does not disguise storage errors or corrupt state as zero sessions', async () => {
  await assert.rejects(collectSessions({ async hscan() { throw new Error('unavailable'); } }), /unavailable/);
  await assert.rejects(collectSessions({ async hscan() { return ['0', ['player', 'game']]; }, async mget() { return ['not JSON']; } }), SyntaxError);
});

test('spectator leases deduplicate reconnects, expire, and remain separate from player seats in Redis', { skip: !process.env.TEST_REDIS_URL }, async t => {
  const { default: Redis } = await import('ioredis');
  const { randomUUID } = await import('node:crypto');
  const { GAME_KEY, USERS_KEY, SPECTATOR_KEY, SPECTATOR_LEASE_MS } = await import('./redis.mjs');
  const redis = new Redis(process.env.TEST_REDIS_URL, { keyPrefix: `metrics-test:${randomUUID()}:` });
  const keys = [USERS_KEY, GAME_KEY('game'), SPECTATOR_KEY('anonymous'), SPECTATOR_KEY('authenticated')];
  t.after(async () => { try { await redis.del(...keys); } finally { redis.disconnect(); } });
  await redis.hset(USERS_KEY, 'anon:host', 'game', 'member', 'game');
  await redis.set(GAME_KEY('game'), JSON.stringify({ id: 'game', status: 'playing', players: [{ id: 'anon:host' }, { id: 'member' }] }));
  const member = (game, viewer, connection) => JSON.stringify([game, viewer, connection]);
  const old = member('game', 'viewer', 'old'), fresh = member('game', 'viewer', 'new');
  await redis.zadd(SPECTATOR_KEY('anonymous'),
    Date.now(), old, Date.now(), fresh,
    Date.now(), member('other-game', 'viewer', 'other'),
    Date.now() - SPECTATOR_LEASE_MS - 1000, member('game', 'expired', 'gone'));
  await redis.zadd(SPECTATOR_KEY('authenticated'), Date.now(), member('game', 'account', 'tab'));
  assert.deepEqual(await collectSessions(redis), {
    player: { anonymous: 1, authenticated: 1 }, spectator: { anonymous: 2, authenticated: 1 },
  });
  assert.equal(await redis.zcard(SPECTATOR_KEY('anonymous')), 3);
  await redis.zrem(SPECTATOR_KEY('anonymous'), old);
  assert.equal((await collectSessions(redis)).spectator.anonymous, 2);
  await redis.zrem(SPECTATOR_KEY('anonymous'), fresh);
  assert.equal((await collectSessions(redis)).spectator.anonymous, 1);
});
