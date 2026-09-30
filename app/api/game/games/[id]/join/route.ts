import { randomComputerName } from "../../../../../../lib/computer-names";
import { computerEnabled } from "../../../../../../lib/features";
import { identity } from "../../../../../../lib/identity";
import { playComputerTurn } from "../../../../../../lib/computer";
import { publishGame } from "../../../../../../lib/game-events";
import { claimSeat } from "../../../../../../lib/matchmaking";
import { toPublicGame } from "../../../../../../lib/public-game";
import { GAME_KEY, LOBBY_KEY, PRESENCE_KEY, USERS_KEY, redis } from "../../../../../../lib/redis";
import { playerIndex } from "../../../../../../lib/rules";
import type { Game } from "../../../../../../lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  let options;
  try { options = await request.json(); } catch (error) { if (!(error instanceof SyntaxError)) throw error; return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!options || !["human", "computer"].includes(options.opponent)) return Response.json({ error: "Invalid opponent" }, { status: 400 });
  if (options.opponent === "computer" && !computerEnabled()) return Response.json({ error: "Computer play is disabled." }, { status: 403 });
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await redis.get(GAME_KEY(id));
    if (!raw) return Response.json({ error: "This invitation has expired." }, { status: 404 });
    const game = JSON.parse(raw) as Game;
    const seat = playerIndex(game, player.id);
    if (options.opponent === "computer" && seat !== 0) return Response.json({ error: "Only the host can choose the computer." }, { status: 403 });
    if (seat >= 0 && (!game.waiting || options.opponent === "human")) return Response.json(toPublicGame(game, seat as 0 | 1));
    if (!game.waiting || game.status !== "playing") return Response.json({ error: "This table is already taken." }, { status: 409 });
    let updated = structuredClone(game);
    updated.players[1] = options.opponent === "computer" ? { id: `computer:${game.id}`, name: randomComputerName() } : player;
    updated.computer = options.opponent === "computer";
    delete updated.waiting;
    updated.revision++;
    updated.updatedAt = new Date().toISOString();
    updated = playComputerTurn(updated);
    const saved = await claimSeat(redis, {
      game: GAME_KEY, users: USERS_KEY, waiting: LOBBY_KEY(game.ruleset),
    }, raw, updated, player.id);
    if (saved === -1) return Response.json({ error: "Finish your current game before joining another table." }, { status: 409 });
    if (saved === 1) {
      await redis.zadd(PRESENCE_KEY, Date.now(), player.id);
      await publishGame(updated);
      return Response.json(toPublicGame(updated, options.opponent === "computer" ? 0 : 1));
    }
  }
  return Response.json({ error: "The table changed. Please try again." }, { status: 409 });
}
