import { describe, expect, it, vi } from "vitest";

const { BrowserEngine } = require("../browser-engine");

function pageFixture(requestUrls, finalUrl = requestUrls.at(-1)) {
  const mainFrame = Object.freeze({ id: "main" });
  let routeHandler = null;
  const routes = [];
  const page = {
    mainFrame: vi.fn(() => mainFrame),
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    unroute: vi.fn(async () => {}),
    goto: vi.fn(async () => {
      for (const requestUrl of requestUrls) {
        let blocked = false;
        const route = {
          request: () => ({
            frame: () => mainFrame,
            isNavigationRequest: () => true,
            url: () => requestUrl,
          }),
          abort: vi.fn(async () => {
            blocked = true;
          }),
          continue: vi.fn(async () => {}),
          fallback: vi.fn(async () => {}),
        };
        routes.push(route);
        if (routeHandler) await routeHandler(route);
        if (blocked) throw new Error("net::ERR_BLOCKED_BY_CLIENT");
      }
    }),
    title: vi.fn(async () => "Example"),
    url: vi.fn(() => finalUrl),
  };
  return { page, routes };
}

describe("BrowserEngine governed navigation redirect guard", () => {
  it("allows only explicitly bound main-frame origins and removes the guard", async () => {
    const { page, routes } = pageFixture([
      "https://example.test/start",
      "https://login.example.test/continue",
    ]);
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigate("tab-1", "https://example.test/start", {
        allowedRedirectOrigins: [
          "https://example.test",
          "https://login.example.test",
        ],
      }),
    ).resolves.toMatchObject({
      success: true,
      url: "https://login.example.test/continue",
    });
    expect(routes).toHaveLength(2);
    expect(
      routes.every((route) => route.continue.mock.calls.length === 1),
    ).toBe(true);
    expect(page.unroute).toHaveBeenCalledWith(
      "**/*",
      page.route.mock.calls[0][1],
    );
  });

  it("aborts an unapproved cross-origin redirect before it loads", async () => {
    const { page, routes } = pageFixture([
      "https://example.test/start",
      "https://blocked.test/redirect",
    ]);
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigate("tab-1", "https://example.test/start", {
        allowedRedirectOrigins: ["https://example.test"],
      }),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/u);
    expect(routes[0].continue).toHaveBeenCalledOnce();
    expect(routes[1].abort).toHaveBeenCalledWith("blockedbyclient");
    expect(routes[1].continue).not.toHaveBeenCalled();
    expect(page.unroute).toHaveBeenCalledOnce();
  });

  it("does not install the Agent redirect guard for ordinary navigation", async () => {
    const { page } = pageFixture([
      "https://example.test/start",
      "https://different.test/redirect",
    ]);
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigate("tab-1", "https://example.test/start"),
    ).resolves.toMatchObject({ success: true });
    expect(page.route).not.toHaveBeenCalled();
    expect(page.unroute).not.toHaveBeenCalled();
  });

  it("rejects malformed allowed origins before navigation", async () => {
    const { page } = pageFixture(["https://example.test/start"]);
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigate("tab-1", "https://example.test/start", {
        allowedRedirectOrigins: ["https://example.test/path"],
      }),
    ).rejects.toThrow(/Allowed navigation origins/u);
    expect(page.route).not.toHaveBeenCalled();
    expect(page.goto).not.toHaveBeenCalled();
  });
});
