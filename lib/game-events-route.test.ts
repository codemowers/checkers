import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./identity", () => ({ identity: vi.fn(async () => ({ id: "host", name: "Host" })) }));
vi.mock("./game-events", () => ({ gameChannel: (id: string) => `events:${id}`, lobbyChannel: (rules: string) => `lobby-events:${rules}` }));
vi.mock("./matchmaking", () => ({ claimSeat: vi.fn(async () => 1) }));
vi.mock("./redis", async () => {
  const { EventEmitter } = await import("node:events");
  const subscriber = Object.assign(new EventEmitter(), { subscribe: vi.fn(async () => {}), disconnect: vi.fn() });
  return {
    redis: { publish: vi.fn(async () => 1), get: vi.fn(), zadd: vi.fn(async () => 1), zrem: vi.fn(async () => 1), eval: vi.fn(async () => 0), duplicate: () => subscriber },
    SPECTATOR_KEY: (auth: string) => `spectators:${auth}`, GAME_KEY: (id: string) => `game:${id}`, PRESENCE_KEY: "presence", USERS_KEY: "users", LOBBY_KEY: () => "lobby",
  };
});
import { GET } from "../app/api/game/games/[id]/events/route";
import { POST as join } from "../app/api/game/games/[id]/join/route";
import { identity } from "./identity";
import { claimSeat } from "./matchmaking";
import { redis } from "./redis";
import { END_GAME, RECONNECT_GRACE_MS } from "./game-store";
import { applyMove, legalMoves, newGame } from "./rules";
import type { Game } from "./types";

let waiting: Game;
let abort: AbortController;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubEnv("SPECTATOR_MODE", "invite");
  vi.mocked(identity).mockResolvedValue({ id: "host", name: "Host" });
  vi.stubEnv("ENABLE_MATCHMAKING", "false");
  waiting = newGame("invited", "english");
  waiting.players = [{ id: "host", name: "Host" }, { id: "", name: "" }];
  waiting.waiting = true;
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(waiting));
  abort = new AbortController();
});
afterEach(() => { abort.abort(); redis.duplicate().removeAllListeners(); vi.useRealTimers(); vi.unstubAllEnvs(); });
const connect = async () => {
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), { params: Promise.resolve({ id: waiting.id }) });
  const reader = response.body!.getReader();
  await reader.read();
  return reader;
};
it.each(["invite", "disabled"])("joins while preserving the host opening (spectating=%s)", async mode => {
  vi.stubEnv("SPECTATOR_MODE", mode);
  const initial = newGame("invited", "international");
  waiting = applyMove(initial, 0, legalMoves(initial)[0]);
  waiting.players = [{ id: "host", name: "Host" }, { id: "", name: "" }];
  waiting.waiting = true;
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(waiting));
  vi.mocked(identity).mockResolvedValue({ id: "guest", name: "Guest" });
  const params = { params: Promise.resolve({ id: waiting.id }) };
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), params);
  if (mode === "invite") {
    expect(response.status).toBe(200);
    const preview = await response.body!.getReader().read();
    expect(JSON.parse(new TextDecoder().decode(preview.value).slice(6)).game.you).toBeNull();
  } else expect(response.status).toBe(403);
  expect(claimSeat).not.toHaveBeenCalled();
  expect(redis.zadd).not.toHaveBeenCalledWith("presence", expect.anything(), expect.anything());

  const joined = await join(new Request("https://checkers.example/api/game/games/invited/join", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opponent: "human" }),
  }), params);
  expect(joined.status).toBe(200);
  expect(await joined.json()).toMatchObject({
    id: waiting.id, ruleset: "international", board: waiting.board, turn: 1, you: 1,
    players: [{ name: "Host" }, { name: "Guest" }],
  });
  expect(claimSeat).toHaveBeenCalledWith(expect.anything(), expect.anything(), JSON.stringify(waiting),
    expect.objectContaining({ id: waiting.id, board: waiting.board }), "guest");
  const saved = vi.mocked(claimSeat).mock.calls[0][3];
  expect(saved.joinedAt).toBe(Date.now());
  expect(saved.waiting).toBeUndefined();
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(saved));
  const stream = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), params);
  expect(stream.status).toBe(200);
  const first = await stream.body!.getReader().read();
  const event = JSON.parse(new TextDecoder().decode(first.value).slice(6));
  expect(event.game).toMatchObject({ id: waiting.id, board: waiting.board, you: 1, turn: 1 });
});

