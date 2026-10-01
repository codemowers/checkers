import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./identity", () => ({ identity: vi.fn(async () => ({ id: "guest", name: "Guest" })) }));
vi.mock("./redis", async () => {
  const { EventEmitter } = await import("node:events");
  const subscriber = Object.assign(new EventEmitter(), { subscribe: vi.fn(async () => {}), disconnect: vi.fn() });
  return {
    redis: { duplicate: () => subscriber, zrange: vi.fn(), mget: vi.fn(), zscore: vi.fn(), zadd: vi.fn(), eval: vi.fn() },
    GAME_KEY: (id: string) => `game:${id}`, USERS_KEY: "users", PRESENCE_KEY: "presence", LOBBY_KEY: (rules: string) => `lobby:${rules}`,
  };
});
import { GET } from "../app/api/game/match/route";
import { redis } from "./redis";
import { identity } from "./identity";
import { applyMove, legalMoves, newGame } from "./rules";

let abort: AbortController;
const request = (ruleset = "english") => new Request(`https://checkers.example/api/game/match?ruleset=${ruleset}`, { signal: abort.signal });
const readOffer = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("Stream ended before an offer");
    const chunk = new TextDecoder().decode(value);
    if (chunk.startsWith("data: ")) return JSON.parse(chunk.slice(6));
  }
};
const snapshot = async () => readOffer((await GET(request())).body!.getReader());
const hostGame = () => {
  const fresh = newGame("host-table");
  const game = applyMove(fresh, 0, legalMoves(fresh)[0]);
  game.players[0] = { id: "anon:secret-host-credential", name: "Lauri Võsandi" };
  game.waiting = true;
  game.matchmaking = true;
  return game;
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  abort = new AbortController();
  vi.stubEnv("ENABLE_MATCHMAKING", "true");
  vi.mocked(identity).mockResolvedValue({ id: "guest", name: "Guest" });
  vi.mocked(redis.zrange).mockResolvedValue(["host-table"]);
  vi.mocked(redis.mget).mockResolvedValue([JSON.stringify(hostGame())]);
  vi.mocked(redis.zscore).mockResolvedValue(String(Date.now()));
});
afterEach(() => { abort.abort(); redis.duplicate().removeAllListeners(); vi.useRealTimers(); vi.unstubAllEnvs(); });

it("offers Red's existing opening without requiring a guest opening or creating a seat", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const data = await readOffer(response.body!.getReader());
  expect(data.game).toMatchObject({ board: hostGame().board, turn: 1, you: null, players: [{ name: "Lauri Võsandi" }, {}] });
  expect(JSON.stringify(data)).not.toContain("secret-host-credential");
  expect(redis.eval).not.toHaveBeenCalled();
  expect(redis.zadd).not.toHaveBeenCalled();
});

it("does not search when global matchmaking is disabled", async () => {
  vi.stubEnv("ENABLE_MATCHMAKING", "false");
  expect((await GET(request())).status).toBe(403);
  expect(redis.zrange).not.toHaveBeenCalled();
});

it.each(["private", "own", "taken", "finished", "other-ruleset", "offline"])("does not offer %s games", async reason => {
  const game = hostGame();
  if (reason === "private") game.matchmaking = false;
  if (reason === "own") game.players[0].id = "guest";
  if (reason === "taken") delete game.waiting;
  if (reason === "finished") game.status = "finished";
  if (reason === "other-ruleset") game.ruleset = "international";
  if (reason === "offline") vi.mocked(redis.zscore).mockResolvedValue(String(Date.now() - 46_000));
  vi.mocked(redis.mget).mockResolvedValue([JSON.stringify(game)]);
  expect(await snapshot()).toEqual({ game: null });
});

it("returns an empty lobby and validates requests before searching", async () => {
  vi.mocked(redis.zrange).mockResolvedValue([]);
  expect(await snapshot()).toEqual({ game: null });
  expect(redis.mget).not.toHaveBeenCalled();
  expect((await GET(request("invalid"))).status).toBe(400);
  vi.mocked(identity).mockResolvedValue(null as never);
  expect((await GET(request())).status).toBe(401);
});

it("pushes new and withdrawn offers on lobby events without polling on heartbeats", async () => {
  vi.mocked(redis.zrange).mockResolvedValue([]);
  const reader = (await GET(request())).body!.getReader();
  expect(await readOffer(reader)).toEqual({ game: null });
  vi.mocked(redis.zrange).mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(redis.zrange).not.toHaveBeenCalled();
  vi.mocked(redis.zrange).mockResolvedValue(["host-table"]);
  vi.mocked(redis.zscore).mockResolvedValue(String(Date.now()));
  redis.duplicate().emit("message", "lobby", "changed");
  expect((await readOffer(reader)).game.id).toBe("host-table");
  vi.mocked(redis.mget).mockResolvedValue([null]);
  redis.duplicate().emit("message", "lobby", "changed");
  expect(await readOffer(reader)).toEqual({ game: null });
});

it("withdraws an offer when the host presence lease expires", async () => {
  const reader = (await GET(request())).body!.getReader();
  expect((await readOffer(reader)).game.id).toBe("host-table");
  await vi.advanceTimersByTimeAsync(45_001);
  expect(await readOffer(reader)).toEqual({ game: null });
});

it("closes on subscriber disconnect so a fresh subscription recovers missed events", async () => {
  const reader = (await GET(request())).body!.getReader();
  await readOffer(reader);
  redis.duplicate().emit("close");
  expect((await reader.read()).done).toBe(true);
  expect(redis.duplicate().disconnect).toHaveBeenCalled();
});
