import { randomUUID } from "node:crypto";
import { matchmakingEnabled, spectatorMode } from "../../../../../../lib/features";
import { identity } from "../../../../../../lib/identity";
import { gameChannel, lobbyChannel, type PublishedEvent } from "../../../../../../lib/game-events";
import { endGame } from "../../../../../../lib/game-store";
import { toPublicGame } from "../../../../../../lib/public-game";
import { GAME_KEY, PRESENCE_KEY, LOBBY_KEY, SPECTATOR_KEY, redis } from "../../../../../../lib/redis";
import { playerIndex } from "../../../../../../lib/rules";
import type { Game, GameEvent } from "../../../../../../lib/types";
import { trackOpenConnection } from "../../../../../../runtime/open-connections.mjs";

export const dynamic = "force-dynamic";
const encoder = new TextEncoder();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = await identity(request);
  const key = GAME_KEY(id);
  const raw = await redis.get(key);
  if (!raw) return Response.json({ error: "Game not found" }, { status: 404 });
  const initial = JSON.parse(raw) as Game;
  const seatFor = (game: Game) => {
    const index = player ? playerIndex(game, player.id) : -1;
    return index < 0 ? null : index as 0 | 1;
  };
  // Invite links are view-only until the visitor explicitly claims a seat.
  if (seatFor(initial) === null && spectatorMode() === "disabled") {
    return Response.json({ error: "Join this table before playing." }, { status: 403 });
  }
  if (seatFor(initial) !== null) await redis.zadd(PRESENCE_KEY, Date.now(), player!.id);

  const spectatorKey = SPECTATOR_KEY(player && !player.id.startsWith("anon:") ? "authenticated" : "anonymous");
  const instance = request.headers.get("x-player-instance") ?? "";
  const viewer = player?.id ?? (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instance) ? instance : randomUUID());
  const spectatorMember = JSON.stringify([id, viewer, randomUUID()]);
  const startedSpectating = seatFor(initial) === null;
  const auth = player && !player.id.startsWith("anon:") ? "authenticated" : "anonymous";
  const connection = trackOpenConnection(initial.status === "playing" ? (startedSpectating ? "spectator" : "player") : undefined, auth);
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
      const refreshSpectator = async () => {
        if (!startedSpectating) return;
        if (!closed && seatFor(currentGame) === null) await redis.zadd(spectatorKey, Date.now(), spectatorMember);
        // Recheck after the write: the socket may close or claim a seat while awaiting Redis.
        if (closed || seatFor(currentGame) !== null) await redis.zrem(spectatorKey, spectatorMember);
      };
      const dispose = () => {
        closed = true;
        connection.close();
        if (heartbeat) clearInterval(heartbeat);
        subscriber.disconnect();
        request.signal.removeEventListener("abort", finish);
        // The response is already closed; report cleanup failures and let the lease expire.
        void refreshSpectator().catch(error => console.error("Spectator cleanup failed:", error));
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
        console.error("Game stream failed:", error);
      };
      cleanup = dispose;
      // Redis pub/sub cannot replay updates missed during a disconnect. Let
      // the browser reconnect and subscribe before reading a fresh snapshot.
      subscriber.on("close", finish);
      request.signal.addEventListener("abort", finish, { once: true });
      if (request.signal.aborted) { finish(); return; }

      void (async () => {
        const channel = gameChannel(id);
        subscriber.on("message", (_channel, message) => {
          if (closed) return;
          // A throw in an emitter callback is an uncaught exception, which would
          // take down every other game served by this process.
          let event: PublishedEvent;
          try { event = JSON.parse(message) as PublishedEvent; }
          catch (error) { if (!(error instanceof SyntaxError)) throw error; fail(error); return; }
          if (event.type === "game") {
            if (event.game.revision <= currentGame.revision) return;
            currentGame = event.game;
            connection.set(event.game.status === "playing" ? (seatFor(event.game) === null ? "spectator" : "player") : undefined);
            void refreshSpectator().catch(fail);
            send({ type: "game", game: toPublicGame(event.game, seatFor(event.game)) });
            return;
          }
          send(event);
          finish();
        });
        await subscriber.subscribe(channel);
        if (closed) return;
        const latestRaw = await redis.get(key);
        if (closed) return;
        if (!latestRaw) {
          send({ type: "ended", message: "The game is no longer available." });
          finish();
          return;
        }
        const latest = JSON.parse(latestRaw) as Game;
        if (latest.revision > currentGame.revision) currentGame = latest;
        connection.set(currentGame.status === "playing" ? (seatFor(currentGame) === null ? "spectator" : "player") : undefined);
        await refreshSpectator();
        if (closed) return;
        if (seatFor(currentGame) === 0 && currentGame.waiting && currentGame.matchmaking !== false && matchmakingEnabled()) {
          await redis.zadd(LOBBY_KEY(currentGame.ruleset), Date.now(), currentGame.id);
          await redis.publish(lobbyChannel(currentGame.ruleset), "changed");
        }
        send({ type: "game", game: toPublicGame(currentGame, seatFor(currentGame)) });

        heartbeat = setInterval(() => void (async () => {
          if (closed) return;
          await refreshSpectator();
          if (closed) return;
          const now = Date.now();
          const seat = seatFor(currentGame);
          if (seat !== null) await redis.zadd(PRESENCE_KEY, now, player!.id);
          if (seatFor(currentGame) === 0 && currentGame.waiting && currentGame.matchmaking !== false && matchmakingEnabled()) {
            const added = await redis.zadd(LOBBY_KEY(currentGame.ruleset), now, currentGame.id);
            if (added) await redis.publish(lobbyChannel(currentGame.ruleset), "changed");
          }
          if (seat !== null && currentGame.status === "playing" && !currentGame.computer && !currentGame.waiting) {
            const opponent = currentGame.players[1 - seat];
            const expired = await endGame(currentGame, "The opponent did not reconnect in time.", opponent.id);
            if (expired === 1) return;
            if (expired === -1) {
              send({ type: "ended", message: "The game is no longer available." });
              finish();
              return;
            }
          }
          if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
        })().catch(fail), 15_000);
      })().catch(fail);
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
