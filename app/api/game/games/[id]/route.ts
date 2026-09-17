import { identity } from "../../../../../lib/identity";
import { publishGameEnded } from "../../../../../lib/game-events";
import { toPublicGame } from "../../../../../lib/public-game";
import { GAME_KEY, PRESENCE_KEY, USERS_KEY, redis } from "../../../../../lib/redis";
import { playerIndex } from "../../../../../lib/rules";
import type { Game } from "../../../../../lib/types";

export const dynamic = "force-dynamic";
const RECONNECT_GRACE_MS = 3 * 60_000;

function clearTable(game: Game) {
  return redis.multi()
    .hdel(USERS_KEY, game.players[0].id, game.players[1].id)
    .zrem(PRESENCE_KEY, game.players[0].id, game.players[1].id)
    .del(GAME_KEY(game.id))
    .exec();
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  const raw = await redis.get(GAME_KEY(params.id));
  if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
  const game = JSON.parse(raw) as Game;
  const index = playerIndex(game, player.id);
  if (index < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
  const now = Date.now();
  await redis.zadd(PRESENCE_KEY, now, player.id);
  const opponent = game.players[1 - index];
  const lastSeen = await redis.zscore(PRESENCE_KEY, opponent.id);
  if (game.status === "playing" && (!lastSeen || now - Number(lastSeen) > RECONNECT_GRACE_MS)) {
    await clearTable(game);
    return Response.json({ error: "The opponent did not reconnect in time." }, { status: 410 });
  }
  return Response.json(toPublicGame(game, index as 0 | 1), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  const raw = await redis.get(GAME_KEY(params.id));
  if (!raw) return Response.json({ ok: true });
  const game = JSON.parse(raw) as Game;
  if (playerIndex(game, player.id) < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
  await clearTable(game);
  await publishGameEnded(params.id, `${player.name} left the game.`);
  return Response.json({ ok: true });
}
