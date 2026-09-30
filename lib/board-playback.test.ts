import { describe, expect, it } from "vitest";
import { playbackFrames, predictMove } from "./board-playback";
import { newGame, applyMove, legalMoves } from "./rules";
import { toPublicGame } from "./public-game";

const p = (row: number, col: number) => ({ row, col });
describe("board animation replay", () => {
  it("replays both sides from a combined update without repeating the optimistic move", () => {
    const source = newGame("replay");
    const red = applyMove(source, 0, legalMoves(source)[0]);
    const black = applyMove(red, 1, legalMoves(red)[0]);
    expect(playbackFrames(toPublicGame(source, 0), toPublicGame(black, 0))).toHaveLength(2);
    const predicted = predictMove(toPublicGame(source, 0), legalMoves(source)[0]);
    const frames = playbackFrames(predicted, toPublicGame(black, 0));
    expect(frames).toHaveLength(1);
    expect(frames[0].move?.from.row).toBe(2);
    expect(frames[0].game.board).toEqual(black.board);
  });

  it("replays each chained jump and records captured pieces for their flights", () => {
    let game = newGame("jumps");
    game.board = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    game.board[5][0] = 1; game.board[4][1] = 2; game.board[2][3] = 2;
    const before = toPublicGame(game, 1);
    game = applyMove(game, 0, { from: p(5, 0), to: p(3, 2) });
    game = applyMove(game, 0, { from: p(3, 2), to: p(1, 4) });
    const frames = playbackFrames(before, toPublicGame(game, 1));
    expect(frames.map((frame) => frame.move?.to)).toEqual([p(3, 2), p(1, 4)]);
    expect(frames.map((frame) => frame.captured)).toEqual([[{ at: p(4, 1), piece: 2 }], [{ at: p(2, 3), piece: 2 }]]);
  });

  it("animates a rejected prediction back to the last confirmed square", () => {
    const before = toPublicGame(newGame("rollback"), 0);
    const move = legalMoves(before)[0];
    const predicted = predictMove(before, move);
    const frames = playbackFrames(predicted, before);
    expect(frames[0].move).toEqual({ from: move.to, to: move.from });
    expect(frames[0].captured).toEqual([]);
  });

  it("promotes only at a genuine crowning and retains the move across metadata revisions", () => {
    const source = newGame("king");
    source.board = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
    source.board[1][2] = 1; source.board[6][7] = 2;
    const next = applyMove({ ...source, revision: source.revision + 1 }, 0, { from: p(1, 2), to: p(0, 1) });
    const frame = playbackFrames(toPublicGame(source, 0), toPublicGame(next, 0))[0];
    expect(frame.promoted).toBe(true);
    expect(frame.game.board[0][1]).toBe(3);
  });

  it("does not animate an acknowledgement or refresh with an unchanged board", () => {
    const game = toPublicGame(newGame("same"), 0);
    const frames = playbackFrames(game, { ...game, revision: 2 });
    expect(frames).toEqual([{ game: { ...game, revision: 2 }, captured: [] }]);
  });
});
