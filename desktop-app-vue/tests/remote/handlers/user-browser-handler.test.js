/**
 * UserBrowserHandler 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock WebSocket
vi.mock("ws", () => {
  class MockWebSocket {
    constructor() {
      this._listeners = {};
      this.readyState = 1; // OPEN
      // Auto-fire 'open' event after construction
      setImmediate(() => this.emit("open"));
    }

    on(event, handler) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(handler);
    }

    emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach((handler) => handler(data));
      }
    }

    send(data) {}

    close() {
      this.readyState = 3;
    }
  }
  MockWebSocket.OPEN = 1;
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// Mock fs
vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue(
    JSON.stringify({
      roots: {
        bookmark_bar: {
          type: "folder",
          name: "Bookmarks Bar",
          children: [{ type: "url", name: "Test", url: "https://test.com" }],
        },
      },
    }),
  ),
}));

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn().mockReturnValue({
    unref: vi.fn(),
    on: vi.fn(),
  }),
}));

// Mock http
vi.mock("http", () => ({
  get: vi.fn().mockImplementation((url, callback) => {
    const mockRes = {
      on: vi.fn().mockImplementation((event, handler) => {
        if (event === "data") {
          if (url.includes("/json/version")) {
            handler(
              JSON.stringify({
                Browser: "Chrome/120.0",
                webSocketDebuggerUrl:
                  "ws://localhost:9222/devtools/browser/123",
              }),
            );
          } else if (url.includes("/json/list")) {
            handler(
              JSON.stringify([
                {
                  id: "tab-1",
                  type: "page",
                  title: "Test Page",
                  url: "https://example.com",
                  webSocketDebuggerUrl:
                    "ws://localhost:9222/devtools/page/tab-1",
                },
              ]),
            );
          } else if (url.includes("/json/new")) {
            handler(
              JSON.stringify({
                id: "tab-2",
                title: "New Tab",
                url: "about:blank",
                webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/tab-2",
              }),
            );
          } else {
            handler("OK");
          }
        }
        if (event === "end") {
          handler();
        }
        return mockRes;
      }),
    };
    callback(mockRes);
    return { on: vi.fn() };
  }),
}));

// Import after mocks
const { UserBrowserHandler } =
  await import("../../../src/main/remote/handlers/user-browser-handler.js");

describe("UserBrowserHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new UserBrowserHandler({
      autoLaunch: false,
      connectionTimeout: 1000,
    });
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  describe("Constructor", () => {
    it("should create handler with default options", () => {
      const h = new UserBrowserHandler();
      expect(h.options.defaultBrowser).toBe("chrome");
      expect(h.options.debugPort).toBe(9222);
      expect(h.connected).toBe(false);
    });

    it("should merge custom options", () => {
      const h = new UserBrowserHandler({
        defaultBrowser: "edge",
        debugPort: 9223,
      });
      expect(h.options.defaultBrowser).toBe("edge");
      expect(h.options.debugPort).toBe(9223);
    });
  });

  describe("findBrowsers", () => {
    it("should return available browsers", async () => {
      const result = await handler.findBrowsers();
      expect(result).toHaveProperty("browsers");
      expect(Array.isArray(result.browsers)).toBe(true);
    });
  });

  describe("getStatus", () => {
    it("should return disconnected status initially", async () => {
      const status = await handler.getStatus();
      expect(status.connected).toBe(false);
      expect(status.browserType).toBeNull();
      expect(status.tabCount).toBe(0);
    });
  });

  describe("handle", () => {
    it("should route to correct action", async () => {
      const statusSpy = vi.spyOn(handler, "getStatus");
      await handler.handle("getStatus", {}, {});
      expect(statusSpy).toHaveBeenCalled();
    });

    it("should throw error for unknown action", async () => {
      await expect(handler.handle("unknownAction", {}, {})).rejects.toThrow(
        "Unknown action: unknownAction",
      );
    });

    it("should increment stats on command", async () => {
      const initialCount = handler.stats.commandCount;
      await handler.handle("getStatus", {}, {});
      expect(handler.stats.commandCount).toBe(initialCount + 1);
    });
  });

  describe("Connection Management", () => {
    it("should throw when not connected", async () => {
      await expect(handler.listTabs()).rejects.toThrow(
        "Not connected to browser",
      );
    });

    it("should throw for unsupported browser type", async () => {
      await expect(handler.connect({ browserType: "safari" })).rejects.toThrow(
        "不支持的浏览器类型",
      );
    });
  });

  describe("Tab Management", () => {
    it("should require tabId for closeTab", async () => {
      // Mock connected state
      handler.connected = true;
      handler.tabs.set("tab-1", { id: "tab-1" });

      await expect(handler.closeTab({})).rejects.toThrow("tabId is required");
    });

    it("should require tabId for focusTab", async () => {
      handler.connected = true;
      await expect(handler.focusTab({})).rejects.toThrow("tabId is required");
    });
  });

  describe("Navigation", () => {
    it("should require url for navigate", async () => {
      handler.connected = true;
      handler.tabs.set("tab-1", { id: "tab-1" });

      await expect(handler.navigate({})).rejects.toThrow("url is required");
    });

    it("should throw when no tab available for navigation", async () => {
      handler.connected = true;
      // No tabs

      await expect(
        handler.navigate({ url: "https://example.com" }),
      ).rejects.toThrow("No tab available");
    });
  });

  describe("Page Operations", () => {
    it("should require script for executeScript", async () => {
      handler.connected = true;
      handler.tabs.set("tab-1", { id: "tab-1" });

      await expect(handler.executeScript({})).rejects.toThrow(
        "script is required",
      );
    });
  });

  describe("Bookmarks", () => {
    it("should throw when bookmarks disabled", async () => {
      handler.options.enableBookmarks = false;
      await expect(handler.getBookmarks()).rejects.toThrow(
        "Bookmarks access is disabled",
      );
    });

    it("should return bookmarks when enabled", async () => {
      handler.browserType = "chrome";
      handler.options.enableBookmarks = true;

      const result = await handler.getBookmarks({});
      expect(result).toHaveProperty("bookmarks");
      expect(Array.isArray(result.bookmarks)).toBe(true);
    });
  });

  describe("History", () => {
    it("should throw when history disabled", async () => {
      handler.options.enableHistory = false;
      await expect(handler.getHistory()).rejects.toThrow(
        "History access is disabled",
      );
    });
  });

  describe("Cleanup", () => {
    it("should cleanup resources", async () => {
      await handler.cleanup();
      expect(handler.connected).toBe(false);
    });
  });
});

describe("CDPSession", () => {
  it("should return cached tab session", async () => {
    const handler = new UserBrowserHandler();
    handler.connected = true;
    handler.tabs.set("tab-1", {
      id: "tab-1",
      webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/tab-1",
    });

    // Pre-populate cdpSessions cache to avoid real WebSocket connection
    const mockSession = { send: vi.fn(), close: vi.fn() };
    handler.cdpSessions.set("tab-1", mockSession);

    const session = await handler.getTabSession("tab-1");
    expect(session).toBeDefined();
    expect(session).toBe(mockSession);
  });

  it("should throw for non-existent tab", async () => {
    const handler = new UserBrowserHandler();
    handler.connected = true;

    await expect(handler.getTabSession("nonexistent")).rejects.toThrow(
      "Tab not found",
    );
  });
});
