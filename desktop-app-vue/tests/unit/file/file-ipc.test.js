/**
 * File Management IPC 单元测试
 * 测试17个文件管理 API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";

describe("File Management IPC", () => {
  let handlers = {};
  let mockDatabase;
  let mockMainWindow;
  let mockGetProjectConfig;
  let mockIpcMain;
  let mockDialog;
  let mockShell;
  let mockClipboard;
  let registerFileIPC;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};

    // 创建 mock ipcMain
    mockIpcMain = {
      handle: (channel, handler) => {
        handlers[channel] = handler;
      },
    };

    // 创建 mock dialog
    mockDialog = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ["/path/to/program"],
      }),
    };

    // 创建 mock shell
    mockShell = {
      showItemInFolder: vi.fn(),
      openPath: vi.fn().mockResolvedValue(""),
    };

    // 创建 mock clipboard
    mockClipboard = {
      writeBuffer: vi.fn(),
      writeText: vi.fn(),
      readText: vi.fn().mockReturnValue(""),
      readBuffer: vi.fn().mockReturnValue(Buffer.alloc(0)),
      clear: vi.fn(),
    };

    // Mock database
    mockDatabase = {
      db: {
        prepare: vi.fn(() => ({
          get: vi.fn(() => ({
            root_path: "/test/project/root",
          })),
          run: vi.fn(),
        })),
      },
    };

    // Mock main window
    mockMainWindow = {
      webContents: {
        send: vi.fn(),
      },
      isDestroyed: vi.fn(() => false),
    };

    // Mock getProjectConfig
    mockGetProjectConfig = vi.fn(() => ({
      resolveProjectPath: vi.fn((filePath) => `/test/resolved/${filePath}`),
      getProjectsRootPath: vi.fn(() => "/test/projects"),
    }));

    // 动态导入
    const module = await import("../../../src/main/file/file-ipc.js");
    registerFileIPC = module.registerFileIPC;

    // 注册 File IPC 并注入 mock 对象
    registerFileIPC({
      database: mockDatabase,
      mainWindow: mockMainWindow,
      getProjectConfig: mockGetProjectConfig,
      ipcMain: mockIpcMain,
      dialog: mockDialog,
      shell: mockShell,
      clipboard: mockClipboard,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("基本功能测试", () => {
    it("should register all 17 IPC handlers", () => {
      expect(Object.keys(handlers).length).toBeGreaterThanOrEqual(17);
    });

    it("should have file read/write handlers", () => {
      expect(handlers["file:read-content"]).toBeDefined();
      expect(handlers["file:write-content"]).toBeDefined();
      expect(handlers["file:read-binary"]).toBeDefined();
    });

    it("should have file management handlers", () => {
      expect(handlers["file:revealInExplorer"]).toBeDefined();
      expect(handlers["file:copyItem"]).toBeDefined();
      expect(handlers["file:moveItem"]).toBeDefined();
      expect(handlers["file:deleteItem"]).toBeDefined();
      expect(handlers["file:renameItem"]).toBeDefined();
      expect(handlers["file:createFile"]).toBeDefined();
      expect(handlers["file:createFolder"]).toBeDefined();
      expect(handlers["file:openWithDefault"]).toBeDefined();
    });

    it("should have clipboard handlers", () => {
      expect(handlers["file:copyToSystemClipboard"]).toBeDefined();
      expect(handlers["file:cutToSystemClipboard"]).toBeDefined();
      expect(handlers["file:pasteFromSystemClipboard"]).toBeDefined();
      expect(handlers["file:importFromSystemClipboard"]).toBeDefined();
    });

    it("should have extended operation handlers", () => {
      expect(handlers["file:openWith"]).toBeDefined();
      expect(handlers["file:openWithProgram"]).toBeDefined();
    });
  });

  describe("文件读写操作", () => {
    it("should handle read-content", async () => {
      // Mock fs module dynamically
      vi.doMock("fs", () => ({
        promises: {
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue("Hello, World!"),
        },
      }));

      // This test validates the handler is registered
      expect(handlers["file:read-content"]).toBeDefined();
      expect(typeof handlers["file:read-content"]).toBe("function");
    });

    it("should handle write-content", async () => {
      expect(handlers["file:write-content"]).toBeDefined();
      expect(typeof handlers["file:write-content"]).toBe("function");
    });

    it("should handle read-binary", async () => {
      expect(handlers["file:read-binary"]).toBeDefined();
      expect(typeof handlers["file:read-binary"]).toBe("function");
    });
  });

  describe("文件管理操作", () => {
    it("should handle revealInExplorer", async () => {
      expect(handlers["file:revealInExplorer"]).toBeDefined();
      expect(typeof handlers["file:revealInExplorer"]).toBe("function");
    });

    it("should handle copyItem", async () => {
      expect(handlers["file:copyItem"]).toBeDefined();
      expect(typeof handlers["file:copyItem"]).toBe("function");
    });

    it("should handle moveItem", async () => {
      expect(handlers["file:moveItem"]).toBeDefined();
      expect(typeof handlers["file:moveItem"]).toBe("function");
    });

    it("should handle deleteItem", async () => {
      expect(handlers["file:deleteItem"]).toBeDefined();
      expect(typeof handlers["file:deleteItem"]).toBe("function");
    });

    it("should handle renameItem", async () => {
      expect(handlers["file:renameItem"]).toBeDefined();
      expect(typeof handlers["file:renameItem"]).toBe("function");
    });

    it("should handle createFile", async () => {
      expect(handlers["file:createFile"]).toBeDefined();
      expect(typeof handlers["file:createFile"]).toBe("function");
    });

    it("should handle createFolder", async () => {
      expect(handlers["file:createFolder"]).toBeDefined();
      expect(typeof handlers["file:createFolder"]).toBe("function");
    });

    it("should handle openWithDefault", async () => {
      expect(handlers["file:openWithDefault"]).toBeDefined();
      expect(typeof handlers["file:openWithDefault"]).toBe("function");
    });
  });

  describe("系统剪贴板操作", () => {
    it("should handle copyToSystemClipboard", async () => {
      expect(handlers["file:copyToSystemClipboard"]).toBeDefined();
      expect(typeof handlers["file:copyToSystemClipboard"]).toBe("function");
    });

    it("should handle cutToSystemClipboard", async () => {
      expect(handlers["file:cutToSystemClipboard"]).toBeDefined();
      expect(typeof handlers["file:cutToSystemClipboard"]).toBe("function");
    });

    it("should handle pasteFromSystemClipboard", async () => {
      expect(handlers["file:pasteFromSystemClipboard"]).toBeDefined();
      expect(typeof handlers["file:pasteFromSystemClipboard"]).toBe("function");
    });

    it("should handle importFromSystemClipboard", async () => {
      expect(handlers["file:importFromSystemClipboard"]).toBeDefined();
      expect(typeof handlers["file:importFromSystemClipboard"]).toBe(
        "function",
      );
    });
  });

  describe("扩展操作", () => {
    it("should handle openWith", async () => {
      expect(handlers["file:openWith"]).toBeDefined();
      expect(typeof handlers["file:openWith"]).toBe("function");
    });

    it("should handle openWithProgram", async () => {
      expect(handlers["file:openWithProgram"]).toBeDefined();
      expect(typeof handlers["file:openWithProgram"]).toBe("function");
    });
  });

  // IPC 安全发现 #2：项目级文件操作的 `..` 路径穿越守卫。守卫在任何 fs 调用前抛出，
  // 故无需 mock fs（Node 内置模块在 vitest forks 下 mock 不可靠）。
  describe("路径穿越防护 (path traversal #2)", () => {
    const ev = {}; // handler 的 _event 参数未使用

    it("rejects deleteItem escaping the project root", async () => {
      await expect(
        handlers["file:deleteItem"](ev, {
          projectId: "p1",
          filePath: "../../../etc/passwd",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects createFile escaping the project root", async () => {
      await expect(
        handlers["file:createFile"](ev, {
          projectId: "p1",
          filePath: "../../evil.txt",
          content: "x",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects createFolder escaping the project root", async () => {
      await expect(
        handlers["file:createFolder"](ev, {
          projectId: "p1",
          folderPath: "../../evil",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects copyItem with an escaping source", async () => {
      await expect(
        handlers["file:copyItem"](ev, {
          projectId: "p1",
          sourcePath: "../../secret",
          targetPath: "sub",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects moveItem with an escaping target", async () => {
      await expect(
        handlers["file:moveItem"](ev, {
          projectId: "p1",
          sourcePath: "a.txt",
          targetPath: "../../../tmp",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects renameItem with an escaping new name", async () => {
      await expect(
        handlers["file:renameItem"](ev, {
          projectId: "p1",
          oldPath: "a.txt",
          newName: "../../escape",
        }),
      ).rejects.toThrow(/outside the project root/);
    });

    it("rejects revealInExplorer escaping the project root", async () => {
      await expect(
        handlers["file:revealInExplorer"](ev, {
          projectId: "p1",
          filePath: "../../../etc",
        }),
      ).rejects.toThrow(/outside the project root/);
    });
  });
});
