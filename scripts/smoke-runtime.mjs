import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const origin = `${process.env.SMOKE_SCHEME}://127.0.0.1:3001`;
const internal = "http://127.0.0.1:3002";
assert.equal((await fetch(origin)).status, 200);
for (const path of ['/metrics', '/api/health', '/health', '/ready']) {
  assert.equal((await fetch(origin + path)).status, 404, path);
}
assert.equal((await fetch(internal + '/health')).status, 200);

const headers = name => ({
  'content-type': 'application/json',
  'x-player-instance': randomUUID(),
  'x-player-name': name,
});
const host = headers('Host'), guest = headers('Guest'), viewer = headers('Viewer');
const counts = async (player, spectator) => {
  const response = await fetch(internal + '/metrics');
  assert.equal(response.status, 200);
  const metrics = await response.text();
  assert.match(metrics, new RegExp(`role="player",auth="anonymous"} ${player}\\n`));
  assert.match(metrics, new RegExp(`role="spectator",auth="anonymous"} ${spectator}\\n`));
  assert.match(metrics, /role="player",auth="authenticated"} 0\n/);
  assert.match(metrics, /role="spectator",auth="authenticated"} 0\n/);
  assert.doesNotMatch(metrics, /Host|Guest|Viewer|duration_seconds/);
};
// Stream cancellation propagates asynchronously to the HTTP server.
const waitForCounts = async (player, spectator) => {
  for (let attempt = 0; ; attempt++) {
    try { await counts(player, spectator); return; }
    catch (error) {
      if (!(error instanceof assert.AssertionError) || attempt >= 30) throw error;
    }
    await setTimeout(100);
  }
};
await counts(0, 0);
const created = await fetch(origin + '/api/game/match', {
  method: 'POST', headers: host,
  body: JSON.stringify({ ruleset: 'english', opening: { from: { row: 5, col: 0 }, to: { row: 4, col: 1 } } }),
});
assert.equal(created.status, 200);
const { gameId } = await created.json();
await counts(0, 0);
const joined = await fetch(`${origin}/api/game/games/${gameId}/join`, {
  method: 'POST', headers: guest, body: JSON.stringify({ opponent: 'human' }),
});
assert.equal(joined.status, 200);
await counts(0, 0);
const connect = async () => {
  const abort = new AbortController();
  const response = await fetch(`${origin}/api/game/games/${gameId}/events`, { headers: viewer, signal: abort.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const event = await reader.read();
  assert.equal(JSON.parse(new TextDecoder().decode(event.value).trim().slice(6)).game.you, null);
  return { abort, reader };
};
const first = await connect();
const second = await connect();
await counts(0, 2);
await first.reader.cancel();
first.abort.abort();
await waitForCounts(0, 1);
await second.reader.cancel();
second.abort.abort();
await waitForCounts(0, 0);
const quit = await fetch(`${origin}/api/game/games/${gameId}`, { method: 'DELETE', headers: host });
assert.equal(quit.status, 200);
await counts(0, 0);
