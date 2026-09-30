import { GAME_KEY, USERS_KEY, SPECTATOR_KEY, SPECTATOR_LEASE_MS, getRedis } from './redis.mjs';

// Read authoritative assignments rather than counting sockets: reconnects,
// duplicate tabs must not add player seats. Each replica exports
// the same global snapshot; aggregate replicas with max, not sum.
export async function collectSessions(redis = getRedis()) {
  const assignments = new Map();
  let cursor = '0';
  do {
    const [next, entries] = await redis.hscan(USERS_KEY, cursor, 'COUNT', 200);
    cursor = next;
    for (let i = 0; i < entries.length; i += 2) assignments.set(entries[i], entries[i + 1]);
  } while (cursor !== '0');
  const games = [...new Set(assignments.values())];
  const counts = { player: { anonymous: 0, authenticated: 0 }, spectator: { anonymous: 0, authenticated: 0 } };
  for (let offset = 0; offset < games.length; offset += 200) {
    const records = await redis.mget(...games.slice(offset, offset + 200).map(GAME_KEY));
    for (const raw of records) {
      if (raw === null) continue;
      const game = JSON.parse(raw);
      if (game.status !== 'playing') continue;
      for (const player of game.players) {
        if (!player.id || player.id.startsWith('computer:') || assignments.get(player.id) !== game.id) continue;
        counts.player[player.id.startsWith('anon:') ? 'anonymous' : 'authenticated']++;
      }
    }
  }
  const cutoff = Date.now() - SPECTATOR_LEASE_MS;
  for (const auth of ['anonymous', 'authenticated']) {
    const key = SPECTATOR_KEY(auth);
    await redis.zremrangebyscore(key, '-inf', cutoff);
    const members = await redis.zrangebyscore(key, `(${cutoff}`, '+inf');
    // Separate connection leases make old-socket cleanup safe during reconnect.
    // Count the same viewer only once per game.
    const viewers = new Set(members.map(member => {
      const [game, viewer] = JSON.parse(member);
      return JSON.stringify([game, viewer]);
    }));
    counts.spectator[auth] = viewers.size;
  }
  return counts;
}

export function renderSessions(counts) {
  return '# HELP checkers_open_game_sessions Occupied human player seats in unfinished games and connected spectator seats.\n'
    + '# TYPE checkers_open_game_sessions gauge\n'
    + ['player', 'spectator'].flatMap(role =>
      ['anonymous', 'authenticated'].map(auth =>
        `checkers_open_game_sessions{role="${role}",auth="${auth}"} ${counts[role][auth]}\n`
      )).join('');
}
