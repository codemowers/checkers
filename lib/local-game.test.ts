import { describe, expect, it } from "vitest";
import { localPlayCommitted, moveLocalGame, newLocalGame } from "./local-game";
import { legalMoves } from "./rules";
import { toPublicGame } from "./public-game";

describe("local play", () => {
  it.each(["english", "international"] as const)("plays %s moves without a server", ruleset => {
    let game = newLocalGame(ruleset);
    for (let index = 0; index < 8; index++) {
      const move = legalMoves(game)[0];
      game = moveLocalGame(game, move);
    }
    expect(game.revision).toBe(9);
    const players = toPublicGame(game, game.turn).players;
    expect(players.map(player => player.name)).toEqual(["", ""]);
    expect(players.every(player => !("id" in player))).toBe(true);
  });
  it.each(["english", "international"] as const)("keeps %s Red opening flexible and commits on Black reply", ruleset => {
    let game = newLocalGame(ruleset);
    expect(localPlayCommitted(game)).toBe(false);
    game = moveLocalGame(game, legalMoves(game)[0]);
    expect(game.turn).toBe(1);
    expect(localPlayCommitted(game)).toBe(false);
    game = moveLocalGame(game, legalMoves(game)[0]);
    expect(localPlayCommitted(game)).toBe(true);
    game = moveLocalGame(game, legalMoves(game)[0]);
    expect(localPlayCommitted(game)).toBe(true);
  });
});
