import { expect, it } from "vitest";
import { soleLegalMove } from "./move-shortcuts";
import { applyMove, newGame } from "./rules";
import { toPublicGame } from "./public-game";

const forced = () => {
  const game = newGame("shortcut", "english");
  game.board = Array.from({ length: 8 }, () => Array(8).fill(0));
  game.board[5][0] = 1; game.board[4][1] = 2; game.board[2][3] = 2;
  return game;
};
it("plays only the next forced jump, including continuation", () => {
  const game = forced();
  const move = soleLegalMove(toPublicGame(game, 0), 0)!;
  expect(move).toEqual({ from: { row: 5, col: 0 }, to: { row: 3, col: 2 } });
  const next = applyMove(game, 0, move);
  expect(soleLegalMove(toPublicGame(next, 0), 0)).toEqual({ from: { row: 3, col: 2 }, to: { row: 1, col: 4 } });
});
it("does nothing with multiple moves, no move, a waiting table, or the wrong turn", () => {
  expect(soleLegalMove(toPublicGame(newGame("start", "english"), 0), 0)).toBeUndefined();
  const game = toPublicGame(forced(), 0);
  expect(soleLegalMove(game, 1)).toBeUndefined();
  expect(soleLegalMove({ ...game, waiting: true }, 0)).toBeUndefined();
  expect(soleLegalMove({ ...game, status: "finished" }, 0)).toBeUndefined();
  expect(soleLegalMove({ ...game, board: game.board.map(row => row.map(() => 0)) }, 0)).toBeUndefined();
});
