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
});
