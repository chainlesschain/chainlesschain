/**
 * ClipboardManager 单元测试
 */

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  ClipboardManager,
  ClipboardType,
  getClipboardManager,
} = require("../clipboard-manager");

// Create mock electron modules for testing
const createMockElectronModules = () => ({
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn().mockReturnValue("test content"),
    write: vi.fn(),
    readHTML: vi.fn().mockReturnValue("<p>test</p>"),
    readRTF: vi.fn().mockReturnValue(""),
    writeImage: vi.fn(),
    readImage: vi.fn().mockReturnValue({
      isEmpty: vi.fn().mockReturnValue(false),
      toDataURL: vi.fn().mockReturnValue("data:image/png;base64,test"),
      getSize: vi.fn().mockReturnValue({ width: 100, height: 100 }),
    }),
    clear: vi.fn(),
    availableFormats: vi.fn().mockReturnValue(["text/plain", "text/html"]),
  },
  nativeImage: {
    createFromBuffer: vi.fn().mockReturnValue({
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 100, height: 100 }),
    }),
  },
});

describe("ClipboardManager", () => {
  let manager;
  let mockEngine;
  let mockPage;
  let mockElectronModules;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ type: "text", content: "test content" }),
      keyboard: {
        down: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
      },
    };

    mockEngine = {
      getPage: vi.fn().mockReturnValue(mockPage),
    };

    mockElectronModules = createMockElectronModules();

    manager = new ClipboardManager(
      mockEngine,
      {
        enableHistory: true,
        filterSensitive: true,
      },
      { electronModules: mockElectronModules },
    );
  });

  afterEach(() => {
    manager.cleanup();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      expect(manager.config.enableHistory).toBe(true);
      expect(manager.config.filterSensitive).toBe(true);
    });

    it("should work without engine", () => {
      const m = new ClipboardManager(
        null,
        {},
        { electronModules: createMockElectronModules() },
      );
      expect(m.browserEngine).toBeNull();
      m.cleanup();
    });
  });

  describe("copyText", () => {
    it("should copy text to clipboard", () => {
      const result = manager.copyText("Hello World");

      expect(result.success).toBe(true);
      expect(result.type).toBe(ClipboardType.TEXT);
    });

    it("should record in history", () => {
      manager.copyText("Test");

      const history = manager.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].content).toBe("Test");
    });

    it("should block sensitive content", () => {
      const result = manager.copyText("password: secret123");

      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
    });

    it("should allow sensitive with forceCopy", () => {
      const result = manager.copyText("password: secret123", {
        forceCopy: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("copyHTML", () => {
    it("should copy HTML to clipboard", () => {
      const result = manager.copyHTML("<p>Hello</p>", "Hello");

      expect(result.success).toBe(true);
      expect(result.type).toBe(ClipboardType.HTML);
    });
  });

  describe("copyImage", () => {
    it("should copy image from base64", () => {
      const result = manager.copyImage("data:image/png;base64,iVBORw0KGgo=");

      expect(result.success).toBe(true);
      expect(result.type).toBe(ClipboardType.IMAGE);
    });

    it("should copy image from buffer", () => {
      const buffer = Buffer.from("test image data");
      const result = manager.copyImage(buffer);

      expect(result.success).toBe(true);
    });
  });

  describe("copyFromElement", () => {
    it("should copy from page element", async () => {
      const result = await manager.copyFromElement("tab1", "#content");

      expect(result.success).toBe(true);
    });

    it("should fail without engine", async () => {
      const m = new ClipboardManager(
        null,
        {},
        { electronModules: createMockElectronModules() },
      );
      const result = await m.copyFromElement("tab1", "#content");

      expect(result.success).toBe(false);
      m.cleanup();
    });

    it("should fail when element not found", async () => {
      mockPage.evaluate.mockResolvedValueOnce(null);

      const result = await manager.copyFromElement("tab1", "#nonexistent");

      expect(result.success).toBe(false);
    });
  });

  describe("read", () => {
    it("should read text from clipboard", () => {
      const result = manager.read(ClipboardType.TEXT);

      expect(result.success).toBe(true);
      expect(result.type).toBe(ClipboardType.TEXT);
      expect(result.content).toBe("test content");
    });

    it("should read HTML from clipboard", () => {
      const result = manager.read(ClipboardType.HTML);

      expect(result.success).toBe(true);
      expect(result.type).toBe(ClipboardType.HTML);
    });

    it("should auto-detect format when type not specified", () => {
      const result = manager.read();

      expect(result.success).toBe(true);
    });
  });

  describe("pasteToElement", () => {
    it("should paste to page element", async () => {
      const result = await manager.pasteToElement("tab1", "#input");

      expect(result.success).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it("should fail without engine", async () => {
      const m = new ClipboardManager(
        null,
        {},
        { electronModules: createMockElectronModules() },
      );
      const result = await m.pasteToElement("tab1", "#input");

      expect(result.success).toBe(false);
      m.cleanup();
    });
  });

  describe("simulatePaste", () => {
    it("should simulate keyboard paste", async () => {
      const result = await manager.simulatePaste("tab1");

      expect(result.success).toBe(true);
      expect(mockPage.keyboard.down).toHaveBeenCalledWith("Control");
      expect(mockPage.keyboard.press).toHaveBeenCalledWith("v");
    });
  });

  describe("clear", () => {
    it("should clear clipboard", () => {
      const result = manager.clear();

      expect(result.success).toBe(true);
    });
  });

  describe("getFormats", () => {
    it("should return available formats", () => {
      const formats = manager.getFormats();

      expect(Array.isArray(formats)).toBe(true);
    });
  });

  describe("getHistory", () => {
    it("should return clipboard history", () => {
      manager.copyText("First");
      manager.copyText("Second");

      const history = manager.getHistory();

      expect(history.length).toBe(2);
      expect(history[0].content).toBe("Second");
    });

    it("should limit by parameter", () => {
      for (let i = 0; i < 10; i++) {
        manager.copyText(`Item ${i}`);
      }

      const history = manager.getHistory(3);
      expect(history.length).toBe(3);
    });
  });

  describe("restoreFromHistory", () => {
    it("should restore from history", () => {
      manager.copyText("Old content");
      manager.copyText("New content");

      const result = manager.restoreFromHistory(1);

      expect(result.success).toBe(true);
    });

    it("should fail for invalid index", () => {
      const result = manager.restoreFromHistory(999);

      expect(result.success).toBe(false);
    });
  });

  describe("clearHistory", () => {
    it("should clear history", () => {
      manager.copyText("Test");
      manager.clearHistory();

      expect(manager.getHistory().length).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return statistics", () => {
      manager.copyText("Test");

      const stats = manager.getStats();

      expect(stats.totalCopies).toBe(1);
    });
  });

  describe("resetStats", () => {
    it("should reset statistics", () => {
      manager.copyText("Test");
      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.totalCopies).toBe(0);
    });
  });

  describe("ClipboardType constants", () => {
    it("should have all types defined", () => {
      expect(ClipboardType.TEXT).toBe("text");
      expect(ClipboardType.HTML).toBe("html");
      expect(ClipboardType.IMAGE).toBe("image");
      expect(ClipboardType.RTF).toBe("rtf");
      expect(ClipboardType.FILES).toBe("files");
    });
  });

  describe("getClipboardManager singleton", () => {
    it("should return singleton instance", () => {
      const m1 = getClipboardManager(mockEngine);
      const m2 = getClipboardManager();

      expect(m1).toBe(m2);
    });
  });
});
