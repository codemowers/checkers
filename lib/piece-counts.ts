import { RULESETS } from "./rulesets";
import { owner } from "./rules";
import type { BoardState } from "./types";

/** Captured International pieces still on the board count as live until turn end. */
export function capturedCounts(game: Pick<BoardState, "board" | "ruleset">): [number, number] {
  const starting = RULESETS[game.ruleset].pieces;
  const captured: [number, number] = [starting, starting];
  for (const row of game.board) for (const piece of row) {
    const side = owner(piece);
    if (side >= 0) captured[1 - side]--;
  }
  return captured;
}
