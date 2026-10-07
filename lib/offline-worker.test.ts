import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { offlineWorkerSource } from "./offline-worker";

function harness() {
  const handlers = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>();
  const cache = {
    addAll: vi.fn(async (requests: { url: string }[]) => { for (const request of requests) entries.set(request.url, new Response(request.url)); }),
    put: vi.fn(async (url: string, response: Response) => { entries.set(url, response); }),
    match: vi.fn(async (url: string) => entries.get(url)?.clone()),
  };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["checkers-local-old", "another-app"]), delete: vi.fn(async () => true) };
  const fetch = vi.fn().mockResolvedValue(new Response("online"));
  const self = { addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler), skipWaiting: vi.fn(), clients: { claim: vi.fn() }, registration: { unregister: vi.fn() }, location: { origin: "https://checkers.test" } };
  vm.runInNewContext(offlineWorkerSource("checkers-local-new", ["/local", "/_next/static/local.js", "/textures/wood-table-001.jpg"]), {
    self, caches, fetch, URL, AbortController, setTimeout, clearTimeout,
    Request: class { constructor(public url: string, public options: any) {} },
  });
  const lifecycle = async (name: string) => {
    let promise;
    handlers.get(name)!({ waitUntil: (value: Promise<unknown>) => { promise = value; } });
    await promise;
  };
  const request = (path: string, mode = "navigate", method = "GET") => {
    let response: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: new URL(path, "https://checkers.test").href, mode, method }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  };
  return { entries, cache, caches, fetch, self, lifecycle, request };
}

describe("offline local cache", () => {
  it("installs all required assets without cookies and removes only its old caches", async () => {
    const h = harness();
    await h.lifecycle("install");
    const requests = h.cache.addAll.mock.calls[0][0] as unknown as { options: { credentials: string } }[];
    expect(requests.every(request => request.options.credentials === "omit")).toBe(true);
    expect(h.entries.has("/local")).toBe(true);
    expect(h.entries.has("/_next/static/local.js")).toBe(true);
    await h.lifecycle("activate");
    expect(h.caches.delete).toHaveBeenCalledWith("checkers-local-old");
    expect(h.caches.delete).not.toHaveBeenCalledWith("another-app");
  });
  it("never marks a partially downloaded shell ready", async () => {
    const h = harness();
    h.cache.addAll.mockRejectedValueOnce(new Error("asset missing"));
    await expect(h.lifecycle("install")).rejects.toThrow("asset missing");
    expect(h.self.skipWaiting).not.toHaveBeenCalled();
    expect(h.caches.delete).toHaveBeenCalledWith("checkers-local-new");
  });
  it("serves the public local shell for offline home reloads without caching account HTML", async () => {
    const h = harness();
    await h.lifecycle("install");
    h.fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(await (await h.request("/"))!.text()).toBe("/local");
    h.fetch.mockResolvedValueOnce(new Response("account name and private game"));
    expect(await (await h.request("/"))!.text()).toBe("account name and private game");
    expect(h.cache.put).not.toHaveBeenCalled();
    expect(await h.entries.get("/local")!.text()).toBe("/local");
  });
  it("keeps APIs, online games, auth and RSC on network and serves cached build assets", async () => {
    const h = harness();
    await h.lifecycle("install");
    for (const path of ["/api/connection", "/api/game/match", "/api/auth/session", "/signin", "/games/table"]) expect(h.request(path)).toBeUndefined();
    expect(h.request("/local?_rsc=abc", "cors")).toBeUndefined();
    expect(h.request("/api/game/match", "cors", "POST")).toBeUndefined();
    expect(h.request("https://external.test/image", "cors")).toBeUndefined();
    expect(await (await h.request("/_next/static/local.js", "cors"))!.text()).toBe("/_next/static/local.js");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("keeps the installed shell paired with its assets across deployments", async () => {
    const h = harness();
    await h.lifecycle("install");
    h.fetch.mockResolvedValueOnce(new Response("new deployment shell"));
    expect(await (await h.request("/local"))!.text()).toBe("new deployment shell");
    expect(h.cache.put).not.toHaveBeenCalled();
    expect(await h.entries.get("/local")!.text()).toBe("/local");
  });
  it("respects a server disabling local play instead of reviving the offline shell", async () => {
    const h = harness();
    await h.lifecycle("install");
    h.fetch.mockResolvedValueOnce(new Response("disabled", { status: 404 }));
    expect((await h.request("/local"))!.status).toBe(404);
    expect(h.caches.delete).toHaveBeenCalledWith("checkers-local-new");
    expect(h.self.registration.unregister).toHaveBeenCalled();
  });
});
