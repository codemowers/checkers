import { publishGame } from "../../../../lib/game-events";
import type { Game } from "../../../../lib/types";
import { randomUUID } from "node:crypto";
import { matchPlayer } from "../../../../lib/matchmaking";
import { identity } from "../../../../lib/identity";
import { authMode } from "../../../../lib/auth-mode";
import { GAME_KEY, PRESENCE_KEY, USERS_KEY, LOBBY_KEY, redis } from "../../../../lib/redis";
import { applyMove, InvalidMove, newGame } from "../../../../lib/rules";
import { isRuleset } from "../../../../lib/rulesets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const inviteOnly = authMode() === "invite";
  const player = await identity(request, { requireAuthenticated: inviteOnly });
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  let options;
  try { options = await request.json(); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return Response.json({ error: "Invalid matchmaking options" }, { status: 400 }); }
  if (!options || !isRuleset(options.ruleset)) {
    return Response.json({ error: "Choose a ruleset" }, { status: 400 });
  }
  await redis.zadd(PRESENCE_KEY, Date.now(), player.id);
  await redis.zremrangebyscore(PRESENCE_KEY, 0, Date.now() - 86_400_000);

  const id = randomUUID();
  let table = newGame(id, options.ruleset);
  {
    try { table = applyMove(table, 0, options.opening); }
    catch (error) { if (!(error instanceof InvalidMove)) throw error; return Response.json({ error: error.message }, { status: 422 }); }
  }
  const result = await matchPlayer(redis, {
    users: USERS_KEY, waiting: LOBBY_KEY(options.ruleset), game: GAME_KEY, presence: PRESENCE_KEY,
  }, player, table, inviteOnly ? "invite" : "open");
  if (result[0] === "retry") return Response.json({ error: "The lobby changed. Please try again." }, { status: 409 });
  if (result[0] === "game") {
    const raw = await redis.get(GAME_KEY(result[1]));
    if (raw) await publishGame(JSON.parse(raw) as Game);
  }
  return Response.json({ status: result[0], gameId: result[1] });
}
