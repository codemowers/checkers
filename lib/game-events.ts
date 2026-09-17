import { redis } from "./redis";
import type { Game } from "./types";

/**
 * Server-to-server payload. Both seats share one channel, so the full game
 * travels here and each SSE connection narrows it with `toPublicGame`.
 */
export type PublishedEvent =
  | { type: "game"; game: Game }
  | { type: "ended"; message: string };

export const gameChannel = (id: string) => `checkers:events:${id}`;

export async function publishGame(game: Game) {
  await redis.publish(gameChannel(game.id), JSON.stringify({ type: "game", game } satisfies PublishedEvent));
}

export async function publishGameEnded(id: string, message: string) {
  await redis.publish(gameChannel(id), JSON.stringify({ type: "ended", message } satisfies PublishedEvent));
}
