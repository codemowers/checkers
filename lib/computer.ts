import { applyMove, legalMoves, owner } from "./rules";
import type { Game, Move } from "./types";

function evaluate(game: Game): number {
  if (game.status === "finished") return game.winner === undefined ? 0 : game.winner === 1 ? 100_000 : -100_000;
  let score = 0;
  const middle = (game.board.length - 1) / 2;
  game.board.forEach((row, r) => row.forEach((piece, c) => {
    if (!piece) return;
    const side = owner(piece);
    const advancement = side === 1 ? r : game.board.length - 1 - r;
    const value = (piece >= 3 ? 300 : 100 + advancement * 6) + (middle - Math.abs(c - middle)) * 3;
    score += side === 1 ? value : -value;
  }));
  return score;
}

/** Iterative-deepening minimax with alpha-beta pruning; depth counts complete turns, including all jumps. */
export function chooseComputerMove(game: Game, budgetMs = 150): Move | undefined {
  const moves = legalMoves(game);
  if (!moves.length) return undefined;
  let best = moves[0];
  const deadline = performance.now() + budgetMs;
  let nodes = 0;
  const exhausted = new Error("Search budget exhausted");
  function search(state: Game, depth: number, alpha: number, beta: number): number {
    if (++nodes > 5_000 || performance.now() >= deadline) throw exhausted;
    if (state.status === "finished" || (depth <= 0 && !state.forced)) return evaluate(state);
    const maximizing = state.turn === 1;
    let value = maximizing ? -Infinity : Infinity;
    for (const move of legalMoves(state)) {
      const child = applyMove(state, state.turn, move, false);
      const score = search(child, depth - (child.turn !== state.turn ? 1 : 0), alpha, beta);
      value = maximizing ? Math.max(value, score) : Math.min(value, score);
      if (maximizing) alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
      if (beta <= alpha) break;
    }
    return value;
  }
  for (let depth = 1; depth <= 5; depth++) {
    let candidate = best;
    let value = game.turn === 1 ? -Infinity : Infinity;
    const ordered = [best, ...moves.filter((move) => move !== best)];
    try {
      for (const move of ordered) {
        const child = applyMove(game, game.turn, move, false);
        const score = search(child, depth - (child.turn !== game.turn ? 1 : 0), -Infinity, Infinity);
        if (game.turn === 1 ? score > value : score < value) { value = score; candidate = move; }
      }
      best = candidate;
    } catch (error) { if (error !== exhausted) throw error; break; }
  }
  return best;
}

/** Commit the human move and the full computer reply together, so a restart cannot strand a computer turn. */
export function playComputerTurn(source: Game): Game {
  let game = source;
  const deadline = performance.now() + 250;
  while (game.computer && game.status === "playing" && game.turn === 1) {
    const move = chooseComputerMove(game, Math.max(1, deadline - performance.now()));
    if (!move) break;
    game = applyMove(game, 1, move);
  }
  return game;
}
