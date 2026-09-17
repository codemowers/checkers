import { randomUUID } from "node:crypto";
import { identity } from "../../../../lib/identity";
import { GAME_KEY, PRESENCE_KEY, USERS_KEY, WAITING_KEY, redis } from "../../../../lib/redis";
import { newGame } from "../../../../lib/rules";
import type { Game } from "../../../../lib/types";

export const dynamic = "force-dynamic";

const MATCH = `
local current = redis.call('HGET', KEYS[1], ARGV[2])
if current then return {'game', current} end
local waiting = redis.call('GET', KEYS[2])
if not waiting then
  redis.call('SET', KEYS[2], ARGV[1], 'EX', 5)
  return {'waiting', ''}
end
local candidate = cjson.decode(waiting)
if candidate.id == ARGV[2] then
  redis.call('EXPIRE', KEYS[2], 5)
  return {'waiting', ''}
end
local game = cjson.decode(ARGV[3])
game.players[1] = candidate
game.players[2] = cjson.decode(ARGV[1])
redis.call('SET', KEYS[3], cjson.encode(game), 'EX', 86400)
redis.call('HSET', KEYS[1], candidate.id, ARGV[4], ARGV[2], ARGV[4])
redis.call('DEL', KEYS[2])
return {'game', ARGV[4]}
`;

export async function POST(request: Request) {
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  await redis.zadd(PRESENCE_KEY, Date.now(), player.id);
  await redis.zremrangebyscore(PRESENCE_KEY, 0, Date.now() - 86_400_000);

  const existing = await redis.hget(USERS_KEY, player.id);
  if (existing) {
    const raw = await redis.get(GAME_KEY(existing));
    if (!raw || (JSON.parse(raw) as Game).status === "finished") await redis.hdel(USERS_KEY, player.id);
  }

  const id = randomUUID();
  const deadline = Date.now() + 20_000;
  do {
    const result = await redis.eval(MATCH, 3, USERS_KEY, WAITING_KEY, GAME_KEY(id), JSON.stringify(player), player.id, JSON.stringify(newGame(id)), id) as [string, string];
    if (result[0] === "game") return Response.json({ status: result[0], gameId: result[1] });
    await new Promise((resolve) => setTimeout(resolve, 750));
  } while (!request.signal.aborted && Date.now() < deadline);
  return Response.json({ status: "waiting", gameId: "" });
}
