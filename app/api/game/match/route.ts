import { randomUUID } from "node:crypto";
import { matchPlayer } from "../../../../lib/matchmaking";
import { lobbyEvents } from "../../../../lib/lobby-events";
import { identity } from "../../../../lib/identity";
import { authMode } from "../../../../lib/auth-mode";
import { matchmakingEnabled } from "../../../../lib/features";
import { GAME_KEY, PRESENCE_KEY, USERS_KEY, LOBBY_KEY, redis } from "../../../../lib/redis";
import { applyMove, InvalidMove, newGame } from "../../../../lib/rules";
import { isRuleset } from "../../../../lib/rulesets";
import { rulesetAllowed } from "../../../../lib/rules-config";
import { toPublicGame } from "../../../../lib/public-game";
import type { Game } from "../../../../lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!matchmakingEnabled()) return Response.json({ error: "Matchmaking is disabled." }, { status: 403, headers });
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401, headers });
  const ruleset = new URL(request.url).searchParams.get("ruleset");
  if (!isRuleset(ruleset)) return Response.json({ error: "Choose a ruleset" }, { status: 400, headers });
  if (!rulesetAllowed(ruleset)) return Response.json({ error: "This ruleset is disabled." }, { status: 403, headers });
  return lobbyEvents(request, redis, { waiting: LOBBY_KEY(ruleset), presence: PRESENCE_KEY, game: GAME_KEY }, player.id, ruleset);
}

export async function POST(request: Request) {
  const inviteOnly = authMode() === "invite";
  const player = await identity(request, { requireAuthenticated: inviteOnly });
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  let options;
  try { options = await request.json(); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return Response.json({ error: "Invalid matchmaking options" }, { status: 400 }); }
  if (!options || !isRuleset(options.ruleset) || (options.invite !== undefined && typeof options.invite !== "boolean")) {
    return Response.json({ error: "Choose a ruleset" }, { status: 400 });
  }
  if (!rulesetAllowed(options.ruleset)) return Response.json({ error: "This ruleset is disabled." }, { status: 403 });
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
  }, player, table, matchmakingEnabled() && !options.invite ? "open" : "invite", false);
  if (result[0] === "retry") return Response.json({ error: "The lobby changed. Please try again." }, { status: 409 });
  if (result[0] === "offer") return Response.json({ status: "offer", game: toPublicGame(JSON.parse(result[1]) as Game, null) });
  return Response.json({ status: result[0], gameId: result[1] });
}
