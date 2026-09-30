import { legalMoves } from "./rules";
import type { PublicGame } from "./types";

export function soleLegalMove(game: PublicGame, player: number) {
  if (game.status !== "playing" || game.waiting || game.turn !== player) return undefined;
  const moves = legalMoves(game);
  return moves.length === 1 ? moves[0] : undefined;
}

/** Space must keep its normal behavior in forms, links, and buttons. */
export function isMoveShortcut(event: KeyboardEvent) {
  if (event.code !== "Space" || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest("input, textarea, select, button, a, [contenteditable]:not([contenteditable=false]), [role=button], [role=textbox]"));
}
