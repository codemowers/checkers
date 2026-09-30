import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authMode } from "./auth-mode";
import { computerEnabled, demoEnabled, spectatorMode } from "./features";

beforeEach(() => {
  for (const name of ["AUTH_MODE", "OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "ENABLE_COMPUTER", "ENABLE_DEMO", "SPECTATOR_MODE"]) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());
const configureOidc = () => {
  vi.stubEnv("OIDC_ISSUER", "https://auth.example");
  vi.stubEnv("OIDC_CLIENT_ID", "checkers");
  vi.stubEnv("OIDC_CLIENT_SECRET", "test-secret");
};

describe("runtime configuration", () => {
  it("preserves automatic authentication defaults", () => {
    expect(authMode()).toBe("anon");
    configureOidc();
    expect(authMode()).toBe("enforced");
  });
  it.each(["enforced", "optional", "invite"])("requires OIDC for %s", (mode) => {
    vi.stubEnv("AUTH_MODE", mode);
    expect(() => authMode()).toThrow();
    configureOidc();
    expect(authMode()).toBe(mode);
  });
  it("rejects partial OIDC unless explicitly anonymous", () => {
    vi.stubEnv("OIDC_CLIENT_ID", "checkers");
    expect(() => authMode()).toThrow("incomplete");
    vi.stubEnv("AUTH_MODE", "anon");
    expect(authMode()).toBe("anon");
  });
  it("rejects unknown auth modes", () => {
    vi.stubEnv("AUTH_MODE", "disabled");
    expect(() => authMode()).toThrow("AUTH_MODE");
  });
  it("defaults to invitation spectating and validates spectator modes", () => {
    expect(spectatorMode()).toBe("invite");
    vi.stubEnv("SPECTATOR_MODE", "disabled");
    expect(spectatorMode()).toBe("disabled");
    vi.stubEnv("SPECTATOR_MODE", "public");
    expect(() => spectatorMode()).toThrow("SPECTATOR_MODE");
  });
  it("enables features by default and switches them independently", () => {
    expect(computerEnabled()).toBe(true);
    expect(demoEnabled()).toBe(true);
    vi.stubEnv("ENABLE_COMPUTER", "false");
    expect(computerEnabled()).toBe(false);
    expect(demoEnabled()).toBe(true);
    vi.stubEnv("ENABLE_DEMO", "false");
    expect(demoEnabled()).toBe(false);
    vi.stubEnv("ENABLE_DEMO", "yes");
    expect(() => demoEnabled()).toThrow("ENABLE_DEMO");
  });
});
