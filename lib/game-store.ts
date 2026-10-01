import { gameChannel, lobbyChannel } from "./game-events";
import { GAME_KEY, LOBBY_KEY, PRESENCE_KEY, USERS_KEY, redis } from "./redis";
import type { Game } from "./types";

export const RECONNECT_GRACE_MS = 3 * 60_000;

// Deletion, assignment cleanup and notification commit together on Redis, so
// every web replica sees the same result even if the caller disconnects.
export const END_GAME = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local game = cjson.decode(raw)
if game.revision ~= tonumber(ARGV[1]) then return 0 end
if ARGV[3] ~= '' then
  if game.status ~= 'playing' or game.waiting or game.computer then return 0 end
  if game.joinedAt and game.joinedAt >= tonumber(ARGV[4]) then return 0 end
  local seen = redis.call('ZSCORE', KEYS[2], ARGV[3])
  if seen and tonumber(seen) >= tonumber(ARGV[4]) then return 0 end
end
for _, player in ipairs(game.players) do
  if redis.call('HGET', KEYS[3], player.id) == game.id then
    redis.call('HDEL', KEYS[3], player.id)
    redis.call('ZREM', KEYS[2], player.id)
  end
end
redis.call('ZREM', KEYS[4], game.id)
redis.call('DEL', KEYS[1])
redis.call('PUBLISH', KEYS[5], ARGV[2])
redis.call('PUBLISH', KEYS[6], 'changed')
return 1
`;

export async function endGame(game: Game, message: string, stalePlayer?: string) {
  return redis.eval(END_GAME, 6, GAME_KEY(game.id), PRESENCE_KEY, USERS_KEY,
    LOBBY_KEY(game.ruleset), gameChannel(game.id), lobbyChannel(game.ruleset), game.revision,
    JSON.stringify({ type: "ended", message }), stalePlayer ?? "",
    Date.now() - RECONNECT_GRACE_MS);
}
