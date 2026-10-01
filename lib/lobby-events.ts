import type Redis from "ioredis";
import { lobbyChannel } from "./game-events";
import { findWaitingGame } from "./matchmaking";
import { toPublicGame } from "./public-game";
import type { Ruleset } from "./rulesets";

/** Subscribe before reading; serialize refreshes so an old read cannot win a race. */
export function lobbyEvents(request: Request, redis: Redis, keys: { waiting: string; presence: string; game: (id: string) => string }, playerId: string, ruleset: Ruleset) {
  const subscriber = redis.duplicate();
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let reading = false;
      let dirty = false;
      let last = "";
      let expiry: ReturnType<typeof setTimeout> | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const dispose = () => {
        closed = true;
        if (expiry) clearTimeout(expiry);
        if (heartbeat) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", finish);
        subscriber.disconnect();
      };
      const finish = () => {
        if (closed) return;
        dispose();
        controller.close();
      };
      const fail = (error: unknown) => {
        if (closed) return;
        dispose();
        controller.error(error);
      };
      const refresh = async () => {
        dirty = true;
        if (closed || reading) return;
        reading = true;
        try {
          while (dirty && !closed) {
            dirty = false;
            const game = await findWaitingGame(redis, keys, playerId, ruleset);
            const seen = game ? await redis.zscore(keys.presence, game.players[0].id) : null;
            if (closed) return;
            if (dirty) continue;
            const remaining = seen === null ? 0 : Number(seen) + 45_001 - Date.now();
            const offered = game && remaining > 0 ? game : undefined;
            const data = JSON.stringify({ game: offered ? toPublicGame(offered, null) : null });
            if (data !== last) {
              last = data;
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
            if (expiry) clearTimeout(expiry);
            // Presence has no Redis expiry event: check this offer when its lease
            // expires. A renewed host lease schedules the next deadline.
            expiry = offered ? setTimeout(() => void refresh().catch(fail), remaining) : undefined;
          }
        } finally { reading = false; }
      };
      cleanup = dispose;
      subscriber.on("error", fail);
      // Redis cannot replay missed publications; reconnect the SSE client.
      subscriber.on("close", finish);
      subscriber.on("message", () => { void refresh().catch(fail); });
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) { finish(); return; }
      void (async () => {
        await subscriber.subscribe(lobbyChannel(ruleset));
        if (closed) return;
        await refresh();
        if (closed) return;
        heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
        }, 15_000);
      })().catch(fail);
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}
