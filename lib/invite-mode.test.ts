import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("./auth", () => ({ authOptions: {} }));
vi.mock("./redis", () => ({
  redis: { zadd: vi.fn(), zremrangebyscore: vi.fn() },
  GAME_KEY: (id: string) => `game:${id}`, USERS_KEY: "users", PRESENCE_KEY: "presence", LOBBY_KEY: (rules: string) => `lobby:${rules}`,
}));
vi.mock("./matchmaking", () => ({ matchPlayer: vi.fn(async () => ["waiting", "table"]) }));
vi.mock("./game-events", () => ({ publishGame: vi.fn() }));
import { getServerSession } from "next-auth";
import { POST } from "../app/api/game/match/route";
import { matchPlayer } from "./matchmaking";
import { redis } from "./redis";
import { legalMoves, newGame } from "./rules";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_MODE", "invite");
  vi.stubEnv("OIDC_ISSUER", "https://auth.example");
  vi.stubEnv("OIDC_CLIENT_ID", "checkers");
  vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
  vi.stubEnv("ALLOW_SELF_PLAY", "false");
  vi.mocked(getServerSession).mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
const request = () => new Request("https://checkers.example/api/game/match", {
  method: "POST", headers: { "content-type": "application/json", "x-player-instance": "12345678-1234-4234-8234-123456789abc", "x-player-name": "Guest" },
  body: JSON.stringify({ ruleset: "english", opening: legalMoves(newGame("test", "english"))[0] }),
});
it("rejects guest table creation before touching storage", async () => {
  expect((await POST(request())).status).toBe(401);
  expect(redis.zadd).not.toHaveBeenCalled();
  expect(matchPlayer).not.toHaveBeenCalled();
});
it("creates invitation-only tables under the signed-in host identity", async () => {
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "host", name: "Host" } });
  expect((await POST(request())).status).toBe(200);
  expect(matchPlayer).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: "host", name: "Host" }, expect.objectContaining({ turn: 1 }), "invite");
});
