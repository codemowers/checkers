import { describe, expect, it } from "vitest";
import { applyMove, legalMoves, legalTargets, newGame, InvalidMove } from "./rules";
import type { Game, Position } from "./types";

function position(pieces: Record<string, number>): Game {
  const game = newGame("international-test", "international");
  game.board = Array.from({ length: 10 }, () => Array<number>(10).fill(0));
  delete game.repetitions;
  for (const [square, piece] of Object.entries(pieces)) {
    const [row, col] = square.split(",").map(Number);
    game.board[row][col] = piece;
  }
  return game;
}
const p = (row: number, col: number): Position => ({ row, col });
const move = (game: Game, from: Position, to: Position) => applyMove(game, game.turn, { from, to });

describe("International rules", () => {
  it("starts with twenty men on each side of a 10×10 board", () => {
    const game = newGame("test", "international");
    expect(game.board).toHaveLength(10);
    expect(game.board.flat().filter((piece) => piece === 1)).toHaveLength(20);
    expect(game.board.flat().filter((piece) => piece === 2)).toHaveLength(20);
    expect(legalMoves(game)).toHaveLength(9);
  });

  it("requires backward captures by men but forbids backward quiet moves", () => {
    const game = position({ "3,2": 1, "4,3": 2, "8,7": 2 });
    expect(legalTargets(game, 0, p(3, 2))).toEqual([p(5, 4)]);
    expect(move(game, p(3, 2), p(5, 4)).board[4][3]).toBe(0);
    expect(() => move(position({ "3,2": 1, "8,7": 2 }), p(3, 2), p(4, 1))).toThrow(InvalidMove);
  });

  it("lets flying kings move and land any distance beyond a captured piece", () => {
    expect(legalTargets(position({ "5,4": 3, "0,9": 2 }), 0, p(5, 4))).toContainEqual(p(1, 0));
    const game = position({ "7,0": 3, "4,3": 2, "0,9": 2 });
    expect(legalTargets(game, 0, p(7, 0))).toEqual([p(3, 4), p(2, 5), p(1, 6), p(0, 7)]);
    const next = move(game, p(7, 0), p(1, 6));
    expect(next.board[4][3]).toBe(0);
    expect(next.board[1][6]).toBe(3);
  });

  it("requires the longest capture across pieces and within a chain", () => {
    const game = position({ "7,2": 1, "6,1": 2, "6,3": 2, "4,5": 2, "1,0": 1, "2,1": 2 });
    expect(legalMoves(game)).toEqual([{ from: p(7, 2), to: p(5, 4) }]);
    expect(() => move(game, p(7, 2), p(5, 0))).toThrow(InvalidMove);
    const next = move(game, p(7, 2), p(5, 4));
    expect(next.forced).toEqual(p(5, 4));
    expect(next.board[6][3]).toBe(2); // Blocks further jumps until the entire turn ends.
    expect(legalMoves(next)).toEqual([{ from: p(5, 4), to: p(3, 6) }]);
    const finished = move(next, p(5, 4), p(3, 6));
    expect(finished.board[6][3]).toBe(0);
    expect(finished.board[4][5]).toBe(0);
    expect(finished.turn).toBe(1);
  });

  it("allows either capture when their lengths tie, without preferring kings", () => {
    const game = position({ "5,4": 1, "4,3": 4, "4,5": 2 });
    expect(legalTargets(game, 0, p(5, 4))).toEqual([p(3, 2), p(3, 6)]);
  });

  it("cannot pass back through a previously captured piece", () => {
    const game = position({ "5,4": 3, "4,3": 2, "6,5": 2 });
    const next = move(game, p(5, 4), p(3, 2));
    expect(next.forced).toBeUndefined();
    expect(next.board[6][5]).toBe(2);
  });

  it("continues through the promotion row as a man and only crowns when ending there", () => {
    const game = position({ "2,1": 1, "1,2": 2, "1,4": 2, "8,9": 2 });
    const first = move(game, p(2, 1), p(0, 3));
    expect(first.board[0][3]).toBe(1);
    expect(first.forced).toEqual(p(0, 3));
    const second = move(first, p(0, 3), p(2, 5));
    expect(second.board[2][5]).toBe(1);
    expect(second.turn).toBe(1);
    const crowned = move(position({ "2,1": 1, "1,2": 2, "8,9": 2 }), p(2, 1), p(0, 3));
    expect(crowned.board[0][3]).toBe(3);
  });

  it("draws on the third occurrence of a position with the same side to move", () => {
    let game = position({ "9,0": 3, "0,7": 4, "8,9": 1, "1,0": 2 });
    for (let repeat = 0; repeat < 2; repeat++) {
      game = move(game, p(9, 0), p(8, 1));
      game = move(game, p(0, 7), p(1, 6));
      game = move(game, p(8, 1), p(9, 0));
      game = move(game, p(1, 6), p(0, 7));
    }
    expect(game.status).toBe("finished");
    expect(game.winner).toBeUndefined();
  });

  it("enforces 25 king moves per side without progress and prioritizes wins", () => {
    const game = position({ "9,0": 3, "0,7": 4, "8,9": 1, "1,0": 2 });
    game.idlePlies = 49;
    expect(move(game, p(9, 0), p(8, 1)).status).toBe("finished");
    const win = position({ "5,0": 1, "4,1": 2 });
    win.endgamePlies = 1;
    expect(move(win, p(5, 0), p(3, 2)).winner).toBe(0);
  });

  it("starts the 16-move and five-move reduced-material countdowns", () => {
    const three = position({ "9,0": 3, "9,4": 3, "9,8": 1, "0,7": 4 });
    expect(move(three, p(9, 0), p(8, 1)).endgamePlies).toBe(31);
    const two = position({ "9,0": 3, "9,4": 1, "0,7": 4 });
    expect(move(two, p(9, 0), p(8, 1)).endgamePlies).toBe(9);
    two.endgamePlies = 1;
    expect(move(two, p(9, 0), p(8, 1)).status).toBe("finished");
  });

  it("defaults new games to English rules", () => {
    const game = newGame("default");
    expect(game.ruleset).toBe("english");
    expect(game.board).toHaveLength(8);
    expect(legalMoves(game)).toHaveLength(7);
  });
});
