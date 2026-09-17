import { identity } from "../../../../../../lib/identity";
import { publishGame } from "../../../../../../lib/game-events";
import { toPublicGame } from "../../../../../../lib/public-game";
import { GAME_KEY, PRESENCE_KEY, redis } from "../../../../../../lib/redis";
import { applyMove, InvalidMove, playerIndex } from "../../../../../../lib/rules";
import type { Game, Move } from "../../../../../../lib/types";

export const dynamic = "force-dynamic";

const COMPARE_AND_SET = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', 86400)
return 1
`;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  await redis.zadd(PRESENCE_KEY, Date.now(), player.id);
  let move: Move;
  try { move = await request.json(); }
  catch { return Response.json({ error: "Invalid move" }, { status: 400 }); }
  const key = GAME_KEY(params.id);

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await redis.get(key);
    if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
    const game = JSON.parse(raw) as Game;
    const index = playerIndex(game, player.id);
    if (index < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
    let updated: Game;
    try { updated = applyMove(game, index, move); }
    catch (error) {
      if (error instanceof InvalidMove) return Response.json({ error: error.message }, { status: 422 });
      return Response.json({ error: "Invalid move" }, { status: 400 });
    }
    const saved = await redis.eval(COMPARE_AND_SET, 1, key, raw, JSON.stringify(updated));
    if (saved === 1) {
      await publishGame(updated);
      return Response.json(toPublicGame(updated, index as 0 | 1));
    }
  }
  return Response.json({ error: "The board changed; try again." }, { status: 409 });
}
