import type Redis from "ioredis";
import { gameChannel, lobbyChannel } from "./game-events";
import type { Game } from "./types";

/** Snapshot comparison, persistence and notification commit together. */
export const SAVE_GAME = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[3] == 'preserve' then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
else
  redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
end
redis.call('PUBLISH', KEYS[2], ARGV[4])
if ARGV[5] == '1' then redis.call('PUBLISH', KEYS[3], 'changed') end
return 1
`;

export function saveGame(redis: Redis, key: string, raw: string, game: Game, expiry: "preserve" | "refresh") {
  return redis.eval(SAVE_GAME, 3, key, gameChannel(game.id), lobbyChannel(game.ruleset), raw, JSON.stringify(game), expiry,
    JSON.stringify({ type: "game", game }), game.waiting && game.matchmaking !== false ? "1" : "0");
}
