import { identity } from "../../../../../../lib/identity";
import { gameChannel, publishGameEnded, type PublishedEvent } from "../../../../../../lib/game-events";
import { toPublicGame } from "../../../../../../lib/public-game";
import { GAME_KEY, PRESENCE_KEY, USERS_KEY, redis } from "../../../../../../lib/redis";
import { playerIndex } from "../../../../../../lib/rules";
import type { Game, GameEvent } from "../../../../../../lib/types";

export const dynamic = "force-dynamic";
const RECONNECT_GRACE_MS = 3 * 60_000;
const encoder = new TextEncoder();

const EXPIRE_STALE_GAME = `
local seen = redis.call('ZSCORE', KEYS[2], ARGV[1])
if seen and tonumber(seen) >= tonumber(ARGV[2]) then return 0 end
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
redis.call('HDEL', KEYS[3], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1], ARGV[3])
redis.call('DEL', KEYS[1])
return 1
`;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const player = await identity(request);
  if (!player) return Response.json({ error: "Authentication required" }, { status: 401 });
  const key = GAME_KEY(params.id);
  const raw = await redis.get(key);
  if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
  const initial = JSON.parse(raw) as Game;
  const index = playerIndex(initial, player.id);
  if (index < 0) return Response.json({ error: "Forbidden" }, { status: 403 });
  const seat = index as 0 | 1;
  await redis.zadd(PRESENCE_KEY, Date.now(), player.id);

  const subscriber = redis.duplicate();
  subscriber.on("error", (error: Error) => console.error("Redis subscriber error:", error.message));
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let currentGame = initial;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const send = (event: GameEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        subscriber.disconnect();
        try { controller.close(); } catch {}
      };
      cleanup = finish;
      request.signal.addEventListener("abort", finish, { once: true });

      void (async () => {
        const channel = gameChannel(params.id);
        subscriber.on("message", (_channel, message) => {
          if (closed) return;
          // A throw in an emitter callback is an uncaught exception, which would
          // take down every other game served by this process.
          let event: PublishedEvent;
          try { event = JSON.parse(message) as PublishedEvent; }
          catch { return console.error("Discarding malformed game event on", channel); }
          if (event.type === "game") {
            currentGame = event.game;
            send({ type: "game", game: toPublicGame(event.game, seat) });
            return;
          }
          send(event);
          finish();
        });
        await subscriber.subscribe(channel);
        const latestRaw = await redis.get(key);
        if (!latestRaw) {
          send({ type: "ended", message: "The game is no longer available." });
          finish();
          return;
        }
        currentGame = JSON.parse(latestRaw) as Game;
        send({ type: "game", game: toPublicGame(currentGame, seat) });

        heartbeat = setInterval(() => void (async () => {
          if (closed) return;
          try {
            const now = Date.now();
            await redis.zadd(PRESENCE_KEY, now, player.id);
            if (currentGame.status === "playing") {
              const opponent = initial.players[1 - seat];
              const expired = await redis.eval(
                EXPIRE_STALE_GAME,
                3,
                key,
                PRESENCE_KEY,
                USERS_KEY,
                opponent.id,
                String(now - RECONNECT_GRACE_MS),
                initial.players[seat].id,
              );
              if (expired === 1) {
                await publishGameEnded(params.id, "The opponent did not reconnect in time.");
                return;
              }
              if (expired === -1) {
                send({ type: "ended", message: "The game is no longer available." });
                finish();
                return;
              }
            }
            if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            if (!closed) controller.enqueue(encoder.encode(": retry\n\n"));
          }
        })(), 15_000);
      })().catch(() => finish());
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
