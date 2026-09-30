import { expect, it } from "vitest";
import { newGame } from "./rules";
import { toPublicGame } from "./public-game";
import { anonymousIcon } from "./anonymous-names";

it("identifies an anonymous opponent for their emoji without exposing seat credentials", () => {
  const game = newGame("invite", "english");
  game.players = [{ id: "member-secret", name: "Host" }, { id: "anon:guest-secret", name: "Focal Fox" }];
  const visible = toPublicGame(game, 0);
  expect(visible.players).toEqual([{ name: "Host", anonymous: false, computer: false }, { name: "Focal Fox", anonymous: true, computer: false }]);
  expect(anonymousIcon(visible.players[1].name)).toBe("🦊");
  expect(JSON.stringify(visible)).not.toContain("secret");
});

it.each([0, 1, null] as const)("shares authenticated avatars with both players and spectators (viewer=%s)", viewer => {
  const game = newGame("avatars");
  const avatar = "https://www.gravatar.com/avatar/test-avatar?d=identicon&s=160";
  game.players = [{ id: "anon:host-secret", name: "Focal Fox" }, { id: "member-secret", name: "Lauri", avatar }];
  const visible = toPublicGame(game, viewer);
  expect(visible.players[1]).toEqual({ name: "Lauri", avatar, anonymous: false, computer: false });
  expect(JSON.stringify(visible)).not.toContain("secret");
});
