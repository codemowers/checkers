import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { proxy } from "../proxy";

describe("unsupported Server Actions", () => {
  it("rejects an unknown action before it reaches the page renderer", async () => {
    const response = await proxy(new NextRequest("https://checkers.example/", {
      method: "POST", headers: { "next-action": "y" }, body: "[]",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Server Actions are not supported." });
  });
  it.each(["GET", "POST"])("passes ordinary %s requests through", async (method) => {
    const response = await proxy(new NextRequest("https://checkers.example/signin", { method }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("session reset", () => {
  afterEach(() => vi.unstubAllEnvs());

  function configure() {
    vi.stubEnv("AUTH_MODE", "optional");
    vi.stubEnv("OIDC_ISSUER", "https://id.example");
    vi.stubEnv("OIDC_CLIENT_ID", "checkers");
    vi.stubEnv("OIDC_CLIENT_SECRET", "client-secret");
    vi.stubEnv("NEXTAUTH_URL", "https://checkers.example");
    vi.stubEnv("NEXTAUTH_SECRET", "current-session-secret");
  }

  it("clears every old-secret cookie chunk and preserves the game return URL", async () => {
    configure();
    const old = await encode({ token: { sub: "player" }, secret: "previous-session-secret" });
    const response = await proxy(new NextRequest("https://checkers.example/games/table?view=board", {
      headers: { cookie: `__Secure-next-auth.session-token.0=${old.slice(0, 50)}; __Secure-next-auth.session-token.1=${old.slice(50)}; unrelated=keep` },
    }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://checkers.example/signin?callbackUrl=%2Fgames%2Ftable%3Fview%3Dboard");
    expect(response.cookies.getAll().map(({ name, maxAge }) => [name, maxAge])).toEqual([
      ["__Secure-next-auth.session-token.0", 0], ["__Secure-next-auth.session-token.1", 0],
    ]);
  });

  it("allows a valid current-secret session", async () => {
    configure();
    const token = await encode({ token: { sub: "player" }, secret: process.env.NEXTAUTH_SECRET! });
    const response = await proxy(new NextRequest("https://checkers.example/", {
      headers: { cookie: `__Secure-next-auth.session-token=${token}` },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.getAll()).toEqual([]);
  });

  it("rejects a mutation with a stale cookie even if an anonymous credential is supplied", async () => {
    configure();
    const response = await proxy(new NextRequest("https://checkers.example/api/game/games/table/moves", {
      method: "POST", headers: { cookie: "__Secure-next-auth.session-token=invalid", "X-Player-Instance": "c0f35358-0ab3-4fca-8849-1fc222f68731" },
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Checkers-Session-Reset")).toBe("1");
    expect(response.cookies.get("__Secure-next-auth.session-token")?.maxAge).toBe(0);
  });

  it("clears stale cookies on signin without nesting its callback URL", async () => {
    configure();
    const response = await proxy(new NextRequest("https://checkers.example/signin?callbackUrl=%2Fgames%2Ftable", {
      headers: { cookie: "__Secure-next-auth.session-token=invalid" },
    }));
    expect(response.headers.get("location")).toBe("https://checkers.example/signin?callbackUrl=%2Fgames%2Ftable");
  });

  it("leaves anonymous-only mode alone", async () => {
    vi.stubEnv("AUTH_MODE", "anon");
    const response = await proxy(new NextRequest("https://checkers.example/", {
      headers: { cookie: "__Secure-next-auth.session-token=invalid" },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
