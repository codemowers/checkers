import type { Game, PublicGame } from "./types";

/**
 * Strip player ids before a game leaves the server. In anonymous mode the id is
 * the only credential a seat has, so handing it to the opponent would let them
 * move and resign on your behalf.
 */
export function toPublicGame(game: Game, you: 0 | 1 | null): PublicGame {
  const { players, ...rest } = game;
  const publicPlayer = ({ id, name, avatar }: Game["players"][number]) => ({ name, ...(avatar ? { avatar } : {}), anonymous: id.startsWith("anon:"), computer: id.startsWith("computer:") });
  return { ...rest, players: [publicPlayer(players[0]), publicPlayer(players[1])], you };
}
