import { applyMove, newGame } from "./rules";
import type { Ruleset } from "./rulesets";
import type { Game, Move } from "./types";

/** The initial Red move is quiet in both rulesets; Black's reply commits locally. */
export const localPlayCommitted = (game: Game) => game.revision > 2;

export function newLocalGame(ruleset: Ruleset): Game {
  return newGame(`local:${crypto.randomUUID()}`, ruleset);
}

export function moveLocalGame(game: Game, move: Move): Game {
  return applyMove(game, game.turn, move);
}
