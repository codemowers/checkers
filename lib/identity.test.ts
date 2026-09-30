import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("./auth", () => ({ authOptions: {} }));
import { getServerSession } from "next-auth";
import { identity } from "./identity";

const instance = "12345678-1234-4234-8234-123456789abc";
const request = () => new Request("https://checkers.example", { headers: {
  "x-player-instance": instance, "x-player-name": "Guest",
} });
beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "optional");
  vi.stubEnv("OIDC_ISSUER", "https://auth.example");
  vi.stubEnv("OIDC_CLIENT_ID", "checkers");
  vi.stubEnv("OIDC_CLIENT_SECRET", "secret");
  vi.stubEnv("ALLOW_SELF_PLAY", "false");
  vi.mocked(getServerSession).mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["optional", "invite"])("accepts anonymous credentials in %s mode", async (mode) => {
  vi.stubEnv("AUTH_MODE", mode);
  expect(await identity(request())).toEqual({ id: `anon:${instance}`, name: "Guest" });
  expect(await identity(new Request("https://checkers.example"))).toBeNull();
});
it("requires a signed-in host when opening an invitation", async () => {
  vi.stubEnv("AUTH_MODE", "invite");
  expect(await identity(request(), { requireAuthenticated: true })).toBeNull();
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "host", name: "Host" } });
  expect(await identity(request(), { requireAuthenticated: true })).toEqual({ id: "host", name: "Host" });
});
it("prefers the signed-in identity over anonymous headers", async () => {
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "user", name: "Member" } });
  expect(await identity(request())).toEqual({ id: "user", name: "Member" });
});
it("rejects anonymous credentials in enforced mode", async () => {
  vi.stubEnv("AUTH_MODE", "enforced");
  expect(await identity(request())).toBeNull();
});
it("ignores sessions in anon mode", async () => {
  vi.stubEnv("AUTH_MODE", "anon");
  expect(await identity(request())).toEqual({ id: `anon:${instance}`, name: "Guest" });
  expect(getServerSession).not.toHaveBeenCalled();
});
it.each([false, true])("includes the authenticated avatar in the seat identity (self-play=%s)", async selfPlay => {
  vi.stubEnv("ALLOW_SELF_PLAY", String(selfPlay));
  const avatar = "https://www.gravatar.com/avatar/test-avatar?d=identicon&s=160";
  vi.mocked(getServerSession).mockResolvedValue({ claims: { sub: "user", name: "Lauri" }, user: { image: avatar } });
  expect(await identity(request())).toEqual({ id: selfPlay ? `user:${instance}` : "user", name: "Lauri", avatar });
});
