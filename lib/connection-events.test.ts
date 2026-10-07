import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionEvents } from "./connection-events";

afterEach(() => vi.useRealTimers());

describe("server connection stream", () => {
  it("confirms storage before enabling online choices and stops on abort", async () => {
    vi.useFakeTimers();
    const aborter = new AbortController();
    const ping = vi.fn().mockResolvedValue("PONG");
    const response = connectionEvents(new Request("https://checkers.test/api/connection", { signal: aborter.signal }), ping);
    const reader = response.body!.getReader();
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"connected":true}\n\n');
    await vi.advanceTimersByTimeAsync(10000);
    expect((await reader.read()).done).toBe(false);
    aborter.abort();
    expect((await reader.read()).done).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(ping).toHaveBeenCalledTimes(2);
  });
  it("fails instead of advertising online readiness when storage is unavailable", async () => {
    const response = connectionEvents(new Request("https://checkers.test/api/connection"), async () => { throw new Error("storage down"); });
    await expect(response.body!.getReader().read()).rejects.toThrow("storage down");
  });
  it("releases its heartbeat when the browser cancels the stream", async () => {
    vi.useFakeTimers();
    const ping = vi.fn().mockResolvedValue("PONG");
    const response = connectionEvents(new Request("https://checkers.test/api/connection"), ping);
    await response.body!.cancel();
    await vi.advanceTimersByTimeAsync(30000);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
