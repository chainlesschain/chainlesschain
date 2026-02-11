/**
 * StorageHandler 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../../src/main/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock execAsync results
const mockExecAsync = vi.fn();

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (typeof opts === "function") {
      callback = opts;
    }
    setImmediate(() => callback(null, "", ""));
  }),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

// Mock fs.promises
const mockFsReaddir = vi.fn();
const mockFsStat = vi.fn();
const mockFsAccess = vi.fn();
const mockFsUnlink = vi.fn();

vi.mock("fs", () => ({
  promises: {
    readdir: (...args) => mockFsReaddir(...args),
    stat: (...args) => mockFsStat(...args),
    access: (...args) => mockFsAccess(...args),
    unlink: (...args) => mockFsUnlink(...args),
  },
}));

// Mock os module
vi.mock("os", () => ({
  tmpdir: () => "/tmp",
  homedir: () => "/home/testuser",
}));

const {
  StorageHandler,
} = require("../../../src/main/remote/handlers/storage-handler");

describe("StorageHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    mockFsReaddir.mockResolvedValue([]);
    mockFsStat.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      size: 1024,
      birthtime: new Date(),
      mtime: new Date(),
      atime: new Date(),
    });
    mockFsAccess.mockResolvedValue(undefined);
    mockFsUnlink.mockResolvedValue(undefined);
    handler = new StorageHandler();
  });

  afterEach(async () => {
    // 注意：cleanup 是处理器的方法名，不要与 vi.clearAllMocks 混淆
    if (handler && handler.cleanup) {
      await handler.cleanup();
    }
  });

  describe("getDisks", () => {
    it("应该返回磁盘列表", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Node,DeviceID,DriveType,FileSystem,FreeSpace,Size,VolumeName
PC,C:,3,NTFS,50000000000,100000000000,System
PC,D:,3,NTFS,200000000000,500000000000,Data`,
        stderr: "",
      });

      const result = await handler.handle("getDisks", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.disks)).toBe(true);
    });
  });

  describe("getUsage", () => {
    it("应该返回存储使用情况摘要", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Node,DeviceID,DriveType,FileSystem,FreeSpace,Size,VolumeName
PC,C:,3,NTFS,50000000000,100000000000,System`,
        stderr: "",
      });

      const result = await handler.handle("getUsage", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.usage).toBeDefined();
      expect(typeof result.usage.total).toBe("number");
      expect(typeof result.usage.used).toBe("number");
      expect(typeof result.usage.free).toBe("number");
    });
  });

  describe("getPartitions", () => {
    it("应该返回分区信息", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Node,BlockSize,Name,Size,Type
PC,512,Disk #0 Partition #0,500000000000,Primary`,
        stderr: "",
      });

      const result = await handler.handle("getPartitions", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.partitions)).toBe(true);
    });
  });

  describe("getStats", () => {
    it.skip("应该返回文件系统统计 (跳过: 需要真实文件路径)", async () => {
      mockFsStat.mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
        size: 1024,
        birthtime: new Date(),
        mtime: new Date(),
        atime: new Date(),
      });

      const result = await handler.handle(
        "getStats",
        { targetPath: "/home/testuser" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.stats).toBeDefined();
      expect(result.stats.path).toBe("/home/testuser");
    });

    it("应该拒绝路径遍历攻击", async () => {
      await expect(
        handler.handle(
          "getStats",
          { targetPath: "../../../etc/passwd" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid path format");
    });
  });

  describe("getFolderSize", () => {
    it("应该返回文件夹大小", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: "1073741824",
        stderr: "",
      });

      const result = await handler.handle(
        "getFolderSize",
        { folderPath: "/home/testuser/Documents" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.folderPath).toBe("/home/testuser/Documents");
      expect(typeof result.size).toBe("number");
    });

    it("缺少 folderPath 参数应该报错", async () => {
      await expect(
        handler.handle("getFolderSize", {}, mockContext),
      ).rejects.toThrow('Parameter "folderPath" is required');
    });

    it("应该拒绝无效路径", async () => {
      await expect(
        handler.handle(
          "getFolderSize",
          { folderPath: "../../secret" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid path format");
    });
  });

  describe("getLargeFiles", () => {
    it("应该返回大文件列表", async () => {
      mockFsReaddir.mockResolvedValue([
        { name: "large.zip", isDirectory: () => false, isFile: () => true },
      ]);
      mockFsStat.mockResolvedValue({
        size: 200 * 1024 * 1024, // 200 MB
        mtime: new Date(),
        isDirectory: () => false,
        isFile: () => true,
      });

      const result = await handler.handle(
        "getLargeFiles",
        { searchPath: "/home/testuser", minSize: 100 * 1024 * 1024 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.files)).toBe(true);
    });

    it("应该拒绝无效路径", async () => {
      await expect(
        handler.handle(
          "getLargeFiles",
          { searchPath: "../../../" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid path format");
    });
  });

  describe("getRecentFiles", () => {
    it("应该返回最近修改的文件", async () => {
      const recentDate = new Date();
      mockFsReaddir.mockResolvedValue([
        { name: "recent.txt", isDirectory: () => false, isFile: () => true },
      ]);
      mockFsStat.mockResolvedValue({
        size: 1024,
        mtime: recentDate,
        isDirectory: () => false,
        isFile: () => true,
      });

      const result = await handler.handle(
        "getRecentFiles",
        { searchPath: "/home/testuser", days: 7 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.files)).toBe(true);
      expect(result.days).toBe(7);
    });
  });

  describe("cleanup", () => {
    it("应该执行干运行清理", async () => {
      mockFsReaddir.mockResolvedValue([
        { name: "old_temp.tmp", isDirectory: () => false, isFile: () => true },
      ]);
      mockFsStat.mockResolvedValue({
        size: 1024,
        mtime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
        isDirectory: () => false,
        isFile: () => true,
      });

      const result = await handler.handle(
        "cleanup",
        { dryRun: true, maxAge: 7 },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.cleaned).toBeDefined();
    });

    it("默认应该是干运行模式", async () => {
      const result = await handler.handle("cleanup", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });
  });

  describe("emptyTrash", () => {
    it("应该执行干运行清空回收站", async () => {
      const result = await handler.handle(
        "emptyTrash",
        { dryRun: true },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });

    it("默认应该是干运行模式", async () => {
      const result = await handler.handle("emptyTrash", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
    });
  });

  describe("getDriveHealth", () => {
    it("应该返回驱动器健康状态", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Node,MediaType,Model,Size,Status
PC,Fixed hard disk media,Samsung SSD,500000000000,OK`,
        stderr: "",
      });

      const result = await handler.handle("getDriveHealth", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.drives)).toBe(true);
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });

  describe("path validation", () => {
    it("应该拒绝包含 .. 的路径", async () => {
      await expect(
        handler.handle(
          "getStats",
          { targetPath: "/home/../etc/passwd" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid path format");
    });

    it("应该拒绝过长的路径", async () => {
      const longPath = "/home/" + "a".repeat(600);
      await expect(
        handler.handle("getStats", { targetPath: longPath }, mockContext),
      ).rejects.toThrow("Invalid path format");
    });
  });
});
