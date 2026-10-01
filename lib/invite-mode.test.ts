import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("./auth", () => ({ authOptions: {} }));
vi.mock("./redis", () => ({
  redis: { zadd: vi.fn(), zremrangebyscore: vi.fn() },
  GAME_KEY: (id: string) => `game:${id}`, USERS_KEY: "users", PRESENCE_KEY: "presence", LOBBY_KEY: (rules: string) => `lobby:${rules}`,
}));
vi.mock("./matchmaking", () => ({ matchPlayer: vi.fn(async () => ["waiting", "table"]) }));
import { getServerSession } from "next-auth";
import { POST } from "../app/api/game/match/route";
import { matchPlayer } from "./matchmaking";
import { redis } from "./redis";
import { legalMoves, newGame } from "./rules";
import type { Ruleset } from "./rulesets";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RULES", undefined);
  vi.stubEnv("AUTH_MODE", "invite");
  vi.stubEnv("OIDC_ISSUER", "https://auth.example");
  vi.stubEnv("OIDC_CLIENT_ID", "checkers");
  vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
  vi.stubEnv("ALLOW_SELF_PLAY", "false");
  vi.stubEnv("ENABLE_MATCHMAKING", "false");
  vi.mocked(getServerSession).mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
const request = (invite?: boolean, ruleset: Ruleset = "english") => new Request("https://checkers.example/api/game/match", {
  method: "POST", headers: { "content-type": "application/json", "x-player-instance": "12345678-1234-4234-8234-123456789abc", "x-player-name": "Guest" },
  body: JSON.stringify({ invite, ruleset, opening: legalMoves(newGame("test", ruleset))[0] }),
});
it.each(["english", "international", "english-default", "international-default"])("enforces %s when creating tables", async mode => {
  vi.stubEnv("RULES", mode);
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "host", name: "Host" } });
  for (const ruleset of ["english", "international"] as const) {
    vi.mocked(redis.zadd).mockClear();
    vi.mocked(matchPlayer).mockClear();
    const allowed = mode.endsWith("-default") || mode === ruleset;
    expect((await POST(request(false, ruleset))).status).toBe(allowed ? 200 : 403);
    if (allowed) expect(matchPlayer).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ ruleset }), "invite", false);
    else {
      expect(redis.zadd).not.toHaveBeenCalled();
      expect(matchPlayer).not.toHaveBeenCalled();
    }
  }
});
it("rejects guest table creation before touching storage", async () => {
  expect((await POST(request())).status).toBe(401);
  expect(redis.zadd).not.toHaveBeenCalled();
  expect(matchPlayer).not.toHaveBeenCalled();
});
it("creates invitation-only tables under the signed-in host identity", async () => {
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "host", name: "Host" } });
  expect((await POST(request())).status).toBe(200);
  expect(matchPlayer).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: "host", name: "Host" }, expect.objectContaining({ turn: 1 }), "invite", false);
});

it.each(["anon", "optional", "invite", "enforced"])("uses the global matchmaking flag in %s auth mode", async mode => {
  vi.stubEnv("AUTH_MODE", mode);
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "host", name: "Host" } });
  vi.stubEnv("ENABLE_MATCHMAKING", "true");
  expect((await POST(request())).status).toBe(200);
  expect(vi.mocked(matchPlayer).mock.lastCall?.[4]).toBe("open");
  expect((await POST(request(true))).status).toBe(200);
  expect(vi.mocked(matchPlayer).mock.lastCall?.[4]).toBe("invite");
  vi.stubEnv("ENABLE_MATCHMAKING", "false");
  expect((await POST(request())).status).toBe(200);
  expect(vi.mocked(matchPlayer).mock.lastCall?.[4]).toBe("invite");
});
it("returns an unclaimed public offer without leaking player credentials", async () => {
  vi.stubEnv("ENABLE_MATCHMAKING", "true");
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "guest", name: "Guest" } });
  const table = newGame("offered");
  table.waiting = true;
  table.players[0] = { id: "anon:secret-credential", name: "Lauri Võsandi" };
  vi.mocked(matchPlayer).mockResolvedValueOnce(["offer", JSON.stringify(table)]);
  const response = await POST(request());
  const data = await response.json();
  expect(data).toMatchObject({ status: "offer", game: { id: "offered", waiting: true, you: null, players: [{ name: "Lauri Võsandi" }, {}] } });
  expect(JSON.stringify(data)).not.toContain("secret-credential");
});
