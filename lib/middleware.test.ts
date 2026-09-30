import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

describe("unsupported Server Actions", () => {
  it("rejects an unknown action before it reaches the page renderer", async () => {
    const response = middleware(new NextRequest("https://checkers.example/", {
      method: "POST", headers: { "next-action": "y" }, body: "[]",
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Server Actions are not supported." });
  });
  it.each(["GET", "POST"])("passes ordinary %s requests through", (method) => {
    const response = middleware(new NextRequest("https://checkers.example/signin", { method }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
