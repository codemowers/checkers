import { describe, expect, it } from "vitest";
import { chooseComputerMove, playComputerTurn } from "./computer";
import { applyMove, legalMoves, newGame } from "./rules";

describe("computer opponent", () => {
  it.each(["english", "international"] as const)("replies legally under %s rules", (ruleset) => {
    const game = newGame("computer", ruleset);
    game.computer = true;
    const human = applyMove(game, 0, legalMoves(game)[0]);
    const reply = chooseComputerMove(human, 30);
    expect(legalMoves(human)).toContainEqual(reply);
    const result = playComputerTurn(human);
    expect(result.turn).toBe(0);
    expect(result.revision).toBeGreaterThan(human.revision);
    expect(human.turn).toBe(1);
  });

  it("completes every jump and wins when the last red pieces are captured", () => {
    const game = newGame("chain", "english");
    game.computer = true;
    game.turn = 1;
    game.board = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    game.board[2][1] = 2;
    game.board[3][2] = 1;
    game.board[5][4] = 1;
    const result = playComputerTurn(game);
    expect(result.status).toBe("finished");
    expect(result.winner).toBe(1);
    expect(result.board[6][5]).toBe(2);
    expect(result.forced).toBeUndefined();
  });

  it("looks ahead to avoid giving away a man", () => {
    const game = newGame("tactic");
    game.turn = 1;
    game.board = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    game.board[2][3] = 2;
    game.board[4][5] = 1;
    expect(chooseComputerMove(game, 1000)).toEqual({ from: { row: 2, col: 3 }, to: { row: 3, col: 2 } });
  });

  it.each(["english", "international"] as const)("plays both sides of a %s demo legally", (ruleset) => {
    let game = newGame("demo", ruleset);
    const turns = new Set<number>();
    for (let ply = 0; ply < 24 && game.status === "playing"; ply++) {
      turns.add(game.turn);
      const move = chooseComputerMove(game, 5);
      expect(legalMoves(game)).toContainEqual(move);
      const next = applyMove(game, game.turn, move!);
      expect(next.revision).toBe(game.revision + 1);
      game = next;
    }
    expect([...turns].sort()).toEqual([0, 1]);
  });

  it("does not play for a human or change a finished game", () => {
    const game = newGame("human");
    expect(playComputerTurn(game)).toBe(game);
    game.computer = true;
    expect(playComputerTurn(game)).toBe(game);
    game.status = "finished";
    expect(chooseComputerMove(game)).toBeUndefined();
  });
});
