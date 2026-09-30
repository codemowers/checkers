import { RENAME_PLAYER } from "./rename-player";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { claimSeat, matchPlayer, CLAIM_SEAT, MATCH } from "./matchmaking";
import { applyMove, legalMoves, newGame } from "./rules";
import { playComputerTurn } from "./computer";
import type { Ruleset } from "./rulesets";
import type { Game } from "./types";

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
    return matchPlayer(redis, {
      users: used[0], waiting: used[1], game: (id) => `${prefix}game:${id}`, presence: used[3],
    }, { id: player, name: player }, table, mode);
  }
  async function game(id: string) { return JSON.parse((await redis.get(`${prefix}game:${id}`))!) as Game; }
  it("keeps invitation tables out of automatic matchmaking and accepts a URL seat claim", async () => {
    const publicTable = await match("public-host");
    const invitation = await match("inviter", "international", "invite");
    expect(invitation[1]).not.toBe(publicTable[1]);
    expect(await redis.zrange(`${prefix}waiting:international`, 0, -1)).toEqual([publicTable[1]]);
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
    expect(await redis.eval(RENAME_PLAYER, 1, key, raw, JSON.stringify(updated))).toBe(1);
    expect((await game(result[1])).players[0].name).toBe("New name");
    const afterTtl = await redis.pttl(key);
    if (joined) {
      expect(afterTtl).toBeGreaterThan(beforeTtl - 5000);
      expect(afterTtl).toBeLessThanOrEqual(beforeTtl);
    } else expect(afterTtl).toBe(-1);
    expect(await redis.eval(RENAME_PLAYER, 1, key, raw, raw)).toBe(0);
    expect((await game(result[1])).revision).toBe(updated.revision);
  });

  it("rejects stale lobby and assignment snapshots before any writes", async () => {
    const host = await match("host");
    const id = randomUUID();
    const newKey = `${prefix}game:${id}`;
    keys.add(newKey);
    const table = newGame(id, "international");
    // Empty queue snapshot is stale: another host has opened a table.
    expect(await redis.eval(MATCH, 5, `${prefix}users`, `${prefix}waiting:international`,
      newKey, `${prefix}presence`, newKey, JSON.stringify({ id: "guest", name: "Guest" }),
      "guest", JSON.stringify(table), id, "open", "", Date.now(), new Date().toISOString(), "[]"))
      .toEqual(["retry", ""]);
    expect(await redis.get(newKey)).toBeNull();
    expect(await redis.hget(`${prefix}users`, "guest")).toBeNull();

    const busy = await match("busy", "english");
    const raw = (await redis.get(`${prefix}game:${host[1]}`))!;
    // Guest became busy after an empty assignment snapshot was read.
    expect(await redis.eval(CLAIM_SEAT, 4, `${prefix}game:${host[1]}`, `${prefix}users`,
      `${prefix}waiting:international`, `${prefix}game:${host[1]}`,
      raw, raw, "busy", host[1], "")).toBe(0);
    expect(await redis.hget(`${prefix}users`, "busy")).toBe(busy[1]);
    expect(await redis.get(`${prefix}game:${host[1]}`)).toBe(raw);
  });

});
