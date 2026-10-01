import { spectatorMode } from "../../../../../lib/features";
import { saveGame } from "../../../../../lib/game-persistence";
import { identity } from "../../../../../lib/identity";
import { endGame } from "../../../../../lib/game-store";
import { toPublicGame } from "../../../../../lib/public-game";
import { GAME_KEY, redis } from "../../../../../lib/redis";
import { playerIndex } from "../../../../../lib/rules";
import type { Game } from "../../../../../lib/types";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  const raw = await redis.get(GAME_KEY(id));
  if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
  const game = JSON.parse(raw) as Game;
  const index = player ? playerIndex(game, player.id) : -1;
  if (index < 0 && spectatorMode() === "disabled") return Response.json({ error: "Spectating is disabled." }, { status: 403 });
  return Response.json(toPublicGame(game, index < 0 ? null : index as 0 | 1), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  const raw = await redis.get(GAME_KEY(id));
  if (!raw) return Response.json({ ok: true });
  const game = JSON.parse(raw) as Game;
  if (playerIndex(game, player.id) < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
  const ended = await endGame(game, `${player.name} left the game.`);
  if (ended === 0) return Response.json({ error: "The game changed. Please try again." }, { status: 409 });
  return Response.json({ ok: true });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!player.id.startsWith("anon:")) return Response.json({ error: "Signed-in names come from your account." }, { status: 403 });
  let body;
  try { body = await request.json(); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return Response.json({ error: "Invalid name" }, { status: 400 }); }
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) return Response.json({ error: "Enter a name of 1–40 characters." }, { status: 400 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await redis.get(GAME_KEY(id));
    if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
    const game = JSON.parse(raw) as Game;
    const seat = playerIndex(game, player.id);
    if (seat < 0) return Response.json({ error: "You do not have a seat at this table." }, { status: 403 });
    game.players[seat].name = name;
    game.revision++;
    game.updatedAt = new Date().toISOString();
    if (await saveGame(redis, GAME_KEY(id), raw, game, "preserve") === 1) {
      return Response.json(toPublicGame(game, seat as 0 | 1));
    }
  }
  return Response.json({ error: "The game changed. Please try again." }, { status: 409 });
}
