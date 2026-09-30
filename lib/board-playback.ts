import { applyMove, InvalidMove, owner, same } from "./rules";
import type { Move, Position, PublicGame } from "./types";

export type BoardFrame = { game: PublicGame; move?: Move; captured: { at: Position; piece: number }[]; promoted?: boolean };
export const sameBoard = (a: PublicGame, b: PublicGame) => JSON.stringify(a.board) === JSON.stringify(b.board);
export function predictMove(game: PublicGame, move: Move): PublicGame {
  const next = applyMove({ ...game, players: [{ id: "", name: game.players[0].name }, { id: "", name: game.players[1].name }] }, game.turn, move);
  return { ...next, players: game.players, you: game.you };
}
function frame(before: PublicGame, game: PublicGame, move?: Move): BoardFrame {
  const captured: BoardFrame["captured"] = [];
  before.board.forEach((row, r) => row.forEach((piece, col) => {
    const at = { row: r, col };
    if (piece && !game.board[r]?.[col] && !same(at, move?.from)) captured.push({ at, piece });
  }));
  return { game, move, captured, promoted: !!move && before.board[move.from.row][move.from.col] < 3 && game.board[move.to.row][move.to.col] >= 3 };
}
/** Recover every jump even when one server update contains a human move and a whole computer turn. */
export function playbackFrames(before: PublicGame, after: PublicGame): BoardFrame[] {
  if (sameBoard(before, after)) return [{ game: after, captured: [] }];
  let current = before;
  const frames: BoardFrame[] = [];
  try {
    for (const move of after.recentMoves ?? []) {
      if (move.revision <= before.revision) continue;
      const next = predictMove(current, move);
      next.revision = move.revision;
      frames.push(frame(current, next, move));
      current = next;
    }
    if (frames.length && sameBoard(current, after)) {
      frames[frames.length - 1].game = after;
      return frames;
    }
  } catch (error) {
    if (!(error instanceof InvalidMove)) throw error;
    // A rejected optimistic move or missing history uses a board diff.
  }
  const arrivals: Position[] = [], departures: Position[] = [];
  after.board.forEach((row, r) => row.forEach((piece, col) => {
    if (piece && !before.board[r]?.[col]) arrivals.push({ row: r, col });
    if (!piece && before.board[r]?.[col]) departures.push({ row: r, col });
  }));
  if (arrivals.length === 1) {
    const to = arrivals[0];
    const from = departures.find((p) => owner(before.board[p.row][p.col]) === owner(after.board[to.row][to.col]));
    if (from) return [frame(before, after, { from, to })];
  }
  return [{ game: after, captured: [] }];
}
