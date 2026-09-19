import { describe, expect, it, vi } from "vitest";

const { BrowserEngine } = require("../browser-engine");

function pageFixture(requestUrls, finalUrl = requestUrls.at(-1)) {
  const mainFrame = Object.freeze({ id: "main" });
  let routeHandler = null;
  const routes = [];
  const page = {
    mainFrame: vi.fn(() => mainFrame),
    on: vi.fn(),
    close: vi.fn(async () => {}),
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

function historyPageFixture({
  entries,
  currentIndex,
  finalUrl,
  requestUrls = [],
}) {
  const mainFrame = Object.freeze({ id: "main" });
  let routeHandler = null;
  const routes = [];
  const cdpSession = {
    send: vi.fn(async (method) => {
      if (method !== "Page.getNavigationHistory") throw new Error(method);
      return { currentIndex, entries };
    }),
    detach: vi.fn(async () => {}),
  };
  const dispatchRequests = async () => {
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
      await routeHandler(route);
      if (blocked) throw new Error("net::ERR_BLOCKED_BY_CLIENT");
    }
  };
  const page = {
    mainFrame: vi.fn(() => mainFrame),
    context: vi.fn(() => ({
      newCDPSession: vi.fn(async () => cdpSession),
    })),
    route: vi.fn(async (_pattern, handler) => {
      routeHandler = handler;
    }),
    unroute: vi.fn(async () => {}),
    goBack: vi.fn(dispatchRequests),
    goForward: vi.fn(dispatchRequests),
    reload: vi.fn(dispatchRequests),
    title: vi.fn(async () => "History target"),
    url: vi.fn(() => finalUrl),
  };
  return { page, routes, cdpSession };
}

describe("BrowserEngine governed navigation redirect guard", () => {
  it("guards a new tab from its first request and removes the guard", async () => {
    const { page, routes } = pageFixture(
      ["https://example.test/start", "https://login.example.test/continue"],
      "https://login.example.test/continue",
    );
    const engine = new BrowserEngine();
    engine.contexts.set("default", {
      newPage: vi.fn(async () => page),
    });

    await expect(
      engine.openTab("default", "https://example.test/start", {
        allowedRedirectOrigins: [
          "https://example.test",
          "https://login.example.test",
        ],
      }),
    ).resolves.toMatchObject({
      success: true,
      targetId: "tab-1",
      url: "https://login.example.test/continue",
    });
    expect(routes).toHaveLength(2);
    expect(page.close).not.toHaveBeenCalled();
    expect(engine.pages.get("tab-1")).toBe(page);
    expect(page.unroute).toHaveBeenCalledOnce();
  });

  it("closes and forgets a half-created tab after an unapproved redirect", async () => {
    const { page, routes } = pageFixture([
      "https://example.test/start",
      "https://blocked.test/redirect",
    ]);
    const engine = new BrowserEngine();
    engine.contexts.set("default", {
      newPage: vi.fn(async () => page),
    });

    await expect(
      engine.openTab("default", "https://example.test/start", {
        allowedRedirectOrigins: ["https://example.test"],
      }),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/u);
    expect(routes[1].abort).toHaveBeenCalledWith("blockedbyclient");
    expect(page.close).toHaveBeenCalledOnce();
    expect(engine.pages.has("tab-1")).toBe(false);
    expect(page.unroute).toHaveBeenCalledOnce();
  });

  it("rejects an out-of-scope initial tab URL before creating a page", async () => {
    const newPage = vi.fn();
    const engine = new BrowserEngine();
    engine.contexts.set("default", { newPage });

    await expect(
      engine.openTab("default", "https://blocked.test/start", {
        allowedRedirectOrigins: ["https://example.test"],
      }),
    ).rejects.toThrow(/outside the approved scope/u);
    expect(newPage).not.toHaveBeenCalled();
  });

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

  it("preflights an approved back target and guards its redirects", async () => {
    const { page, routes, cdpSession } = historyPageFixture({
      entries: [
        { id: 1, url: "https://example.test/previous" },
        { id: 2, url: "https://example.test/current" },
      ],
      currentIndex: 1,
      finalUrl: "https://login.example.test/complete",
      requestUrls: [
        "https://example.test/previous",
        "https://login.example.test/complete",
      ],
    });
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigateHistory("tab-1", "back", {
        allowedRedirectOrigins: [
          "https://example.test",
          "https://login.example.test",
        ],
      }),
    ).resolves.toMatchObject({
      success: true,
      operation: "back",
      url: "https://login.example.test/complete",
    });
    expect(page.goBack).toHaveBeenCalledOnce();
    expect(routes).toHaveLength(2);
    expect(cdpSession.detach).toHaveBeenCalledOnce();
    expect(page.unroute).toHaveBeenCalledOnce();
  });

  it("blocks an unapproved forward history target before page mutation", async () => {
    const { page, cdpSession } = historyPageFixture({
      entries: [
        { id: 1, url: "https://example.test/current" },
        { id: 2, url: "https://blocked.test/next" },
      ],
      currentIndex: 0,
      finalUrl: "https://example.test/current",
    });
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigateHistory("tab-1", "forward", {
        allowedRedirectOrigins: ["https://example.test"],
      }),
    ).rejects.toThrow(/outside the approved scope/u);
    expect(page.route).toHaveBeenCalledOnce();
    expect(page.goForward).not.toHaveBeenCalled();
    expect(cdpSession.detach).toHaveBeenCalledOnce();
    expect(page.unroute).toHaveBeenCalledOnce();
  });

  it("guards refresh redirects and removes the guard after failure", async () => {
    const { page, routes } = historyPageFixture({
      entries: [],
      currentIndex: 0,
      finalUrl: "https://example.test/current",
      requestUrls: [
        "https://example.test/current",
        "https://blocked.test/redirect",
      ],
    });
    const engine = new BrowserEngine();
    engine.pages.set("tab-1", page);

    await expect(
      engine.navigateHistory("tab-1", "refresh", {
        allowedRedirectOrigins: ["https://example.test"],
      }),
    ).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/u);
    expect(routes[0].continue).toHaveBeenCalledOnce();
    expect(routes[1].abort).toHaveBeenCalledWith("blockedbyclient");
    expect(page.unroute).toHaveBeenCalledOnce();
  });
});
