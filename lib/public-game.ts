import type { Game, PublicGame } from "./types";

/**
 * Strip player ids before a game leaves the server. In anonymous mode the id is
 * the only credential a seat has, so handing it to the opponent would let them
 * move and resign on your behalf.
 */
export function toPublicGame(game: Game, you: 0 | 1): PublicGame {
  const { players, ...rest } = game;
  return { ...rest, players: [{ name: players[0].name }, { name: players[1].name }], you };
}
