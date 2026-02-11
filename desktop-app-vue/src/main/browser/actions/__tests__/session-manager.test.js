/**
 * SessionManager 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  SessionManager,
  SameSitePolicy,
  StorageType,
  SessionState,
  getSessionManager,
} = require("../session-manager");

// Create mock page and context
const createMockPage = () => {
  const mockContext = {
    cookies: vi.fn().mockResolvedValue([
      { name: "session", value: "abc123", domain: "example.com", path: "/" },
      { name: "token", value: "xyz789", domain: "example.com", path: "/" },
    ]),
    addCookies: vi.fn().mockResolvedValue(undefined),
    clearCookies: vi.fn().mockResolvedValue(undefined),
  };

  return {
    context: vi.fn().mockReturnValue(mockContext),
    url: vi.fn().mockReturnValue("https://example.com/dashboard"),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation((fn, args) => {
      // Simulate localStorage/sessionStorage operations
      if (typeof fn === "function") {
        // Return mock data based on function call
        return Promise.resolve({
          localStorage: { user: "john", theme: "dark" },
          sessionStorage: { cart: "items" },
        });
      }
      return Promise.resolve({});
    }),
  };
};

const createMockEngine = () => ({
  getPage: vi.fn().mockReturnValue(createMockPage()),
});

describe("SessionManager", () => {
  let manager;
  let mockEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEngine = createMockEngine();
    manager = new SessionManager(mockEngine, {
      enablePersistence: true,
    });
  });

  afterEach(() => {
    manager.cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      expect(manager.config.enablePersistence).toBe(true);
      expect(manager.config.trackAuthState).toBe(true);
    });

    it("should work without engine", () => {
      const m = new SessionManager(null);
      expect(m.browserEngine).toBeNull();
      m.cleanup();
    });
  });

  describe("getCookies", () => {
    it("should get all cookies", async () => {
      const result = await manager.getCookies("tab1");

      expect(result.success).toBe(true);
      expect(result.cookies).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("should filter by domain", async () => {
      const result = await manager.getCookies("tab1", { domain: "example" });

      expect(result.success).toBe(true);
    });

    it("should fail without engine", async () => {
      const m = new SessionManager(null);
      const result = await m.getCookies("tab1");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Browser engine not set");
      m.cleanup();
    });

    it("should fail for unknown page", async () => {
      mockEngine.getPage.mockReturnValueOnce(null);
      const result = await manager.getCookies("unknown");

      expect(result.success).toBe(false);
    });
  });

  describe("setCookie", () => {
    it("should set a cookie", async () => {
      const result = await manager.setCookie("tab1", {
        name: "test",
        value: "value",
        domain: "example.com",
      });

      expect(result.success).toBe(true);
      expect(result.cookie.name).toBe("test");
    });

    it("should fail without engine", async () => {
      const m = new SessionManager(null);
      const result = await m.setCookie("tab1", { name: "test", value: "val" });

      expect(result.success).toBe(false);
      m.cleanup();
    });
  });

  describe("clearAllCookies", () => {
    it("should clear all cookies", async () => {
      const result = await manager.clearAllCookies("tab1");

      expect(result.success).toBe(true);
    });
  });

  describe("getLocalStorage", () => {
    it("should get localStorage data", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({ user: "john", theme: "dark" });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.getLocalStorage("tab1");

      expect(result.success).toBe(true);
      expect(result.type).toBe("localStorage");
    });

    it("should get specific key", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({ user: "john" });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.getLocalStorage("tab1", "user");

      expect(result.success).toBe(true);
    });
  });

  describe("setLocalStorage", () => {
    it("should set localStorage value", async () => {
      const result = await manager.setLocalStorage("tab1", "key", "value");

      expect(result.success).toBe(true);
      expect(result.key).toBe("key");
    });
  });

  describe("removeLocalStorage", () => {
    it("should remove localStorage item", async () => {
      const result = await manager.removeLocalStorage("tab1", "key");

      expect(result.success).toBe(true);
    });

    it("should clear all localStorage when no key", async () => {
      const result = await manager.removeLocalStorage("tab1");

      expect(result.success).toBe(true);
    });
  });

  describe("getSessionStorage", () => {
    it("should get sessionStorage data", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({ cart: "items" });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.getSessionStorage("tab1");

      expect(result.success).toBe(true);
      expect(result.type).toBe("sessionStorage");
    });
  });

  describe("setSessionStorage", () => {
    it("should set sessionStorage value", async () => {
      const result = await manager.setSessionStorage("tab1", "key", "value");

      expect(result.success).toBe(true);
    });
  });

  describe("saveSession", () => {
    it("should save session snapshot", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        localStorage: { user: "john" },
        sessionStorage: { cart: "items" },
      });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.saveSession("tab1");

      expect(result.success).toBe(true);
      expect(result.sessionId).toBeDefined();
    });

    it("should use custom session ID", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        localStorage: {},
        sessionStorage: {},
      });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.saveSession("tab1", "my-session");

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe("my-session");
    });

    it("should fail without engine", async () => {
      const m = new SessionManager(null);
      const result = await m.saveSession("tab1");

      expect(result.success).toBe(false);
      m.cleanup();
    });
  });

  describe("restoreSession", () => {
    it("should restore saved session", async () => {
      // First save a session
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        localStorage: { user: "john" },
        sessionStorage: {},
      });
      mockEngine.getPage.mockReturnValue(mockPage);

      const saveResult = await manager.saveSession("tab1", "test-session");
      expect(saveResult.success).toBe(true);

      // Then restore it
      const result = await manager.restoreSession("tab1", "test-session");

      expect(result.success).toBe(true);
    });

    it("should fail for unknown session", async () => {
      const result = await manager.restoreSession("tab1", "unknown");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("deleteSession", () => {
    it("should delete session", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        localStorage: {},
        sessionStorage: {},
      });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      await manager.saveSession("tab1", "to-delete");

      const result = manager.deleteSession("to-delete");

      expect(result.success).toBe(true);
    });

    it("should fail for unknown session", () => {
      const result = manager.deleteSession("unknown");

      expect(result.success).toBe(false);
    });
  });

  describe("listSessions", () => {
    it("should list all sessions", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValue({
        localStorage: {},
        sessionStorage: {},
      });
      mockEngine.getPage.mockReturnValue(mockPage);

      await manager.saveSession("tab1", "session1");
      await manager.saveSession("tab1", "session2");

      const sessions = manager.listSessions();

      expect(sessions.length).toBe(2);
    });
  });

  describe("detectAuthState", () => {
    it("should detect authenticated state", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        hasLogout: true,
        hasLoginForm: false,
        hasUserElement: true,
      });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.detectAuthState("tab1");

      expect(result.success).toBe(true);
      expect(result.state).toBe(SessionState.ACTIVE);
    });

    it("should detect expired state", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValueOnce({
        hasLogout: false,
        hasLoginForm: true,
        hasUserElement: false,
      });
      mockEngine.getPage.mockReturnValueOnce(mockPage);

      const result = await manager.detectAuthState("tab1");

      expect(result.success).toBe(true);
      expect(result.state).toBe(SessionState.EXPIRED);
    });
  });

  describe("getAuthState", () => {
    it("should return unknown for untracked page", () => {
      const state = manager.getAuthState("untracked");

      expect(state.state).toBe(SessionState.UNKNOWN);
    });
  });

  describe("getStats", () => {
    it("should return statistics", () => {
      const stats = manager.getStats();

      expect(stats.totalSessions).toBeDefined();
      expect(stats.sessionCount).toBeDefined();
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", () => {
      manager.stats.cookiesManaged = 10;
      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.cookiesManaged).toBe(0);
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("should cleanup old sessions", async () => {
      const mockPage = createMockPage();
      mockPage.evaluate.mockResolvedValue({
        localStorage: {},
        sessionStorage: {},
      });
      mockEngine.getPage.mockReturnValue(mockPage);

      await manager.saveSession("tab1", "old-session");

      // Manually set old timestamp
      const session = manager.sessions.get("old-session");
      if (session) {
        session.timestamp = Date.now() - 100000000;
      }

      const result = manager.cleanupExpiredSessions(1000);

      expect(result.success).toBe(true);
    });
  });

  describe("SameSitePolicy constants", () => {
    it("should have all policies defined", () => {
      expect(SameSitePolicy.STRICT).toBe("Strict");
      expect(SameSitePolicy.LAX).toBe("Lax");
      expect(SameSitePolicy.NONE).toBe("None");
    });
  });

  describe("StorageType constants", () => {
    it("should have all types defined", () => {
      expect(StorageType.COOKIE).toBe("cookie");
      expect(StorageType.LOCAL_STORAGE).toBe("localStorage");
      expect(StorageType.SESSION_STORAGE).toBe("sessionStorage");
    });
  });

  describe("SessionState constants", () => {
    it("should have all states defined", () => {
      expect(SessionState.ACTIVE).toBe("active");
      expect(SessionState.EXPIRED).toBe("expired");
      expect(SessionState.INVALID).toBe("invalid");
      expect(SessionState.UNKNOWN).toBe("unknown");
    });
  });

  describe("getSessionManager singleton", () => {
    it("should return singleton instance", () => {
      const m1 = getSessionManager(mockEngine);
      const m2 = getSessionManager();

      expect(m1).toBe(m2);
    });
  });
});
