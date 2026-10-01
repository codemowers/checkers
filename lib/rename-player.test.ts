import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./identity", () => ({ identity: vi.fn() }));
vi.mock("./redis", () => ({ redis: { get: vi.fn(), eval: vi.fn() }, GAME_KEY: (id: string) => `game:${id}` }));
vi.mock("./game-store", () => ({ endGame: vi.fn() }));
import { GET, PATCH } from "../app/api/game/games/[id]/route";
import { identity } from "./identity";
import { redis } from "./redis";
import { gameChannel, lobbyChannel } from "./game-events";
import { newGame } from "./rules";
import { SAVE_GAME } from "./game-persistence";

const params = { params: Promise.resolve({ id: "table" }) };
const request = (name: unknown) => new Request("https://checkers.example/api/game/games/table", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(identity).mockResolvedValue({ id: "anon:host", name: "Old name" });
  const game = newGame("table");
  game.players = [{ id: "anon:host", name: "Old name" }, { id: "guest", name: "Guest" }];
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(game));
  vi.mocked(redis.eval).mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());
it("updates and publishes an anonymous player's name without changing their seat or board", async () => {
  const original = JSON.parse((await redis.get("game:table"))!);
  const response = await PATCH(request("  New   name  "), params);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ board: original.board, you: 0, players: [{ name: "New name" }, { name: "Guest" }] });
  expect(redis.eval).toHaveBeenCalledWith(SAVE_GAME, 3, "game:table", gameChannel("table"), lobbyChannel("english"), JSON.stringify(original), expect.any(String), "preserve", expect.any(String), "0");
  const event = JSON.parse(String(vi.mocked(redis.eval).mock.calls[0][8]));
  expect(event).toMatchObject({ type: "game", game: { revision: original.revision + 1, players: [{ id: "anon:host", name: "New name" }, { id: "guest", name: "Guest" }] } });
});
it.each(["", "x".repeat(41), "bad\u0000name", 123])("rejects invalid names: %j", async name => {
  expect((await PATCH(request(name), params)).status).toBe(400);
  expect(redis.eval).not.toHaveBeenCalled();
});
it.each([{ id: "member", name: "Member" }, { id: "anon:spectator", name: "Spectator" }])("does not rename signed-in users or other people's seats: %j", async player => {
  vi.mocked(identity).mockResolvedValue(player);
  expect((await PATCH(request("Changed"), params)).status).toBe(403);
  expect(redis.eval).not.toHaveBeenCalled();
});
it("reports concurrent changes without publishing a stale name update", async () => {
  vi.mocked(redis.eval).mockResolvedValue(0);
  expect((await PATCH(request("Changed"), params)).status).toBe(409);
  expect(redis.eval).toHaveBeenCalledTimes(3);
});
it("blocks spectator snapshots when disabled but allows seated players", async () => {
  vi.stubEnv("SPECTATOR_MODE", "disabled");
  const read = new Request("https://checkers.example/api/game/games/table");
  expect((await GET(read, params)).status).toBe(200);
  vi.mocked(identity).mockResolvedValue(null);
  expect((await GET(read, params)).status).toBe(403);
});
