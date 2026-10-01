import type { Game } from "./types";

/**
 * Server-to-server payload. Both seats share one channel, so the full game
 * travels here and each SSE connection narrows it with `toPublicGame`.
 */
export type PublishedEvent =
  | { type: "game"; game: Game }
  | { type: "ended"; message: string };

export const gameChannel = (id: string) => `checkers:events:${id}`;
export const lobbyChannel = (ruleset: string) => `checkers:lobby-events:${ruleset}`;
