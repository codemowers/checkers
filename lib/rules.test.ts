import { describe, expect, it } from "vitest";
import { applyMove, InvalidMove, legalTargets, newGame, playerIndex } from "./rules";
import type { Game } from "./types";

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

function position(pieces: Record<string, number>): Game {
  const game = newGame("test");
  game.board = emptyBoard();
  for (const [square, piece] of Object.entries(pieces)) {
    const [row, col] = square.split(",").map(Number);
    game.board[row][col] = piece;
  }
  return game;
}

describe("checkers rules", () => {
  it("enforces captures and a multi-jump", () => {
    const game = position({ "5,0": 1, "4,1": 2, "2,3": 2 });
    const jumped = applyMove(game, 0, { from: { row: 5, col: 0 }, to: { row: 3, col: 2 } });
    expect(jumped.forced).toEqual({ row: 3, col: 2 });
    expect(jumped.turn).toBe(0);
    const finished = applyMove(jumped, 0, { from: { row: 3, col: 2 }, to: { row: 1, col: 4 } });
    expect(finished.forced).toBeUndefined();
  });

  it("rejects a quiet move while a capture exists", () => {
    const game = position({ "5,0": 1, "4,1": 2, "5,4": 1 });
    expect(() => applyMove(game, 0, { from: { row: 5, col: 4 }, to: { row: 4, col: 5 } })).toThrow(InvalidMove);
  });

  it("crowns a piece at the far edge", () => {
    const game = position({ "1,2": 1, "6,7": 2 });
    const next = applyMove(game, 0, { from: { row: 1, col: 2 }, to: { row: 0, col: 1 } });
    expect(next.board[0][1]).toBe(3);
  });

  it("refuses to let a man capture backwards", () => {
    const game = position({ "3,3": 1, "4,4": 2, "6,0": 2 });
    expect(() => applyMove(game, 0, { from: { row: 3, col: 3 }, to: { row: 5, col: 5 } })).toThrow(InvalidMove);
    // The jump is not a move at all, so it does not make the capture mandatory either.
    expect(legalTargets(game, 0, { row: 3, col: 3 })).toEqual([{ row: 2, col: 2 }, { row: 2, col: 4 }]);
  });

  it("lets a king capture backwards", () => {
    const game = position({ "3,3": 3, "4,4": 2 });
    const jumped = applyMove(game, 0, { from: { row: 3, col: 3 }, to: { row: 5, col: 5 } });
    expect(jumped.board[5][5]).toBe(3);
    expect(jumped.board[4][4]).toBe(0);
  });

  it("ends the turn on the jump that crowns a piece", () => {
    // [0,3] would have a further capture, but only with the king powers the
    // piece just earned, so the turn passes instead.
    const game = position({ "2,1": 1, "1,2": 2, "1,4": 2, "7,0": 2 });
    const crowned = applyMove(game, 0, { from: { row: 2, col: 1 }, to: { row: 0, col: 3 } });
    expect(crowned.board[0][3]).toBe(3);
    expect(crowned.forced).toBeUndefined();
    expect(crowned.turn).toBe(1);
  });

  it("draws a game that stops making progress", () => {
    let game = position({ "7,0": 3, "0,7": 4 });
    const here = [{ row: 7, col: 0 }, { row: 0, col: 7 }];
    const there = [{ row: 6, col: 1 }, { row: 1, col: 6 }];
    for (let ply = 0; ply < 80; ply++) {
      const side = (ply % 2) as 0 | 1;
      game = applyMove(game, side, { from: here[side], to: there[side] });
      [here[side], there[side]] = [there[side], here[side]];
    }
    expect(game.status).toBe("finished");
    expect(game.winner).toBeUndefined();
  });

  it("resets the draw counter on a capture or a man move", () => {
    const shuffled = applyMove(position({ "7,0": 3, "0,7": 4 }), 0, { from: { row: 7, col: 0 }, to: { row: 6, col: 1 } });
    expect(shuffled.idlePlies).toBe(1);
    const advanced = applyMove(position({ "5,0": 1, "0,7": 4 }), 0, { from: { row: 5, col: 0 }, to: { row: 4, col: 1 } });
    expect(advanced.idlePlies).toBe(0);
  });

  it("wins when the opponent has no move left", () => {
    const game = position({ "5,0": 1, "4,1": 2 });
    const won = applyMove(game, 0, { from: { row: 5, col: 0 }, to: { row: 3, col: 2 } });
    expect(won.status).toBe("finished");
    expect(won.winner).toBe(0);
  });

  it("never seats a caller on an unassigned seat", () => {
    expect(playerIndex(newGame("test"), "")).toBe(-1);
    const game = newGame("test");
    game.players[1].id = "anon:b";
    expect(playerIndex(game, "anon:b")).toBe(1);
  });

  it("offers the UI exactly the moves the server will accept", () => {
    const game = position({ "5,0": 1, "4,1": 2, "5,4": 1 });
    expect(legalTargets(game, 0, { row: 5, col: 4 })).toEqual([]);
    expect(legalTargets(game, 0, { row: 5, col: 0 })).toEqual([{ row: 3, col: 2 }]);
  });
});
