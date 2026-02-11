/**
 * BrowserExtensionServer 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock WebSocket.Server
const mockWss = {
  on: vi.fn(),
  close: vi.fn().mockImplementation((callback) => callback()),
};

vi.mock("ws", () => ({
  default: {
    Server: vi.fn().mockImplementation(() => mockWss),
  },
  Server: vi.fn().mockImplementation(() => mockWss),
}));

// Import after mocks
const { BrowserExtensionServer, ExtensionBrowserHandler } =
  await import("../../src/main/remote/browser-extension-server.js");

describe("BrowserExtensionServer", () => {
  let server;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new BrowserExtensionServer({
      port: 18790,
      host: "127.0.0.1",
    });
  });

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop();
    }
  });

  describe("Constructor", () => {
    it("should create server with default options", () => {
      const s = new BrowserExtensionServer();
      expect(s.options.port).toBe(18790);
      expect(s.options.host).toBe("127.0.0.1");
      expect(s.options.maxConnections).toBe(10);
    });

    it("should merge custom options", () => {
      const s = new BrowserExtensionServer({
        port: 9999,
        maxConnections: 5,
      });
      expect(s.options.port).toBe(9999);
      expect(s.options.maxConnections).toBe(5);
    });

    it("should initialize with empty state", () => {
      expect(server.clients.size).toBe(0);
      expect(server.connected).toBeUndefined();
      expect(server.wss).toBeNull();
    });
  });

  describe("start", () => {
    it("should start WebSocket server", async () => {
      // Simulate listening event
      mockWss.on.mockImplementation((event, callback) => {
        if (event === "listening") {
          setTimeout(callback, 0);
        }
      });

      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it("should not start if already running", async () => {
      server.wss = mockWss; // Fake running state

      await server.start();
      // Should warn but not throw
    });
  });

  describe("stop", () => {
    it("should stop server and cleanup", async () => {
      server.wss = mockWss;
      server.heartbeatTimer = setInterval(() => {}, 1000);

      await server.stop();

      expect(server.wss).toBeNull();
      expect(server.clients.size).toBe(0);
    });

    it("should handle stop when not running", async () => {
      await server.stop();
      // Should not throw
    });
  });

  describe("getStats", () => {
    it("should return server statistics", () => {
      const stats = server.getStats();

      expect(stats).toHaveProperty("startTime");
      expect(stats).toHaveProperty("totalConnections");
      expect(stats).toHaveProperty("currentConnections");
      expect(stats).toHaveProperty("messagesSent");
      expect(stats).toHaveProperty("messagesReceived");
      expect(stats).toHaveProperty("uptime");
    });

    it("should calculate uptime correctly", () => {
      server.stats.startTime = Date.now() - 5000;
      const stats = server.getStats();
      expect(stats.uptime).toBeGreaterThanOrEqual(4900);
      expect(stats.uptime).toBeLessThanOrEqual(5100);
    });
  });

  describe("getClients", () => {
    it("should return empty array when no clients", () => {
      const clients = server.getClients();
      expect(clients).toEqual([]);
    });

    it("should return client info", () => {
      server.clients.set("client-1", {
        id: "client-1",
        ip: "127.0.0.1",
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        info: { name: "test-extension" },
        ws: { readyState: 1 },
      });

      const clients = server.getClients();
      expect(clients).toHaveLength(1);
      expect(clients[0].id).toBe("client-1");
      expect(clients[0].info.name).toBe("test-extension");
    });
  });

  describe("getFirstClientId", () => {
    it("should return null when no clients", () => {
      expect(server.getFirstClientId()).toBeNull();
    });

    it("should return first client ID", () => {
      server.clients.set("client-1", {});
      server.clients.set("client-2", {});

      expect(server.getFirstClientId()).toBe("client-1");
    });
  });

  describe("generateClientId", () => {
    it("should generate unique client IDs", () => {
      const id1 = server.generateClientId();
      const id2 = server.generateClientId();

      expect(id1).toMatch(/^ext-\d+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("sendCommand", () => {
    it("should throw when client not connected", async () => {
      await expect(
        server.sendCommand("unknown-client", "test.method", {}),
      ).rejects.toThrow("Client not connected");
    });

    it("should throw when WebSocket not open", async () => {
      server.clients.set("client-1", {
        ws: { readyState: 3 }, // CLOSED
      });

      await expect(
        server.sendCommand("client-1", "test.method", {}),
      ).rejects.toThrow("Client not connected");
    });
  });
});

describe("ExtensionBrowserHandler", () => {
  let server;
  let handler;

  beforeEach(() => {
    server = new BrowserExtensionServer();
    handler = new ExtensionBrowserHandler(server);
  });

  describe("Constructor", () => {
    it("should store server reference", () => {
      expect(handler.server).toBe(server);
    });
  });

  describe("handle", () => {
    it("should throw when no extension connected", async () => {
      await expect(handler.handle("listTabs", {}, {})).rejects.toThrow(
        "No browser extension connected",
      );
    });

    it("should route to correct server command", async () => {
      const sendCommandSpy = vi
        .spyOn(server, "sendCommand")
        .mockResolvedValue({ tabs: [] });

      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });

      await handler.handle("listTabs", {}, {});

      expect(sendCommandSpy).toHaveBeenCalledWith("client-1", "tabs.list", {});
    });

    it("should throw for unknown action", async () => {
      server.clients.set("client-1", {});

      await expect(handler.handle("unknownAction", {}, {})).rejects.toThrow(
        "Unknown action: unknownAction",
      );
    });
  });

  describe("Tab Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle createTab", async () => {
      await handler.handle("createTab", { url: "https://example.com" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "tabs.create",
        { url: "https://example.com" },
      );
    });

    it("should handle closeTab", async () => {
      await handler.handle("closeTab", { tabId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "tabs.close",
        { tabId: 123 },
      );
    });

    it("should handle navigate", async () => {
      await handler.handle(
        "navigate",
        { tabId: 123, url: "https://example.com" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "tabs.navigate",
        { tabId: 123, url: "https://example.com" },
      );
    });
  });

  describe("Bookmark Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getBookmarks", async () => {
      await handler.handle("getBookmarks", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "bookmarks.getTree",
        {},
      );
    });

    it("should handle searchBookmarks", async () => {
      await handler.handle("searchBookmarks", { query: "test" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "bookmarks.search",
        { query: "test" },
      );
    });
  });

  describe("History Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getHistory", async () => {
      await handler.handle("getHistory", { query: "test" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "history.search",
        { query: "test" },
      );
    });
  });

  describe("Clipboard Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle readClipboard", async () => {
      await handler.handle("readClipboard", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.read",
        {},
      );
    });

    it("should handle writeClipboard", async () => {
      await handler.handle("writeClipboard", { text: "hello" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.write",
        { text: "hello" },
      );
    });
  });

  describe("Cookie Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getCookies", async () => {
      await handler.handle("getCookies", { url: "https://example.com" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cookies.getAll",
        { url: "https://example.com" },
      );
    });

    it("should handle getCookie", async () => {
      await handler.handle(
        "getCookie",
        { url: "https://example.com", name: "session" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cookies.get",
        { url: "https://example.com", name: "session" },
      );
    });

    it("should handle setCookie", async () => {
      await handler.handle(
        "setCookie",
        {
          url: "https://example.com",
          name: "session",
          value: "abc123",
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cookies.set",
        { url: "https://example.com", name: "session", value: "abc123" },
      );
    });

    it("should handle removeCookie", async () => {
      await handler.handle(
        "removeCookie",
        { url: "https://example.com", name: "session" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cookies.remove",
        { url: "https://example.com", name: "session" },
      );
    });

    it("should handle clearCookies", async () => {
      await handler.handle("clearCookies", { domain: "example.com" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cookies.clear",
        { domain: "example.com" },
      );
    });
  });

  describe("Download Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle listDownloads", async () => {
      await handler.handle("listDownloads", { limit: 10 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.list",
        { limit: 10 },
      );
    });

    it("should handle download", async () => {
      await handler.handle(
        "download",
        { url: "https://example.com/file.pdf" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.download",
        { url: "https://example.com/file.pdf" },
      );
    });

    it("should handle cancelDownload", async () => {
      await handler.handle("cancelDownload", { downloadId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.cancel",
        { downloadId: 123 },
      );
    });

    it("should handle pauseDownload", async () => {
      await handler.handle("pauseDownload", { downloadId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.pause",
        { downloadId: 123 },
      );
    });

    it("should handle resumeDownload", async () => {
      await handler.handle("resumeDownload", { downloadId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.resume",
        { downloadId: 123 },
      );
    });

    it("should handle openDownload", async () => {
      await handler.handle("openDownload", { downloadId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.open",
        { downloadId: 123 },
      );
    });

    it("should handle showDownload", async () => {
      await handler.handle("showDownload", { downloadId: 123 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.show",
        { downloadId: 123 },
      );
    });

    it("should handle eraseDownloads", async () => {
      await handler.handle("eraseDownloads", { state: "complete" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "downloads.erase",
        { state: "complete" },
      );
    });
  });

  describe("Window Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getAllWindows", async () => {
      await handler.handle("getAllWindows", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.getAll",
        {},
      );
    });

    it("should handle getWindow", async () => {
      await handler.handle("getWindow", { windowId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.get",
        { windowId: 1 },
      );
    });

    it("should handle createWindow", async () => {
      await handler.handle(
        "createWindow",
        { url: "https://example.com", width: 800, height: 600 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.create",
        { url: "https://example.com", width: 800, height: 600 },
      );
    });

    it("should handle updateWindow", async () => {
      await handler.handle(
        "updateWindow",
        { windowId: 1, state: "maximized" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.update",
        { windowId: 1, state: "maximized" },
      );
    });

    it("should handle removeWindow", async () => {
      await handler.handle("removeWindow", { windowId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.remove",
        { windowId: 1 },
      );
    });

    it("should handle getCurrentWindow", async () => {
      await handler.handle("getCurrentWindow", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "windows.getCurrent",
        {},
      );
    });
  });

  describe("Storage Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getLocalStorage", async () => {
      await handler.handle(
        "getLocalStorage",
        { tabId: 1, keys: ["user", "token"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.getLocal",
        { tabId: 1, keys: ["user", "token"] },
      );
    });

    it("should handle setLocalStorage", async () => {
      await handler.handle(
        "setLocalStorage",
        { tabId: 1, data: { user: "john" } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.setLocal",
        { tabId: 1, data: { user: "john" } },
      );
    });

    it("should handle getSessionStorage", async () => {
      await handler.handle(
        "getSessionStorage",
        { tabId: 1, keys: ["session"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.getSession",
        { tabId: 1, keys: ["session"] },
      );
    });

    it("should handle setSessionStorage", async () => {
      await handler.handle(
        "setSessionStorage",
        { tabId: 1, data: { session: "xyz" } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.setSession",
        { tabId: 1, data: { session: "xyz" } },
      );
    });

    it("should handle clearLocalStorage", async () => {
      await handler.handle("clearLocalStorage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.clearLocal",
        { tabId: 1 },
      );
    });

    it("should handle clearSessionStorage", async () => {
      await handler.handle("clearSessionStorage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.clearSession",
        { tabId: 1 },
      );
    });
  });

  describe("Element Interaction Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle hoverElement", async () => {
      await handler.handle(
        "hoverElement",
        { tabId: 1, selector: "#button" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.hover",
        { tabId: 1, selector: "#button" },
      );
    });

    it("should handle focusElement", async () => {
      await handler.handle(
        "focusElement",
        { tabId: 1, selector: "#input" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.focus",
        { tabId: 1, selector: "#input" },
      );
    });

    it("should handle blurElement", async () => {
      await handler.handle("blurElement", { tabId: 1, selector: "#input" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.blur",
        { tabId: 1, selector: "#input" },
      );
    });

    it("should handle selectText", async () => {
      await handler.handle(
        "selectText",
        { tabId: 1, selector: "#input", start: 0, end: 10 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.select",
        { tabId: 1, selector: "#input", start: 0, end: 10 },
      );
    });

    it("should handle getAttribute", async () => {
      await handler.handle(
        "getAttribute",
        { tabId: 1, selector: "#link", attribute: "href" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.getAttribute",
        { tabId: 1, selector: "#link", attribute: "href" },
      );
    });

    it("should handle setAttribute", async () => {
      await handler.handle(
        "setAttribute",
        {
          tabId: 1,
          selector: "#link",
          attribute: "href",
          value: "https://example.com",
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.setAttribute",
        {
          tabId: 1,
          selector: "#link",
          attribute: "href",
          value: "https://example.com",
        },
      );
    });

    it("should handle getBoundingRect", async () => {
      await handler.handle(
        "getBoundingRect",
        { tabId: 1, selector: "#box" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.getBoundingRect",
        { tabId: 1, selector: "#box" },
      );
    });

    it("should handle isVisible", async () => {
      await handler.handle("isVisible", { tabId: 1, selector: "#element" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.isVisible",
        { tabId: 1, selector: "#element" },
      );
    });

    it("should handle waitForSelector", async () => {
      await handler.handle(
        "waitForSelector",
        { tabId: 1, selector: "#loading", options: { timeout: 5000 } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.waitForSelector",
        { tabId: 1, selector: "#loading", options: { timeout: 5000 } },
      );
    });

    it("should handle dragDrop", async () => {
      await handler.handle(
        "dragDrop",
        { tabId: 1, sourceSelector: "#drag", targetSelector: "#drop" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "element.dragDrop",
        { tabId: 1, sourceSelector: "#drag", targetSelector: "#drop" },
      );
    });
  });

  describe("Page Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle printPage", async () => {
      await handler.handle("printPage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "page.print",
        { tabId: 1 },
      );
    });

    it("should handle saveToPdf", async () => {
      await handler.handle(
        "saveToPdf",
        { tabId: 1, options: { landscape: true } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith("client-1", "page.pdf", {
        tabId: 1,
        options: { landscape: true },
      });
    });

    it("should handle getConsoleLogs", async () => {
      await handler.handle("getConsoleLogs", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "page.getConsole",
        { tabId: 1 },
      );
    });

    it("should handle setViewport", async () => {
      await handler.handle(
        "setViewport",
        { tabId: 1, width: 1920, height: 1080 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "page.setViewport",
        { tabId: 1, width: 1920, height: 1080 },
      );
    });

    it("should handle emulateDevice", async () => {
      await handler.handle(
        "emulateDevice",
        { tabId: 1, device: "iPhone 12" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "page.emulateDevice",
        { tabId: 1, device: "iPhone 12" },
      );
    });

    it("should handle setGeolocation", async () => {
      await handler.handle(
        "setGeolocation",
        { tabId: 1, latitude: 37.7749, longitude: -122.4194 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "page.setGeolocation",
        { tabId: 1, latitude: 37.7749, longitude: -122.4194 },
      );
    });
  });

  describe("Browsing Data Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle clearBrowsingData", async () => {
      await handler.handle(
        "clearBrowsingData",
        { cache: true, cookies: true },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "browsingData.clear",
        { cache: true, cookies: true },
      );
    });
  });

  describe("Network Interception Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle enableNetworkInterception", async () => {
      await handler.handle(
        "enableNetworkInterception",
        { tabId: 1, patterns: ["*.js"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.enableInterception",
        { tabId: 1, patterns: ["*.js"] },
      );
    });

    it("should handle disableNetworkInterception", async () => {
      await handler.handle("disableNetworkInterception", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.disableInterception",
        { tabId: 1 },
      );
    });

    it("should handle setRequestBlocking", async () => {
      await handler.handle(
        "setRequestBlocking",
        { patterns: ["*ads*", "*tracking*"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.setRequestBlocking",
        { patterns: ["*ads*", "*tracking*"] },
      );
    });

    it("should handle getNetworkRequests", async () => {
      await handler.handle("getNetworkRequests", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.getRequests",
        { tabId: 1 },
      );
    });

    it("should handle mockResponse", async () => {
      await handler.handle(
        "mockResponse",
        {
          tabId: 1,
          url: "/api/test",
          response: { status: 200, body: { data: "mock" } },
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.mockResponse",
        {
          tabId: 1,
          url: "/api/test",
          response: { status: 200, body: { data: "mock" } },
        },
      );
    });
  });

  describe("Console Capture Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle enableConsoleCapture", async () => {
      await handler.handle("enableConsoleCapture", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "console.enable",
        { tabId: 1 },
      );
    });

    it("should handle disableConsoleCapture", async () => {
      await handler.handle("disableConsoleCapture", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "console.disable",
        { tabId: 1 },
      );
    });

    it("should handle getCapturedConsoleLogs", async () => {
      await handler.handle("getCapturedConsoleLogs", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "console.getLogs",
        { tabId: 1 },
      );
    });

    it("should handle clearConsoleLogs", async () => {
      await handler.handle("clearConsoleLogs", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "console.clear",
        { tabId: 1 },
      );
    });
  });

  describe("IndexedDB Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getIndexedDBDatabases", async () => {
      await handler.handle("getIndexedDBDatabases", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "indexedDB.getDatabases",
        { tabId: 1 },
      );
    });

    it("should handle getIndexedDBData", async () => {
      await handler.handle(
        "getIndexedDBData",
        {
          tabId: 1,
          dbName: "testDB",
          storeName: "users",
          query: { limit: 10 },
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "indexedDB.getData",
        {
          tabId: 1,
          dbName: "testDB",
          storeName: "users",
          query: { limit: 10 },
        },
      );
    });

    it("should handle setIndexedDBData", async () => {
      await handler.handle(
        "setIndexedDBData",
        {
          tabId: 1,
          dbName: "testDB",
          storeName: "users",
          key: "user1",
          value: { name: "John" },
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "indexedDB.setData",
        {
          tabId: 1,
          dbName: "testDB",
          storeName: "users",
          key: "user1",
          value: { name: "John" },
        },
      );
    });

    it("should handle deleteIndexedDBData", async () => {
      await handler.handle(
        "deleteIndexedDBData",
        { tabId: 1, dbName: "testDB", storeName: "users", key: "user1" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "indexedDB.deleteData",
        { tabId: 1, dbName: "testDB", storeName: "users", key: "user1" },
      );
    });

    it("should handle clearIndexedDBStore", async () => {
      await handler.handle(
        "clearIndexedDBStore",
        { tabId: 1, dbName: "testDB", storeName: "users" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "indexedDB.clearStore",
        { tabId: 1, dbName: "testDB", storeName: "users" },
      );
    });
  });

  describe("Performance Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getPerformanceMetrics", async () => {
      await handler.handle("getPerformanceMetrics", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "performance.getMetrics",
        { tabId: 1 },
      );
    });

    it("should handle getPerformanceEntries", async () => {
      await handler.handle(
        "getPerformanceEntries",
        { tabId: 1, type: "resource" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "performance.getEntries",
        { tabId: 1, type: "resource" },
      );
    });

    it("should handle startPerformanceTrace", async () => {
      await handler.handle("startPerformanceTrace", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "performance.startTrace",
        { tabId: 1 },
      );
    });

    it("should handle stopPerformanceTrace", async () => {
      await handler.handle("stopPerformanceTrace", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "performance.stopTrace",
        { tabId: 1 },
      );
    });
  });

  describe("CSS Injection Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle injectCSS", async () => {
      await handler.handle(
        "injectCSS",
        { tabId: 1, css: "body { background: red; }" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "css.inject",
        {
          tabId: 1,
          css: "body { background: red; }",
        },
      );
    });

    it("should handle removeCSS", async () => {
      await handler.handle("removeCSS", { tabId: 1, cssId: "css-123" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "css.remove",
        {
          tabId: 1,
          cssId: "css-123",
        },
      );
    });
  });

  describe("Accessibility Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getAccessibilityTree", async () => {
      await handler.handle(
        "getAccessibilityTree",
        { tabId: 1, selector: "#main" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "accessibility.getTree",
        { tabId: 1, selector: "#main" },
      );
    });

    it("should handle getElementRole", async () => {
      await handler.handle(
        "getElementRole",
        { tabId: 1, selector: "#button" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "accessibility.getRole",
        { tabId: 1, selector: "#button" },
      );
    });
  });

  describe("Frame Management Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle listFrames", async () => {
      await handler.handle("listFrames", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "frames.list",
        { tabId: 1 },
      );
    });

    it("should handle executeScriptInFrame", async () => {
      await handler.handle(
        "executeScriptInFrame",
        { tabId: 1, frameId: 0, script: "return document.title" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "frames.executeScript",
        { tabId: 1, frameId: 0, script: "return document.title" },
      );
    });
  });

  // ==================== Phase 17: Advanced Debugging Tests ====================

  describe("WebSocket Debugging Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle enableWebSocketDebugging", async () => {
      await handler.handle("enableWebSocketDebugging", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.enable",
        { tabId: 1 },
      );
    });

    it("should handle disableWebSocketDebugging", async () => {
      await handler.handle("disableWebSocketDebugging", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.disable",
        { tabId: 1 },
      );
    });

    it("should handle getWebSocketConnections", async () => {
      await handler.handle("getWebSocketConnections", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.getConnections",
        { tabId: 1 },
      );
    });

    it("should handle getWebSocketMessages", async () => {
      await handler.handle(
        "getWebSocketMessages",
        { tabId: 1, connectionId: "conn-1" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.getMessages",
        { tabId: 1, connectionId: "conn-1" },
      );
    });

    it("should handle sendWebSocketMessage", async () => {
      await handler.handle(
        "sendWebSocketMessage",
        { tabId: 1, connectionId: "conn-1", data: "test message" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.send",
        { tabId: 1, connectionId: "conn-1", data: "test message" },
      );
    });

    it("should handle closeWebSocketConnection", async () => {
      await handler.handle(
        "closeWebSocketConnection",
        { tabId: 1, connectionId: "conn-1" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "websocket.close",
        { tabId: 1, connectionId: "conn-1" },
      );
    });
  });

  describe("Service Worker Management Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle listServiceWorkers", async () => {
      await handler.handle("listServiceWorkers", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "serviceWorker.list",
        {},
      );
    });

    it("should handle getServiceWorkerInfo", async () => {
      await handler.handle(
        "getServiceWorkerInfo",
        { registrationId: "reg-1" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "serviceWorker.getInfo",
        { registrationId: "reg-1" },
      );
    });

    it("should handle unregisterServiceWorker", async () => {
      await handler.handle(
        "unregisterServiceWorker",
        { tabId: 1, scopeUrl: "https://example.com/" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "serviceWorker.unregister",
        { tabId: 1, scopeUrl: "https://example.com/" },
      );
    });

    it("should handle updateServiceWorker", async () => {
      await handler.handle(
        "updateServiceWorker",
        { tabId: 1, scopeUrl: "https://example.com/" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "serviceWorker.update",
        { tabId: 1, scopeUrl: "https://example.com/" },
      );
    });

    it("should handle postMessageToServiceWorker", async () => {
      await handler.handle(
        "postMessageToServiceWorker",
        { tabId: 1, message: { type: "sync" } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "serviceWorker.postMessage",
        { tabId: 1, message: { type: "sync" } },
      );
    });
  });

  describe("Cache Storage Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle listCaches", async () => {
      await handler.handle("listCaches", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.listCaches",
        { tabId: 1 },
      );
    });

    it("should handle listCacheEntries", async () => {
      await handler.handle(
        "listCacheEntries",
        { tabId: 1, cacheName: "v1-cache" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.listEntries",
        { tabId: 1, cacheName: "v1-cache" },
      );
    });

    it("should handle getCacheEntry", async () => {
      await handler.handle(
        "getCacheEntry",
        {
          tabId: 1,
          cacheName: "v1-cache",
          url: "https://example.com/api/data",
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.getEntry",
        {
          tabId: 1,
          cacheName: "v1-cache",
          url: "https://example.com/api/data",
        },
      );
    });

    it("should handle deleteCacheEntry", async () => {
      await handler.handle(
        "deleteCacheEntry",
        { tabId: 1, cacheName: "v1-cache", url: "https://example.com/old" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.deleteEntry",
        { tabId: 1, cacheName: "v1-cache", url: "https://example.com/old" },
      );
    });

    it("should handle deleteCache", async () => {
      await handler.handle(
        "deleteCache",
        { tabId: 1, cacheName: "old-cache" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.deleteCache",
        { tabId: 1, cacheName: "old-cache" },
      );
    });

    it("should handle addCacheEntry", async () => {
      await handler.handle(
        "addCacheEntry",
        {
          tabId: 1,
          cacheName: "v1-cache",
          url: "https://example.com/new",
          response: { body: "test", status: 200 },
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "cache.addEntry",
        {
          tabId: 1,
          cacheName: "v1-cache",
          url: "https://example.com/new",
          response: { body: "test", status: 200 },
        },
      );
    });
  });

  describe("Security Info Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getCertificateInfo", async () => {
      await handler.handle("getCertificateInfo", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "security.getCertificate",
        { tabId: 1 },
      );
    });

    it("should handle getSecurityState", async () => {
      await handler.handle("getSecurityState", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "security.getSecurityState",
        { tabId: 1 },
      );
    });

    it("should handle checkMixedContent", async () => {
      await handler.handle("checkMixedContent", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "security.checkMixedContent",
        { tabId: 1 },
      );
    });

    it("should handle getSitePermissions", async () => {
      await handler.handle("getSitePermissions", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "security.getPermissions",
        { tabId: 1 },
      );
    });
  });

  describe("Animation Control Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle listAnimations", async () => {
      await handler.handle("listAnimations", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.list",
        { tabId: 1 },
      );
    });

    it("should handle pauseAnimation", async () => {
      await handler.handle(
        "pauseAnimation",
        { tabId: 1, animationId: "anim-0" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.pause",
        { tabId: 1, animationId: "anim-0" },
      );
    });

    it("should handle playAnimation", async () => {
      await handler.handle(
        "playAnimation",
        { tabId: 1, animationId: "anim-0" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.play",
        { tabId: 1, animationId: "anim-0" },
      );
    });

    it("should handle setAnimationSpeed", async () => {
      await handler.handle(
        "setAnimationSpeed",
        { tabId: 1, animationId: "anim-0", playbackRate: 0.5 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.setSpeed",
        { tabId: 1, animationId: "anim-0", playbackRate: 0.5 },
      );
    });

    it("should handle seekAnimation", async () => {
      await handler.handle(
        "seekAnimation",
        { tabId: 1, animationId: "anim-0", currentTime: 500 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.seekTo",
        { tabId: 1, animationId: "anim-0", currentTime: 500 },
      );
    });

    it("should handle cancelAnimation", async () => {
      await handler.handle(
        "cancelAnimation",
        { tabId: 1, animationId: "anim-0" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "animation.cancel",
        { tabId: 1, animationId: "anim-0" },
      );
    });
  });

  describe("Layout Inspection Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getBoxModel", async () => {
      await handler.handle(
        "getBoxModel",
        { tabId: 1, selector: "#container" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.getBoxModel",
        { tabId: 1, selector: "#container" },
      );
    });

    it("should handle getComputedLayout", async () => {
      await handler.handle(
        "getComputedLayout",
        { tabId: 1, selector: ".flex-item" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.getComputedLayout",
        { tabId: 1, selector: ".flex-item" },
      );
    });

    it("should handle highlightNode", async () => {
      await handler.handle(
        "highlightNode",
        {
          tabId: 1,
          selector: "#target",
          options: { backgroundColor: "rgba(255,0,0,0.3)" },
        },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.highlightNode",
        {
          tabId: 1,
          selector: "#target",
          options: { backgroundColor: "rgba(255,0,0,0.3)" },
        },
      );
    });

    it("should handle hideHighlight", async () => {
      await handler.handle("hideHighlight", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.hideHighlight",
        { tabId: 1 },
      );
    });

    it("should handle getNodeInfo", async () => {
      await handler.handle(
        "getNodeInfo",
        { tabId: 1, selector: "#element" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.getNodeInfo",
        { tabId: 1, selector: "#element" },
      );
    });

    it("should handle forceElementState", async () => {
      await handler.handle(
        "forceElementState",
        { tabId: 1, selector: "#button", state: ["hover", "focus"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "layout.forceElementState",
        { tabId: 1, selector: "#button", state: ["hover", "focus"] },
      );
    });
  });

  describe("Coverage Analysis Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle startJSCoverage", async () => {
      await handler.handle(
        "startJSCoverage",
        { tabId: 1, options: { callCount: true, detailed: true } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.startJSCoverage",
        { tabId: 1, options: { callCount: true, detailed: true } },
      );
    });

    it("should handle stopJSCoverage", async () => {
      await handler.handle("stopJSCoverage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.stopJSCoverage",
        { tabId: 1 },
      );
    });

    it("should handle startCSSCoverage", async () => {
      await handler.handle("startCSSCoverage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.startCSSCoverage",
        { tabId: 1 },
      );
    });

    it("should handle stopCSSCoverage", async () => {
      await handler.handle("stopCSSCoverage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.stopCSSCoverage",
        { tabId: 1 },
      );
    });

    it("should handle getJSCoverageResults", async () => {
      await handler.handle("getJSCoverageResults", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.getJSCoverage",
        { tabId: 1 },
      );
    });

    it("should handle getCSSCoverageResults", async () => {
      await handler.handle("getCSSCoverageResults", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "coverage.getCSSCoverage",
        { tabId: 1 },
      );
    });
  });

  describe("Memory Profiling Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getMemoryInfo", async () => {
      await handler.handle("getMemoryInfo", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "memory.getInfo",
        { tabId: 1 },
      );
    });

    it("should handle takeHeapSnapshot", async () => {
      await handler.handle("takeHeapSnapshot", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "memory.takeHeapSnapshot",
        { tabId: 1 },
      );
    });

    it("should handle startMemorySampling", async () => {
      await handler.handle(
        "startMemorySampling",
        { tabId: 1, options: { samplingInterval: 16384 } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "memory.startSampling",
        { tabId: 1, options: { samplingInterval: 16384 } },
      );
    });

    it("should handle stopMemorySampling", async () => {
      await handler.handle("stopMemorySampling", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "memory.stopSampling",
        { tabId: 1 },
      );
    });

    it("should handle forceGarbageCollection", async () => {
      await handler.handle("forceGarbageCollection", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "memory.forceGC",
        { tabId: 1 },
      );
    });
  });

  // ==================== Phase 18: DOM & Input Tools Tests ====================

  describe("DOM Mutation Observer Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle observeMutations", async () => {
      await handler.handle(
        "observeMutations",
        { tabId: 1, selector: "#container", options: { subtree: true } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "dom.observeMutations",
        { tabId: 1, selector: "#container", options: { subtree: true } },
      );
    });

    it("should handle stopObservingMutations", async () => {
      await handler.handle("stopObservingMutations", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "dom.stopObserving",
        { tabId: 1 },
      );
    });

    it("should handle getMutations", async () => {
      await handler.handle("getMutations", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "dom.getMutations",
        { tabId: 1 },
      );
    });

    it("should handle clearMutations", async () => {
      await handler.handle("clearMutations", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "dom.clearMutations",
        { tabId: 1 },
      );
    });
  });

  describe("Event Listener Inspector Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getEventListeners", async () => {
      await handler.handle(
        "getEventListeners",
        { tabId: 1, selector: "#button" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "events.getListeners",
        { tabId: 1, selector: "#button" },
      );
    });

    it("should handle removeEventListener", async () => {
      await handler.handle(
        "removeEventListener",
        { tabId: 1, selector: "#button", eventType: "click" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "events.removeListener",
        { tabId: 1, selector: "#button", eventType: "click" },
      );
    });

    it("should handle monitorEvents", async () => {
      await handler.handle(
        "monitorEvents",
        { tabId: 1, selector: "#form", eventTypes: ["submit", "change"] },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "events.monitorEvents",
        { tabId: 1, selector: "#form", eventTypes: ["submit", "change"] },
      );
    });

    it("should handle stopMonitoringEvents", async () => {
      await handler.handle("stopMonitoringEvents", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "events.stopMonitoring",
        { tabId: 1 },
      );
    });

    it("should handle getEventLog", async () => {
      await handler.handle("getEventLog", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "events.getLog",
        { tabId: 1 },
      );
    });
  });

  describe("Input Recording Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle startInputRecording", async () => {
      await handler.handle(
        "startInputRecording",
        { tabId: 1, options: { eventTypes: ["click", "keydown"] } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "input.startRecording",
        { tabId: 1, options: { eventTypes: ["click", "keydown"] } },
      );
    });

    it("should handle stopInputRecording", async () => {
      await handler.handle("stopInputRecording", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "input.stopRecording",
        { tabId: 1 },
      );
    });

    it("should handle getInputRecording", async () => {
      await handler.handle("getInputRecording", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "input.getRecording",
        { tabId: 1 },
      );
    });

    it("should handle replayInputs", async () => {
      const recording = { events: [{ type: "click", timestamp: 100 }] };
      await handler.handle(
        "replayInputs",
        { tabId: 1, recording, options: { speed: 2 } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "input.replay",
        { tabId: 1, recording, options: { speed: 2 } },
      );
    });

    it("should handle clearInputRecording", async () => {
      await handler.handle("clearInputRecording", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "input.clearRecording",
        { tabId: 1 },
      );
    });
  });

  describe("Media Emulation Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle emulateColorScheme", async () => {
      await handler.handle(
        "emulateColorScheme",
        { tabId: 1, scheme: "dark" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "media.emulateColorScheme",
        { tabId: 1, scheme: "dark" },
      );
    });

    it("should handle emulateReducedMotion", async () => {
      await handler.handle(
        "emulateReducedMotion",
        { tabId: 1, reduce: true },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "media.emulateReducedMotion",
        { tabId: 1, reduce: true },
      );
    });

    it("should handle emulateForcedColors", async () => {
      await handler.handle(
        "emulateForcedColors",
        { tabId: 1, forced: true },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "media.emulateForcedColors",
        { tabId: 1, forced: true },
      );
    });

    it("should handle emulateVisionDeficiency", async () => {
      await handler.handle(
        "emulateVisionDeficiency",
        { tabId: 1, type: "deuteranopia" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "media.emulateVisionDeficiency",
        { tabId: 1, type: "deuteranopia" },
      );
    });

    it("should handle clearMediaEmulation", async () => {
      await handler.handle("clearMediaEmulation", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "media.clearEmulation",
        { tabId: 1 },
      );
    });
  });

  describe("Page Lifecycle Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getPageLifecycleState", async () => {
      await handler.handle("getPageLifecycleState", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "lifecycle.getState",
        { tabId: 1 },
      );
    });

    it("should handle subscribeLifecycleChanges", async () => {
      await handler.handle("subscribeLifecycleChanges", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "lifecycle.onStateChange",
        { tabId: 1 },
      );
    });

    it("should handle freezePage", async () => {
      await handler.handle("freezePage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "lifecycle.freeze",
        { tabId: 1 },
      );
    });

    it("should handle resumePage", async () => {
      await handler.handle("resumePage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "lifecycle.resume",
        { tabId: 1 },
      );
    });
  });

  describe("Font Inspector Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getUsedFonts", async () => {
      await handler.handle("getUsedFonts", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "fonts.getUsed",
        { tabId: 1 },
      );
    });

    it("should handle getComputedFonts", async () => {
      await handler.handle(
        "getComputedFonts",
        { tabId: 1, selector: "h1" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "fonts.getComputed",
        { tabId: 1, selector: "h1" },
      );
    });

    it("should handle checkFontAvailability", async () => {
      await handler.handle(
        "checkFontAvailability",
        { tabId: 1, fontFamily: "Arial" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "fonts.checkAvailability",
        { tabId: 1, fontFamily: "Arial" },
      );
    });
  });

  describe("Measurement Tools Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle measureDistance", async () => {
      await handler.handle(
        "measureDistance",
        { tabId: 1, from: "#element1", to: "#element2" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "measure.getDistance",
        { tabId: 1, from: "#element1", to: "#element2" },
      );
    });

    it("should handle measureElementSize", async () => {
      await handler.handle(
        "measureElementSize",
        { tabId: 1, selector: "#container" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "measure.getElementSize",
        { tabId: 1, selector: "#container" },
      );
    });

    it("should handle enableRuler", async () => {
      await handler.handle("enableRuler", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "measure.enableRuler",
        { tabId: 1 },
      );
    });

    it("should handle disableRuler", async () => {
      await handler.handle("disableRuler", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "measure.disableRuler",
        { tabId: 1 },
      );
    });
  });

  describe("Color Picker Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle pickColorFromPoint", async () => {
      await handler.handle(
        "pickColorFromPoint",
        { tabId: 1, x: 100, y: 200 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "color.pickFromPoint",
        { tabId: 1, x: 100, y: 200 },
      );
    });

    it("should handle getElementColors", async () => {
      await handler.handle(
        "getElementColors",
        { tabId: 1, selector: ".button" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "color.getElementColors",
        { tabId: 1, selector: ".button" },
      );
    });

    it("should handle enableColorPicker", async () => {
      await handler.handle("enableColorPicker", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "color.enablePicker",
        { tabId: 1 },
      );
    });

    it("should handle disableColorPicker", async () => {
      await handler.handle("disableColorPicker", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "color.disablePicker",
        { tabId: 1 },
      );
    });
  });

  describe("Enhanced Storage Inspector Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", {
        ws: { readyState: 1 },
      });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getStorageQuota", async () => {
      await handler.handle("getStorageQuota", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.getQuota",
        { tabId: 1 },
      );
    });

    it("should handle getStorageUsage", async () => {
      await handler.handle("getStorageUsage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.getUsage",
        { tabId: 1 },
      );
    });

    it("should handle exportAllStorage", async () => {
      await handler.handle("exportAllStorage", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.exportAll",
        { tabId: 1 },
      );
    });

    it("should handle importAllStorage", async () => {
      const data = { localStorage: { key: "value" }, sessionStorage: {} };
      await handler.handle("importAllStorage", { tabId: 1, data }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "storage.importAll",
        { tabId: 1, data },
      );
    });
  });

  // ==================== Phase 19: Network & Device Emulation Tests ====================

  describe("Network Throttling Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle setNetworkThrottling", async () => {
      await handler.handle(
        "setNetworkThrottling",
        { tabId: 1, conditions: "slow-3g" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.setThrottling",
        { tabId: 1, conditions: "slow-3g" },
      );
    });

    it("should handle clearNetworkThrottling", async () => {
      await handler.handle("clearNetworkThrottling", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.clearThrottling",
        { tabId: 1 },
      );
    });

    it("should handle getThrottlingProfiles", async () => {
      await handler.handle("getThrottlingProfiles", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.getThrottlingProfiles",
        {},
      );
    });

    it("should handle setOfflineMode", async () => {
      await handler.handle("setOfflineMode", { tabId: 1, offline: true }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "network.setOffline",
        { tabId: 1, offline: true },
      );
    });
  });

  describe("Device Emulation Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle setUserAgent", async () => {
      await handler.handle(
        "setUserAgent",
        { tabId: 1, userAgent: "CustomAgent/1.0", platform: "Linux" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.setUserAgent",
        { tabId: 1, userAgent: "CustomAgent/1.0", platform: "Linux" },
      );
    });

    it("should handle getUserAgent", async () => {
      await handler.handle("getUserAgent", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.getUserAgent",
        { tabId: 1 },
      );
    });

    it("should handle setTimezone", async () => {
      await handler.handle(
        "setTimezone",
        { tabId: 1, timezoneId: "America/New_York" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.setTimezone",
        { tabId: 1, timezoneId: "America/New_York" },
      );
    });

    it("should handle setLocale", async () => {
      await handler.handle("setLocale", { tabId: 1, locale: "zh-CN" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.setLocale",
        { tabId: 1, locale: "zh-CN" },
      );
    });

    it("should handle setGeolocationOverride", async () => {
      await handler.handle(
        "setGeolocationOverride",
        { tabId: 1, latitude: 37.7749, longitude: -122.4194, accuracy: 100 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.setGeolocation",
        { tabId: 1, latitude: 37.7749, longitude: -122.4194, accuracy: 100 },
      );
    });

    it("should handle clearGeolocationOverride", async () => {
      await handler.handle("clearGeolocationOverride", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "device.clearGeolocation",
        { tabId: 1 },
      );
    });
  });

  describe("Touch Emulation Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle enableTouchEmulation", async () => {
      await handler.handle(
        "enableTouchEmulation",
        { tabId: 1, options: { maxTouchPoints: 10 } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "touch.enable",
        { tabId: 1, options: { maxTouchPoints: 10 } },
      );
    });

    it("should handle disableTouchEmulation", async () => {
      await handler.handle("disableTouchEmulation", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "touch.disable",
        { tabId: 1 },
      );
    });

    it("should handle emulateTap", async () => {
      await handler.handle("emulateTap", { tabId: 1, x: 100, y: 200 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "touch.tap",
        { tabId: 1, x: 100, y: 200 },
      );
    });

    it("should handle emulateSwipe", async () => {
      await handler.handle(
        "emulateSwipe",
        { tabId: 1, startX: 100, startY: 200, endX: 300, endY: 200 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "touch.swipe",
        { tabId: 1, startX: 100, startY: 200, endX: 300, endY: 200 },
      );
    });

    it("should handle emulatePinch", async () => {
      await handler.handle(
        "emulatePinch",
        { tabId: 1, x: 200, y: 300, scale: 2 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "touch.pinch",
        { tabId: 1, x: 200, y: 300, scale: 2 },
      );
    });
  });

  describe("Sensor Emulation Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle setSensorOrientation", async () => {
      await handler.handle(
        "setSensorOrientation",
        { tabId: 1, alpha: 45, beta: 30, gamma: 15 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "sensor.setOrientation",
        { tabId: 1, alpha: 45, beta: 30, gamma: 15 },
      );
    });

    it("should handle setAccelerometer", async () => {
      await handler.handle(
        "setAccelerometer",
        { tabId: 1, x: 0, y: 9.8, z: 0 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "sensor.setAccelerometer",
        { tabId: 1, x: 0, y: 9.8, z: 0 },
      );
    });

    it("should handle setAmbientLight", async () => {
      await handler.handle(
        "setAmbientLight",
        { tabId: 1, illuminance: 500 },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "sensor.setAmbientLight",
        { tabId: 1, illuminance: 500 },
      );
    });

    it("should handle clearSensorOverrides", async () => {
      await handler.handle("clearSensorOverrides", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "sensor.clearOverrides",
        { tabId: 1 },
      );
    });
  });

  describe("Viewport Management Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle setViewport", async () => {
      await handler.handle(
        "setViewport",
        { tabId: 1, width: 1920, height: 1080, options: { mobile: false } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "viewport.set",
        { tabId: 1, width: 1920, height: 1080, options: { mobile: false } },
      );
    });

    it("should handle getViewport", async () => {
      await handler.handle("getViewport", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "viewport.get",
        { tabId: 1 },
      );
    });

    it("should handle setDeviceMetrics", async () => {
      await handler.handle("setDeviceMetrics", { tabId: 1, metrics: "iphone-12" }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "viewport.setDeviceMetrics",
        { tabId: 1, metrics: "iphone-12" },
      );
    });

    it("should handle clearDeviceMetrics", async () => {
      await handler.handle("clearDeviceMetrics", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "viewport.clearDeviceMetrics",
        { tabId: 1 },
      );
    });

    it("should handle getViewportPresets", async () => {
      await handler.handle("getViewportPresets", {}, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "viewport.getPresets",
        {},
      );
    });
  });

  describe("Screenshot Comparison Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle captureScreenshot", async () => {
      await handler.handle(
        "captureScreenshot",
        { tabId: 1, options: { format: "png" } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "screenshot.capture",
        { tabId: 1, options: { format: "png" } },
      );
    });

    it("should handle captureElementScreenshot", async () => {
      await handler.handle(
        "captureElementScreenshot",
        { tabId: 1, selector: "#header" },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "screenshot.captureElement",
        { tabId: 1, selector: "#header" },
      );
    });

    it("should handle compareScreenshots", async () => {
      await handler.handle(
        "compareScreenshots",
        { baseline: "base64...", current: "base64...", options: { threshold: 10 } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "screenshot.compare",
        { baseline: "base64...", current: "base64...", options: { threshold: 10 } },
      );
    });

    it("should handle captureFullPageScreenshot", async () => {
      await handler.handle("captureFullPageScreenshot", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "screenshot.captureFullPage",
        { tabId: 1 },
      );
    });
  });

  describe("Clipboard Advanced Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle readRichClipboard", async () => {
      await handler.handle("readRichClipboard", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.readRich",
        { tabId: 1 },
      );
    });

    it("should handle writeRichClipboard", async () => {
      await handler.handle(
        "writeRichClipboard",
        { tabId: 1, data: { text: "hello", html: "<b>hello</b>" } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.writeRich",
        { tabId: 1, data: { text: "hello", html: "<b>hello</b>" } },
      );
    });

    it("should handle getClipboardFormats", async () => {
      await handler.handle("getClipboardFormats", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.getFormats",
        { tabId: 1 },
      );
    });

    it("should handle writeImageToClipboard", async () => {
      await handler.handle(
        "writeImageToClipboard",
        { tabId: 1, imageData: "base64..." },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "clipboard.writeImage",
        { tabId: 1, imageData: "base64..." },
      );
    });
  });

  describe("Print/PDF Operations", () => {
    beforeEach(() => {
      server.clients.set("client-1", { ws: { readyState: 1 } });
      vi.spyOn(server, "sendCommand").mockResolvedValue({ success: true });
    });

    it("should handle getPrintPreview", async () => {
      await handler.handle("getPrintPreview", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "print.preview",
        { tabId: 1 },
      );
    });

    it("should handle printToPDF", async () => {
      await handler.handle(
        "printToPDF",
        { tabId: 1, options: { landscape: true, printBackground: true } },
        {},
      );
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "print.toPDF",
        { tabId: 1, options: { landscape: true, printBackground: true } },
      );
    });

    it("should handle getPrintSettings", async () => {
      await handler.handle("getPrintSettings", { tabId: 1 }, {});
      expect(server.sendCommand).toHaveBeenCalledWith(
        "client-1",
        "print.getSettings",
        { tabId: 1 },
      );
    });
  });
});