it.each([null, { id: "guest", name: "Guest" }])("allows invitation spectators without claiming a seat or updating player presence: %j", async (player) => {
  vi.mocked(identity).mockResolvedValue(player);
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), { params: Promise.resolve({ id: waiting.id }) });
  expect(response.status).toBe(200);
  const first = await response.body!.getReader().read();
  const event = JSON.parse(new TextDecoder().decode(first.value).slice(6));
  expect(event.game.you).toBeNull();
  expect(redis.zadd).not.toHaveBeenCalledWith("presence", expect.anything(), expect.anything());
  expect(claimSeat).not.toHaveBeenCalled();
});

it("does not apply a reconnect deadline before the opponent takes a seat", async () => {
  await connect();
  vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60_000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.eval).not.toHaveBeenCalled();
  const joined = structuredClone(waiting);
  delete joined.waiting;
  joined.revision++;
  joined.players[1] = { id: "guest", name: "Focal Fox" };
  redis.duplicate().emit("message", "events:invited", JSON.stringify({ type: "game", game: joined }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.eval).toHaveBeenCalledWith(
    END_GAME, 6, "game:invited", "presence", "users", "lobby", "events:invited", "lobby-events:english",
    joined.revision, JSON.stringify({ type: "ended", message: "The opponent did not reconnect in time." }),
    "guest", Date.now() - RECONNECT_GRACE_MS,
  );
});
it("does not publish invitation tables into automatic matchmaking during heartbeats", async () => {
  await connect();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(vi.mocked(redis.zadd).mock.calls.every(([key]) => key === "presence")).toBe(true);
});
it("keeps public waiting tables available for automatic matchmaking", async () => {
  vi.stubEnv("ENABLE_MATCHMAKING", "true");
  await connect();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.zadd).toHaveBeenCalledWith("lobby", expect.any(Number), waiting.id);
});
it("forwards the atomic end-game notification and closes the stream", async () => {
  const reader = await connect();
  const joined = structuredClone(waiting);
  delete joined.waiting;
  joined.revision++;
  joined.players[1] = { id: "guest", name: "Focal Fox" };
  redis.duplicate().emit("message", "events:invited", JSON.stringify({ type: "game", game: joined }));
  vi.mocked(redis.eval).mockResolvedValueOnce(1);
  await vi.advanceTimersByTimeAsync(15_000);
  const ended = { type: "ended", message: "The opponent did not reconnect in time." };
  expect(redis.eval).toHaveBeenCalledWith(
    END_GAME, 6, "game:invited", "presence", "users", "lobby", "events:invited", "lobby-events:english",
    joined.revision, JSON.stringify(ended), "guest", Date.now() - RECONNECT_GRACE_MS,
  );
  // Redis publishes the notification as part of the successful deletion.
  redis.duplicate().emit("message", "events:invited", JSON.stringify(ended));
  await reader.read(); // Joined game update.
  const event = await reader.read();
  expect(new TextDecoder().decode(event.value)).toBe(`data: ${JSON.stringify(ended)}\n\n`);
  expect((await reader.read()).done).toBe(true);
  expect(redis.duplicate().disconnect).toHaveBeenCalled();
});

it("rejects spectator streams when spectating is disabled", async () => {
  vi.stubEnv("SPECTATOR_MODE", "disabled");
  vi.mocked(identity).mockResolvedValue({ id: "guest", name: "Guest" });
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events"), { params: Promise.resolve({ id: waiting.id }) });
  expect(response.status).toBe(403);
  expect(redis.duplicate().subscribe).not.toHaveBeenCalled();
});



it("leases spectator presence, refreshes it and removes it on disconnect", async () => {
  vi.mocked(identity).mockResolvedValue({ id: "anon:viewer", name: "Viewer" });
  await connect();
  const member = vi.mocked(redis.zadd).mock.calls.find(([key]) => key === "spectators:anonymous")![2];
  expect(JSON.parse(String(member)).slice(0, 2)).toEqual(["invited", "anon:viewer"]);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.zadd).toHaveBeenCalledWith("spectators:anonymous", Date.now(), member);
  abort.abort();
  expect(redis.zrem).toHaveBeenCalledWith("spectators:anonymous", member);
});

