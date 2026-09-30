import { afterEach, expect, it, vi } from "vitest";
import { fetchResponse, readJson, NetworkError } from "./http-client";

afterEach(() => vi.unstubAllGlobals());
it("classifies fetch transport failures but preserves aborts and unexpected failures", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(fetchResponse("/api/game/match")).rejects.toBeInstanceOf(NetworkError);
  const abort = new DOMException("Aborted", "AbortError");
  fetch.mockRejectedValueOnce(abort);
  await expect(fetchResponse("/api/game/match")).rejects.toBe(abort);
  const bug = new ReferenceError("broken");
  fetch.mockRejectedValueOnce(bug);
  await expect(fetchResponse("/api/game/match")).rejects.toBe(bug);
});
it("does not retry malformed JSON as a network failure", async () => {
  await expect(readJson(new Response("broken"))).rejects.toBeInstanceOf(SyntaxError);
  const brokenBody = new ReadableStream({ start(controller) { controller.error(new TypeError("terminated")); } });
  await expect(readJson(new Response(brokenBody))).rejects.toBeInstanceOf(NetworkError);
});
