import { expect, it } from "vitest";
import { acceptSnapshot } from "./game-snapshot";
import { newGame } from "./rules";
import { toPublicGame } from "./public-game";

it("keeps a newer seat and board when an older HTTP or spectator snapshot arrives", () => {
  const spectator = toPublicGame(newGame("table"), null);
  const joined = { ...spectator, revision: spectator.revision + 1, you: 1 as const };
  expect(acceptSnapshot(undefined, spectator)).toBe(spectator);
  expect(acceptSnapshot(spectator, joined)).toBe(joined);
  expect(acceptSnapshot(joined, spectator)).toBe(joined);
  expect(acceptSnapshot(joined, { ...spectator, revision: joined.revision })).toBe(joined);
  expect(acceptSnapshot(joined, { ...joined, id: "previous-game", revision: 100 })).toBe(joined);
});
