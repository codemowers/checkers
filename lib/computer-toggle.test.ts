import { afterEach, expect, it, vi } from "vitest";
vi.mock("./identity", () => ({ identity: vi.fn(async () => ({ id: "host", name: "Host" })) }));
vi.mock("./redis", () => ({ redis: { get: vi.fn() } }));
vi.mock("./game-events", () => ({ publishGame: vi.fn() }));
import { POST } from "../app/api/game/games/[id]/join/route";
import { redis } from "./redis";

afterEach(() => vi.unstubAllEnvs());
it("rejects direct computer seat requests before reading or changing a game", async () => {
  vi.stubEnv("ENABLE_COMPUTER", "false");
  const response = await POST(new Request("https://checkers.example/api/game/games/table/join", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opponent: "computer" }),
  }), { params: Promise.resolve({ id: "table" }) });
  expect(response.status).toBe(403);
  expect(redis.get).not.toHaveBeenCalled();
});
