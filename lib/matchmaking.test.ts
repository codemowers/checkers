import { saveGame } from "./game-persistence";
import { gameChannel, lobbyChannel } from "./game-events";
import { lobbyEvents } from "./lobby-events";
import { END_GAME, RECONNECT_GRACE_MS } from "./game-store";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { claimSeat, matchPlayer, CLAIM_SEAT, MATCH } from "./matchmaking";
import { applyMove, legalMoves, newGame } from "./rules";
import { playComputerTurn } from "./computer";
import type { Ruleset } from "./rulesets";
import type { Game, PublicGame } from "./types";

const url = process.env.TEST_REDIS_URL;
describe.skipIf(!url)("human-first lobby (Redis)", () => {
  const redis = new Redis(url ?? "redis://127.0.0.1:16379", { lazyConnect: true, maxRetriesPerRequest: 1 });
  const prefix = `checkers-test:${randomUUID()}:`;
  const keys = new Set<string>();
  afterEach(async () => { if (keys.size) await redis.del(...keys); keys.clear(); });
  afterAll(() => redis.disconnect());
  async function match(player: string, ruleset: Ruleset = "international", mode: "open" | "invite" = "open") {
    const id = randomUUID();
    const used = [`${prefix}users`, `${prefix}waiting:${ruleset}`, `${prefix}game:${id}`, `${prefix}presence`];
    used.forEach((key) => keys.add(key));
    const fresh = newGame(id, ruleset);
    const table = applyMove(fresh, 0, legalMoves(fresh)[0]);
    await redis.zadd(`${prefix}presence`, Date.now(), player);
    const result = await matchPlayer(redis, {
      users: used[0], waiting: used[1], game: (id) => `${prefix}game:${id}`, presence: used[3],
    }, { id: player, name: player }, table, mode);
    if (result[0] === "offer") {
      const offered = JSON.parse(result[1]) as Game;
      expect(await claim(offered.id, player)).toBe(1);
      return ["game", offered.id];
    }
    return result;
  }
  async function game(id: string) { return JSON.parse((await redis.get(`${prefix}game:${id}`))!) as Game; }
  it("offers a published Red opening over SSE to a guest who has made no move", async () => {
    const aborter = new AbortController();
    const response = lobbyEvents(new Request("http://localhost/api/game/match?ruleset=english", { signal: aborter.signal }), redis, {
      waiting: `${prefix}waiting:english`, presence: `${prefix}presence`, game: id => `${prefix}game:${id}`,
    }, "idle-guest", "english");
    const reader = response.body!.getReader();
    const readOffer = async () => {
      const { value, done } = await reader.read();
      expect(done).toBe(false);
      return JSON.parse(new TextDecoder().decode(value).slice(6).trim()) as { game: PublicGame | null };
    };
    try {
      expect((await readOffer()).game).toBeNull();
      await match("private-host", "english", "invite");
      const host = await match("public-host", "english");
      const offered = (await readOffer()).game!;
      expect(offered.id).toBe(host[1]);
      expect(offered.turn).toBe(1);
      expect(offered.you).toBeNull();
      expect(offered.players.every(player => !("id" in player))).toBe(true);
      expect(await redis.hget(`${prefix}users`, "idle-guest")).toBeNull();
      expect((await game(host[1])).players[1].id).toBe("");
      expect(await claim(host[1], "idle-guest")).toBe(1);
      expect((await readOffer()).game).toBeNull();
    } finally { aborter.abort(); await reader.cancel(); }
  });
  it("keeps invitation tables out of automatic matchmaking and accepts a URL seat claim", async () => {
    const publicTable = await match("public-host");
    const invitation = await match("inviter", "international", "invite");
    expect(invitation[1]).not.toBe(publicTable[1]);
    expect(await redis.zrange(`${prefix}waiting:international`, "0", "-1")).toEqual([publicTable[1]]);
    expect(await match("public-guest")).toEqual(publicTable);
    const uninvited = await match("uninvited");
    expect(uninvited[1]).not.toBe(invitation[1]);
    expect((await game(uninvited[1])).waiting).toBe(true);
    expect(await claim(invitation[1], "anon:url-guest")).toBe(1);
    expect((await game(invitation[1])).players[1].id).toBe("anon:url-guest");
  });
  async function claim(id: string, player: string, computer = false) {
    const raw = (await redis.get(`${prefix}game:${id}`))!;
    let table = JSON.parse(raw) as Game;
    if (!table.waiting) return 0;
    table.players[1] = { id: computer ? `computer:${id}` : player, name: computer ? "Computer" : player };
    table.computer = computer;
    delete table.waiting;
    table.joinedAt = Date.now();
    table.revision++;
    table = playComputerTurn(table);
    return claimSeat(redis, {
      game: (id) => `${prefix}game:${id}`, users: `${prefix}users`, waiting: `${prefix}waiting:${table.ruleset}`,
    }, raw, table, player);
  }

  it.each(["open", "invite"] as const)("keeps a %s link joinable without a name/login deadline", async (mode) => {
    const result = await match("host", "english", mode);
    const key = `${prefix}game:${result[1]}`;
    expect(await redis.ttl(key)).toBe(-1);
    const opening = await game(result[1]);
    opening.updatedAt = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    await redis.set(key, JSON.stringify(opening));
    await redis.zrem(`${prefix}presence`, "host");

    expect(await claim(result[1], "late-guest")).toBe(1);
    const joined = await game(result[1]);
    expect(joined.id).toBe(opening.id);
    expect(joined.board).toEqual(opening.board);
    expect(joined.players.map(player => player.id)).toEqual(["host", "late-guest"]);
    expect(joined.waiting).toBeUndefined();
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it("persists the committed red opening and reuses its assignment", async () => {
    expect(await redis.hget(`${prefix}users`, "red")).toBeNull();
    const result = await match("red");
    const table = await game(result[1]);
    expect(table.waiting).toBe(true);
    expect(table.players[0].id).toBe("red");
    expect(table.players[1].id).toBe("");
    expect(table.turn).toBe(1);
    expect(table.revision).toBe(2);
    expect(await match("red")).toEqual(result); // Reload/retry preserves opening and link.
  });

  it("matches only the same ruleset, keeping the host's opening", async () => {
    const intl = await match("red-int");
    const initial = await game(intl[1]);
    const english = await match("red-eng", "english");
    expect(english[1]).not.toBe(intl[1]);
    expect(await match("black-int")).toEqual(intl);
    const joined = await game(intl[1]);
    expect(joined.players.map((p) => p.id)).toEqual(["red-int", "black-int"]);
    expect(joined.board).toEqual(initial.board);
    expect(joined.waiting).toBeUndefined();
    expect(joined.turn).toBe(1);
    expect((await game(english[1])).waiting).toBe(true);
  });

  it("allows a friend to claim the exact shared table once", async () => {
    const result = await match("host");
    const results = await Promise.all([claim(result[1], "friend-a"), claim(result[1], "friend-b")]);
    expect(results.sort()).toEqual([0, 1]);
    expect((await game(result[1])).players[1].id).toMatch(/^friend-/);
    expect(await redis.zcard(`${prefix}waiting:international`)).toBe(0);
  });

  it("a human join and computer fallback cannot overwrite one another", async () => {
    const result = await match("host");
    const results = await Promise.all([claim(result[1], "host", true), claim(result[1], "friend")]);
    expect(results.sort()).toEqual([0, 1]);
    const table = await game(result[1]);
    expect(table.waiting).toBeUndefined();
    if (table.computer) {
      expect(table.turn).toBe(0);
      expect(table.revision).toBeGreaterThan(3);
      expect(await redis.hget(`${prefix}users`, "friend")).toBeNull();
    } else expect(await redis.hget(`${prefix}users`, "friend")).toBe(result[1]);
  });

  it("computer fallback replies to the saved opening in the same game", async () => {
    const result = await match("solo", "english");
    const before = await game(result[1]);
    expect(await claim(result[1], "solo", true)).toBe(1);
    const after = await game(result[1]);
    expect(after.id).toBe(before.id);
    expect(after.computer).toBe(true);
    expect(after.turn).toBe(0);
    expect(after.board.flat().filter((p) => p === 1)).toHaveLength(12);
    expect(after.players[0]).toEqual(before.players[0]);
  });

  it("starts a fresh opening after an existing computer game", async () => {
    const previous = await match("solo", "english");
    expect(await claim(previous[1], "solo", true)).toBe(1);

    const next = await match("solo", "english");
    expect(next[1]).not.toBe(previous[1]);
    expect(await redis.hget(`${prefix}users`, "solo")).toBe(next[1]);
    expect((await game(next[1])).waiting).toBe(true);
  });

  it("does not assign someone already playing to a shared seat", async () => {
    const existing = await match("busy", "english");
    const invited = await match("host");
    expect(await claim(invited[1], "busy")).toBe(-1);
    expect(await redis.hget(`${prefix}users`, "busy")).toBe(existing[1]);
    expect((await game(invited[1])).waiting).toBe(true);
  });

  it("skips disconnected hosts in automatic matching while preserving their shared link", async () => {
    const old = await match("offline");
    await redis.zadd(`${prefix}presence`, Date.now() - 60_000, "offline");
    const next = await match("newcomer");
    expect(next[1]).not.toBe(old[1]);
    expect((await game(old[1])).waiting).toBe(true);
    expect(await redis.zscore(`${prefix}waiting:international`, old[1])).toBeNull();
  });

  it("concurrent openings pair players without leaving duplicate tables", async () => {
    const results = await Promise.all([match("first"), match("second")]);
    expect(results[0]).toEqual(results[1]);
    const table = await game(results[0][1]);
    expect(table.players.map((p) => p.id).sort()).toEqual(["first", "second"]);
    expect(table.waiting).toBeUndefined();
  });

  it("concurrent requests from one player retain a single assignment", async () => {
    const results = await Promise.all([match("same"), match("same"), match("same")]);
    expect(results.every((result) => result[1] === results[0][1])).toBe(true);
    expect(await redis.zcard(`${prefix}waiting:international`)).toBe(1);
  });

  it.each(["expired", "finished"])("replaces an %s game assignment", async (state) => {
    const previous = await match("returning");
    if (state === "expired") await redis.del(`${prefix}game:${previous[1]}`);
    else {
      const table = await game(previous[1]);
      table.status = "finished";
      await redis.set(`${prefix}game:${previous[1]}`, JSON.stringify(table));
    }
    const next = await match("returning");
    expect(next[1]).not.toBe(previous[1]);
    expect(await redis.hget(`${prefix}users`, "returning")).toBe(next[1]);
  });

  it.each([false, true])("renames atomically while preserving game expiry (joined=%s)", async joined => {
    const result = await match("host");
    if (joined) await claim(result[1], "guest");
    const key = `${prefix}game:${result[1]}`;
    const raw = (await redis.get(key))!;
    const beforeTtl = await redis.pttl(key);
    const updated = JSON.parse(raw) as Game;
    updated.players[0].name = "New name";
    updated.revision++;
    expect(await saveGame(redis, key, raw, updated, "preserve")).toBe(1);
    expect((await game(result[1])).players[0].name).toBe("New name");
    const afterTtl = await redis.pttl(key);
    if (joined) {
      expect(afterTtl).toBeGreaterThan(beforeTtl - 5000);
      expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
    } else expect(afterTtl).toBe(-1);
    expect(await saveGame(redis, key, raw, updated, "preserve")).toBe(0);
    expect((await game(result[1])).revision).toBe(updated.revision);
  });

  it("rejects stale lobby and assignment snapshots before any writes", async () => {
    const host = await match("host");
    const id = randomUUID();
    const newKey = `${prefix}game:${id}`;
    keys.add(newKey);
    const table = newGame(id, "international");
    // Empty queue snapshot is stale: another host has opened a table.
    expect(await redis.eval(MATCH, 7, `${prefix}users`, `${prefix}waiting:international`,
      newKey, `${prefix}presence`, newKey, gameChannel(id), lobbyChannel("international"), JSON.stringify({ id: "guest", name: "Guest" }),
      "guest", JSON.stringify(table), id, "open", "", Date.now(), new Date().toISOString(), "[]"))
      .toEqual(["retry", ""]);
    expect(await redis.get(newKey)).toBeNull();
    expect(await redis.hget(`${prefix}users`, "guest")).toBeNull();

    const busy = await match("busy", "english");
    const raw = (await redis.get(`${prefix}game:${host[1]}`))!;
    // Guest became busy after an empty assignment snapshot was read.
    expect(await redis.eval(CLAIM_SEAT, 6, `${prefix}game:${host[1]}`, `${prefix}users`,
      `${prefix}waiting:international`, `${prefix}game:${host[1]}`, gameChannel(host[1]), lobbyChannel("international"),
      raw, raw, "busy", host[1], "", JSON.stringify({ type: "game", game: JSON.parse(raw) }))).toBe(0);
    expect(await redis.hget(`${prefix}users`, "busy")).toBe(busy[1]);
    expect(await redis.get(`${prefix}game:${host[1]}`)).toBe(raw);
  });

  it("gives an offline invitation host a fresh grace period without extending it on moves", async () => {
    const result = await match("offline-host", "english", "invite");
    await redis.zadd(`${prefix}presence`, Date.now() - 7 * 86400_000, "offline-host");
    await claim(result[1], "guest");
    let joined = await game(result[1]);
    const started = joined.joinedAt!;
    expect(started).toBeGreaterThan(Date.now() - 5000);
    const expire = (cutoff: number) => redis.eval(END_GAME, 6, `${prefix}game:${joined.id}`, `${prefix}presence`,
      `${prefix}users`, `${prefix}waiting:english`, gameChannel(joined.id), lobbyChannel(joined.ruleset), joined.revision,
      JSON.stringify({ type: "ended", message: "Expired" }), "offline-host", cutoff);
    expect(await expire(started + 15_000 - RECONNECT_GRACE_MS)).toBe(0);
    const raw = JSON.stringify(joined);
    joined = applyMove(joined, joined.turn, legalMoves(joined)[0]);
    expect(joined.joinedAt).toBe(started);
    expect(await saveGame(redis, `${prefix}game:${joined.id}`, raw, joined, "refresh")).toBe(1);
    expect(await expire(started + 1)).toBe(1);
    expect(await redis.get(`${prefix}game:${joined.id}`)).toBeNull();
  });

  it.each(["invite", "match"])("publishes committed %s joins and moves, but never rejected stale saves", async mode => {
    const result = await match("host", "english");
    const subscriber = redis.duplicate();
    const events: Game[] = [];
    subscriber.on("message", (_channel, raw) => events.push(JSON.parse(raw).game));
    try {
      await subscriber.subscribe(gameChannel(result[1]));
      if (mode === "invite") expect(await claim(result[1], "guest")).toBe(1);
      else expect(await match("guest", "english")).toEqual(result);
      const joined = await game(result[1]);
      const raw = (await redis.get(`${prefix}game:${joined.id}`))!;
      const moved = applyMove(joined, joined.turn, legalMoves(joined)[0]);
      expect(await saveGame(redis, `${prefix}game:${joined.id}`, raw, moved, "refresh")).toBe(1);
      expect(await saveGame(redis, `${prefix}game:${joined.id}`, raw, moved, "refresh")).toBe(0);
      // A command on the subscriber is a barrier for its earlier pub/sub messages.
      await subscriber.ping();
      expect(events.map(game => game.revision)).toEqual([joined.revision, moved.revision]);
      expect(events[1].board).toEqual(moved.board);
    } finally { subscriber.disconnect(); }
  });

  it("offers a waiting host without claiming it and allows inviting someone else", async () => {
    const host = await match("host", "english");
    const raw = (await redis.get(`${prefix}game:${host[1]}`))!;
    const id = randomUUID();
    const fresh = newGame(id, "english");
    keys.add(`${prefix}game:${id}`);
    const result = await matchPlayer(redis, {
      users: `${prefix}users`, waiting: `${prefix}waiting:english`, presence: `${prefix}presence`,
      game: (id) => `${prefix}game:${id}`,
    }, { id: "new-guest", name: "Guest" }, applyMove(fresh, 0, legalMoves(fresh)[0]), "open", false);
    expect(result[0]).toBe("offer");
    expect(JSON.parse(result[1]).id).toBe(host[1]);
    expect(await redis.get(`${prefix}game:${host[1]}`)).toBe(raw);
    expect(await redis.hget(`${prefix}users`, "new-guest")).toBeNull();
    expect(await redis.get(`${prefix}game:${id}`)).toBeNull();
    const own = await match("new-guest", "english", "invite");
    expect(own[1]).not.toBe(host[1]);
    expect((await game(own[1])).matchmaking).toBe(false);
    expect(await redis.zrange(`${prefix}waiting:english`, "0", "-1")).toEqual([host[1]]);
  });

  it("lets only one of two offered players accept the seat", async () => {
    const host = await match("host", "english");
    const offer = async (player: string) => {
      const id = randomUUID();
      keys.add(`${prefix}game:${id}`);
      const fresh = newGame(id, "english");
      return matchPlayer(redis, {
        users: `${prefix}users`, waiting: `${prefix}waiting:english`, presence: `${prefix}presence`,
        game: (id) => `${prefix}game:${id}`,
      }, { id: player, name: player }, applyMove(fresh, 0, legalMoves(fresh)[0]), "open", false);
    };
    const offers = await Promise.all([offer("guest-a"), offer("guest-b")]);
    expect(offers.every(([status, raw]) => status === "offer" && JSON.parse(raw).id === host[1])).toBe(true);
    expect((await game(host[1])).players[1].id).toBe("");
    const claims = await Promise.all([claim(host[1], "guest-a"), claim(host[1], "guest-b")]);
    expect(claims.sort()).toEqual([0, 1]);
    expect(await redis.zcard(`${prefix}waiting:english`)).toBe(0);
  });

});
