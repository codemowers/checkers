import { playComputerTurn } from "../../../../../../lib/computer";
import { identity } from "../../../../../../lib/identity";
import { saveGame } from "../../../../../../lib/game-persistence";
import { toPublicGame } from "../../../../../../lib/public-game";
import { GAME_KEY, PRESENCE_KEY, redis } from "../../../../../../lib/redis";
import { applyMove, InvalidMove, playerIndex } from "../../../../../../lib/rules";
import type { Game, Move } from "../../../../../../lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  await redis.zadd(PRESENCE_KEY, Date.now(), player.id);
  let move: Move;
  try { move = await request.json(); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return Response.json({ error: "Invalid move" }, { status: 400 }); }
  const key = GAME_KEY(id);

  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await redis.get(key);
    if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
    const game = JSON.parse(raw) as Game;
    const index = playerIndex(game, player.id);
    if (index < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
    if (game.waiting) return Response.json({ error: "Waiting for an opponent." }, { status: 409 });
    let updated: Game;
    try { updated = playComputerTurn(applyMove(game, index, move)); }
    catch (error) {
      if (error instanceof InvalidMove) return Response.json({ error: error.message }, { status: 422 });
      throw error;
    }
    const saved = await saveGame(redis, key, raw, updated, "refresh");
    if (saved === 1) {
      return Response.json(toPublicGame(updated, index as 0 | 1));
    }
  }
  return Response.json({ error: "The board changed; try again." }, { status: 409 });
}
