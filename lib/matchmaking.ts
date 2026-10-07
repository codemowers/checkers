import type Redis from "ioredis";
import { gameChannel, lobbyChannel } from "./game-events";
import type { Game, Player } from "./types";
import type { Ruleset } from "./rulesets";

/** Lobby discovery never creates a table, claims a seat or refreshes presence. */
export async function findWaitingGame(redis: Redis, keys: Pick<LobbyKeys, "waiting" | "presence" | "game">, playerId: string, ruleset: Ruleset): Promise<Game | undefined> {
  const candidates = await redis.zrange(keys.waiting, "0", "99");
  if (!candidates.length) return;
  const records = await redis.mget(...candidates.map(keys.game));
  for (const raw of records) {
    if (!raw) continue;
    const game = JSON.parse(raw) as Game;
    if (!game.waiting || game.status !== "playing" || game.matchmaking === false || game.ruleset !== ruleset || game.players[0].id === playerId) continue;
    const seen = await redis.zscore(keys.presence, game.players[0].id);
    if (seen !== null && Number(seen) >= Date.now() - 45_000) return game;
  }
}

// An opening offers an available table or creates one; invitations skip the queue.
export const MATCH = `
local current = redis.call('HGET', KEYS[1], ARGV[2])
if (current or '') ~= ARGV[6] then return {'retry', ''} end
local candidates = cjson.decode(ARGV[9])
local queued = ARGV[5] == 'invite' and {} or redis.call('ZRANGE', KEYS[2], 0, 99)
if #queued ~= #candidates then return {'retry', ''} end
for i, id in ipairs(queued) do
  if id ~= candidates[i] then return {'retry', ''} end
end
if current and ARGV[10] == '1' then
  local raw = redis.call('GET', KEYS[5])
  if raw then
    local existing = cjson.decode(raw)
    -- A human game is resumed, but a new opening may replace an old
    -- computer assignment so returning to the lobby can start a fresh game.
    if existing.status ~= 'finished' and not existing.computer then return {'game', current} end
  end
  redis.call('HDEL', KEYS[1], ARGV[2])
end
for i, id in ipairs(candidates) do
  local raw = redis.call('GET', KEYS[5 + i])
  local game = raw and cjson.decode(raw) or nil
  local seen = game and redis.call('ZSCORE', KEYS[4], game.players[1].id) or nil
  if game and game.waiting and game.matchmaking ~= false and game.players[1].id ~= ARGV[2] and game.status == 'playing' and seen and tonumber(seen) >= tonumber(ARGV[7]) - 45000 then
    return {'offer', raw}
  end
  redis.call('ZREM', KEYS[2], id)
end
local game = cjson.decode(ARGV[3])
game.players[1] = cjson.decode(ARGV[1])
game.waiting = true
game.matchmaking = ARGV[5] ~= 'invite'
redis.call('SET', KEYS[3], cjson.encode(game))
redis.call('HSET', KEYS[1], ARGV[2], ARGV[4])
if ARGV[5] ~= 'invite' then redis.call('ZADD', KEYS[2], ARGV[7], ARGV[4]) end
redis.call('PUBLISH', KEYS[6 + #candidates], cjson.encode({type = 'game', game = game}))
if game.matchmaking then redis.call('PUBLISH', KEYS[7 + #candidates], 'changed') end
return {'game', ARGV[4]}
`;

/** Claim a shared seat or switch it to a computer, never overwriting a concurrent join or move. */
export const CLAIM_SEAT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local current = redis.call('HGET', KEYS[2], ARGV[3])
if (current or '') ~= ARGV[5] then return 0 end
if current and current ~= ARGV[4] then
  local raw = redis.call('GET', KEYS[4])
  if raw and cjson.decode(raw).status ~= 'finished' then return -1 end
end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
redis.call('HSET', KEYS[2], ARGV[3], ARGV[4])
redis.call('ZREM', KEYS[3], ARGV[4])
redis.call('PUBLISH', KEYS[5], ARGV[6])
redis.call('PUBLISH', KEYS[6], 'changed')
return 1
`;

// Dragonfly requires every accessed key in KEYS. Discover keys before EVAL,
// then validate the snapshot inside the script before making any changes.
type LobbyKeys = { users: string; waiting: string; presence: string; game: (id: string) => string };
export async function matchPlayer(redis: Redis, keys: LobbyKeys, player: Player, table: Game, mode: "open" | "invite", resumeCurrent = true) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const assigned = await redis.hget(keys.users, player.id);
    if (!resumeCurrent && assigned) await redis.zrem(keys.waiting, assigned);
    const [current, queued] = await Promise.all([
      redis.hget(keys.users, player.id), mode === "invite" ? Promise.resolve([] as string[]) : redis.zrange(keys.waiting, "0", "99"),
    ]);
    // A fresh opening must not match the player's own waiting table.
    const candidates = resumeCurrent ? queued : queued.filter(id => id !== current);
    const declared = [keys.users, keys.waiting, keys.game(table.id), keys.presence,
      keys.game(current ?? table.id), ...candidates.map(keys.game),
      gameChannel(table.id), lobbyChannel(table.ruleset)];
    const now = Date.now();
    const result = await redis.eval(MATCH, declared.length, ...declared,
      JSON.stringify(player), player.id, JSON.stringify(table), table.id, mode,
      current ?? "", now, new Date(now).toISOString(), JSON.stringify(candidates), resumeCurrent ? "1" : "0") as [string, string];
    if (result[0] !== "retry") return result;
  }
  return ["retry", ""] as [string, string];
}

export async function claimSeat(redis: Redis, keys: Omit<LobbyKeys, "presence">, raw: string, updated: Game, playerId: string) {
  const current = await redis.hget(keys.users, playerId);
  return redis.eval(CLAIM_SEAT, 6, keys.game(updated.id), keys.users, keys.waiting,
    keys.game(current ?? updated.id), gameChannel(updated.id), lobbyChannel(updated.ruleset), raw, JSON.stringify(updated), playerId, updated.id, current ?? "",
    JSON.stringify({ type: "game", game: updated }));
}