it("removes an authenticated spectator lease when the viewer takes a player seat", async () => {
  vi.mocked(identity).mockResolvedValue({ id: "guest", name: "Guest" });
  await connect();
  const member = vi.mocked(redis.zadd).mock.calls.find(([key]) => key === "spectators:authenticated")![2];
  waiting.players[1] = { id: "guest", name: "Guest" };
  delete waiting.waiting;
  waiting.revision++;
  redis.duplicate().emit("message", "events:invited", JSON.stringify({ type: "game", game: waiting }));
  expect(redis.zrem).toHaveBeenCalledWith("spectators:authenticated", member);
  vi.mocked(redis.zadd).mockClear();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.zadd).not.toHaveBeenCalledWith("spectators:authenticated", expect.anything(), expect.anything());
  expect(redis.zadd).toHaveBeenCalledWith("presence", Date.now(), "guest");
});

it("removes a spectator lease even when the socket closes during registration", async () => {
  vi.mocked(identity).mockResolvedValue({ id: "anon:viewer", name: "Viewer" });
  vi.mocked(redis.zadd).mockImplementationOnce(async () => { abort.abort(); return "1"; });
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), { params: Promise.resolve({ id: waiting.id }) });
  expect((await response.body!.getReader().read()).done).toBe(true);
  await Promise.resolve();
  expect(redis.zrem).toHaveBeenCalledWith("spectators:anonymous", expect.any(String));
});

it("ignores older waiting snapshots after a player has joined", async () => {
  await connect();
  const joined = structuredClone(waiting);
  delete joined.waiting;
  joined.players[1] = { id: "guest", name: "Guest" };
  joined.revision++;
  const subscriber = redis.duplicate();
  subscriber.emit("message", "events:invited", JSON.stringify({ type: "game", game: joined }));
  subscriber.emit("message", "events:invited", JSON.stringify({ type: "game", game: waiting }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.eval).toHaveBeenCalledWith(END_GAME, 6, "game:invited", "presence", "users", "lobby", "events:invited", "lobby-events:english",
    joined.revision, expect.any(String), "guest", expect.any(Number));
});

it("closes on subscriber disconnect so reconnection reads missed updates", async () => {
  const reader = await connect();
  const joined = structuredClone(waiting);
  delete joined.waiting;
  joined.players[1] = { id: "guest", name: "Guest" };
  joined.revision++;
  redis.duplicate().emit("close");
  expect((await reader.read()).done).toBe(true);
  vi.mocked(redis.eval).mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(redis.eval).not.toHaveBeenCalled();
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(joined));
  const response = await GET(new Request("https://checkers.example/api/game/games/invited/events", { signal: abort.signal }), { params: Promise.resolve({ id: waiting.id }) });
  const first = await response.body!.getReader().read();
  const event = JSON.parse(new TextDecoder().decode(first.value).slice(6));
  expect(event.game.revision).toBe(joined.revision);
  expect(event.game.waiting).toBeUndefined();
});

it("does not let the initial read replace a newer published snapshot", async () => {
  const joined = structuredClone(waiting);
  delete joined.waiting;
  joined.players[1] = { id: "guest", name: "Guest" };
  joined.revision++;
  vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(waiting)).mockImplementationOnce(async () => {
    redis.duplicate().emit("message", "events:invited", JSON.stringify({ type: "game", game: joined }));
    return JSON.stringify(waiting);
  });
  const reader = await connect();
  const snapshot = await reader.read();
  expect(JSON.parse(new TextDecoder().decode(snapshot.value).slice(6)).game.revision).toBe(joined.revision);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(redis.eval).toHaveBeenCalled();
});

it("does not queue a private table even when global matchmaking is enabled", async () => {
  vi.stubEnv("ENABLE_MATCHMAKING", "true");
  waiting.matchmaking = false;
  vi.mocked(redis.get).mockResolvedValue(JSON.stringify(waiting));
  await connect();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.mocked(redis.zadd).mock.calls.every(([key]) => key === "presence")).toBe(true);
});
