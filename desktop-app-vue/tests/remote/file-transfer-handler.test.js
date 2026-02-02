/**
 * FileTransferHandler 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileTransferHandler } from "../../src/main/remote/handlers/file-transfer-handler.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Mock database with proper data tracking
function createMockDatabase() {
  const transfers = new Map();

  const mockDb = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => ({
      run: vi.fn((...args) => {
        if (sql.includes("INSERT INTO file_transfers")) {
          // Field order: id, device_did, direction, file_name, file_size, total_chunks, status, progress, created_at, updated_at, metadata
          const id = args[0];
          transfers.set(id, {
            id: args[0],
            device_did: args[1],
            direction: args[2],
            file_name: args[3],
            file_size: args[4],
            total_chunks: args[5],
            status: args[6],
            progress: args[7],
            created_at: args[8],
            updated_at: args[9],
            metadata: args[10],
          });
          return { changes: 1, lastInsertRowid: 1 };
        }
        if (sql.includes("UPDATE file_transfers")) {
          // Handle status updates - need to parse SET clause
          const id = args[args.length - 1]; // Last arg is WHERE id = ?
          const transfer = transfers.get(id);
          if (transfer) {
            // Check what's being updated based on SQL
            if (sql.includes("status = ?") && sql.includes("progress = ?")) {
              // UPDATE ... SET status = ?, progress = ?, updated_at = ? WHERE id = ?
              transfer.status = args[0];
              transfer.progress = args[1];
              transfer.updated_at = args[2];
            } else if (sql.includes("status = ?")) {
              transfer.status = args[0];
              if (args.length > 2) {
                transfer.updated_at = args[1];
              }
            }
          }
          return { changes: 1 };
        }
        return { changes: 1 };
      }),
      get: vi.fn((...args) => {
        if (sql.includes("SELECT") && sql.includes("file_transfers")) {
          const id = args[0];
          return transfers.get(id) || null;
        }
        return null;
      }),
      all: vi.fn((...args) => {
        let results = Array.from(transfers.values());
        // Handle status filter if present
        if (sql.includes("status = ?") && args.length > 0) {
          const status = args[0];
          results = results.filter((t) => t.status === status);
        }
        return results;
      }),
    })),
    close: vi.fn(),
    // Helper to access transfers for testing
    _transfers: transfers,
  };

  return mockDb;
}

describe("FileTransferHandler", () => {
  let handler;
  let database;
  let testDir;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `test-file-transfer-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // 创建 mock 数据库
    database = createMockDatabase();

    // 创建 FileTransferHandler
    handler = new FileTransferHandler(database, {
      uploadDir: path.join(testDir, "uploads"),
      downloadDir: path.join(testDir, "downloads"),
      tempDir: path.join(testDir, "temp"),
      chunkSize: 1024, // 1KB for testing
      maxConcurrent: 3,
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    // 等待目录创建
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // 清理数据库
    database.close();

    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.warn("清理测试目录失败:", error);
    }
  });

  describe("requestUpload", () => {
    it("应该成功创建上传请求", async () => {
      const params = {
        fileName: "test.txt",
        fileSize: 5000,
        checksum: "abc123",
        metadata: { source: "android" },
      };

      const context = {
        did: "did:key:test123",
        peerId: "peer123",
      };

      const result = await handler.requestUpload(params, context);

      expect(result).toHaveProperty("transferId");
      expect(result).toHaveProperty("chunkSize", 1024);
      expect(result).toHaveProperty("totalChunks", 5); // 5000 / 1024 = 4.88 → 5
      expect(result).toHaveProperty("resumeSupported", true);

      // 验证传输任务已创建
      const transfer = handler.transfers.get(result.transferId);
      expect(transfer).toBeDefined();
      expect(transfer.fileName).toBe("test.txt");
      expect(transfer.fileSize).toBe(5000);
      expect(transfer.status).toBe("in_progress");

      // 验证数据库记录已创建
      const dbTransfer = database
        .prepare("SELECT * FROM file_transfers WHERE id = ?")
        .get(result.transferId);

      expect(dbTransfer).toBeDefined();
      expect(dbTransfer.device_did).toBe("did:key:test123");
      expect(dbTransfer.direction).toBe("upload");
    });

    it("应该拒绝超过大小限制的文件", async () => {
      const params = {
        fileName: "large.bin",
        fileSize: 20 * 1024 * 1024, // 20MB > 10MB limit
      };

      const context = { did: "did:key:test123" };

      await expect(handler.requestUpload(params, context)).rejects.toThrow(
        /exceeds maximum allowed size/,
      );
    });

    it("应该拒绝无效的文件名", async () => {
      const params = {
        fileName: "",
        fileSize: 1000,
      };

      const context = { did: "did:key:test123" };

      await expect(handler.requestUpload(params, context)).rejects.toThrow(
        /fileName.*required/,
      );
    });
  });

  describe("uploadChunk", () => {
    it("应该成功接收文件分块", async () => {
      // 先创建上传请求
      const uploadResult = await handler.requestUpload(
        {
          fileName: "test.txt",
          fileSize: 2048,
        },
        { did: "did:key:test123" },
      );

      const transferId = uploadResult.transferId;

      // 上传第一个分块
      const chunkData = Buffer.from("a".repeat(1024)).toString("base64");
      const result = await handler.uploadChunk(
        {
          transferId,
          chunkIndex: 0,
          chunkData,
        },
        { did: "did:key:test123" },
      );

      expect(result.received).toBe(true);
      expect(result.chunkIndex).toBe(0);
      expect(result.progress).toBeGreaterThan(0);
      expect(result.remainingChunks).toBe(1);

      // 验证传输任务已更新
      const transfer = handler.transfers.get(transferId);
      expect(transfer.receivedChunks.has(0)).toBe(true);
      expect(transfer.progress).toBeCloseTo(50, 0);
    });

    it("应该拒绝不存在的传输", async () => {
      const params = {
        transferId: "invalid-transfer-id",
        chunkIndex: 0,
        chunkData: "AAAA",
      };

      const context = { did: "did:key:test123" };

      await expect(handler.uploadChunk(params, context)).rejects.toThrow(
        /Transfer not found/,
      );
    });

    it("应该拒绝不匹配的设备", async () => {
      // 先创建上传请求
      const uploadResult = await handler.requestUpload(
        {
          fileName: "test.txt",
          fileSize: 1024,
        },
        { did: "did:key:test123" },
      );

      // 尝试从不同的设备上传
      await expect(
        handler.uploadChunk(
          {
            transferId: uploadResult.transferId,
            chunkIndex: 0,
            chunkData: "AAAA",
          },
          { did: "did:key:other-device" },
        ),
      ).rejects.toThrow(/Permission denied.*mismatch/);
    });
  });

  describe("completeUpload", () => {
    it("应该成功完成上传", async () => {
      // 创建上传请求
      const uploadResult = await handler.requestUpload(
        {
          fileName: "test.txt",
          fileSize: 2048,
        },
        { did: "did:key:test123" },
      );

      const transferId = uploadResult.transferId;

      // 上传所有分块
      for (let i = 0; i < uploadResult.totalChunks; i++) {
        const chunkData = Buffer.from("a".repeat(1024)).toString("base64");
        await handler.uploadChunk(
          {
            transferId,
            chunkIndex: i,
            chunkData,
          },
          { did: "did:key:test123" },
        );
      }

      // 完成上传
      const result = await handler.completeUpload(
        { transferId },
        { did: "did:key:test123" },
      );

      expect(result.status).toBe("completed");
      expect(result.fileName).toBe("test.txt");
      expect(result.fileSize).toBe(2048);
      expect(result).toHaveProperty("duration");

      // 验证传输任务已清理
      expect(handler.transfers.has(transferId)).toBe(false);

      // 验证数据库记录已更新
      const dbTransfer = database
        .prepare("SELECT * FROM file_transfers WHERE id = ?")
        .get(transferId);

      expect(dbTransfer.status).toBe("completed");
      expect(dbTransfer.progress).toBe(100);
      expect(dbTransfer.completed_at).toBeDefined();

      // 验证文件已移动到最终位置
      const finalPath = path.join(handler.uploadDir, "test.txt");
      const stats = await fs.stat(finalPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBe(2048);
    });

    it("应该拒绝不完整的上传", async () => {
      // 创建上传请求
      const uploadResult = await handler.requestUpload(
        {
          fileName: "test.txt",
          fileSize: 2048,
        },
        { did: "did:key:test123" },
      );

      // 只上传一个分块
      const chunkData = Buffer.from("a".repeat(1024)).toString("base64");
      await handler.uploadChunk(
        {
          transferId: uploadResult.transferId,
          chunkIndex: 0,
          chunkData,
        },
        { did: "did:key:test123" },
      );

      // 尝试完成上传
      await expect(
        handler.completeUpload(
          { transferId: uploadResult.transferId },
          { did: "did:key:test123" },
        ),
      ).rejects.toThrow(/Incomplete transfer/);
    });
  });

  describe("requestDownload", () => {
    it("应该成功创建下载请求", async () => {
      // 先创建一个测试文件
      const testFilePath = path.join(handler.uploadDir, "download-test.txt");
      const testContent = "Hello, world!";
      await fs.writeFile(testFilePath, testContent);

      const params = {
        filePath: testFilePath,
        fileName: "download-test.txt",
      };

      const context = {
        did: "did:key:test123",
        peerId: "peer123",
      };

      const result = await handler.requestDownload(params, context);

      expect(result).toHaveProperty("transferId");
      expect(result.fileName).toBe("download-test.txt");
      expect(result.fileSize).toBe(testContent.length);
      expect(result).toHaveProperty("chunkSize");
      expect(result).toHaveProperty("totalChunks");

      // 验证传输任务已创建
      const transfer = handler.transfers.get(result.transferId);
      expect(transfer).toBeDefined();
      expect(transfer.direction).toBe("download");
      expect(transfer.status).toBe("in_progress");
    });

    it("应该拒绝不存在的文件", async () => {
      const params = {
        filePath: path.join(handler.uploadDir, "nonexistent.txt"),
      };

      const context = { did: "did:key:test123" };

      await expect(handler.requestDownload(params, context)).rejects.toThrow();
    });

    it("应该拒绝目录外的文件路径", async () => {
      const params = {
        filePath: "/etc/passwd", // 不在允许的目录内
      };

      const context = { did: "did:key:test123" };

      await expect(handler.requestDownload(params, context)).rejects.toThrow(
        /Access denied.*outside allowed/,
      );
    });
  });

  describe("downloadChunk", () => {
    it("应该成功发送文件分块", async () => {
      // 创建测试文件
      const testFilePath = path.join(handler.uploadDir, "chunk-test.txt");
      const testContent = "a".repeat(2048);
      await fs.writeFile(testFilePath, testContent);

      // 创建下载请求
      const downloadResult = await handler.requestDownload(
        {
          filePath: testFilePath,
        },
        { did: "did:key:test123" },
      );

      const transferId = downloadResult.transferId;

      // 下载第一个分块
      const result = await handler.downloadChunk(
        {
          transferId,
          chunkIndex: 0,
        },
        { did: "did:key:test123" },
      );

      expect(result.transferId).toBe(transferId);
      expect(result.chunkIndex).toBe(0);
      expect(result.chunkData).toBeDefined();
      expect(result.chunkSize).toBe(1024);
      expect(result.isLastChunk).toBe(false);

      // 验证数据可以解码
      const decodedData = Buffer.from(result.chunkData, "base64");
      expect(decodedData.length).toBe(1024);
      expect(decodedData.toString()).toBe("a".repeat(1024));
    });
  });

  describe("cancelTransfer", () => {
    it("应该成功取消传输", async () => {
      // 创建上传请求
      const uploadResult = await handler.requestUpload(
        {
          fileName: "cancel-test.txt",
          fileSize: 1024,
        },
        { did: "did:key:test123" },
      );

      const transferId = uploadResult.transferId;

      // 取消传输
      const result = await handler.cancelTransfer(
        { transferId },
        { did: "did:key:test123" },
      );

      expect(result.status).toBe("cancelled");

      // 验证传输任务已清理
      expect(handler.transfers.has(transferId)).toBe(false);

      // 验证数据库记录已更新
      const dbTransfer = database
        .prepare("SELECT * FROM file_transfers WHERE id = ?")
        .get(transferId);

      expect(dbTransfer.status).toBe("cancelled");
    });
  });

  describe("listTransfers", () => {
    it("应该成功列出传输任务", async () => {
      const context = { did: "did:key:test123" };

      // 创建多个传输任务
      await handler.requestUpload(
        {
          fileName: "test1.txt",
          fileSize: 1024,
        },
        context,
      );

      await handler.requestUpload(
        {
          fileName: "test2.txt",
          fileSize: 2048,
        },
        context,
      );

      // 列出传输任务
      const result = await handler.listTransfers(
        {
          limit: 10,
          offset: 0,
        },
        context,
      );

      expect(result.transfers).toBeDefined();
      expect(result.transfers.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it("应该按状态过滤传输任务", async () => {
      const context = { did: "did:key:test123" };

      // 创建一个传输并完成
      const upload1 = await handler.requestUpload(
        {
          fileName: "completed.txt",
          fileSize: 1024,
        },
        context,
      );

      // 上传所有分块
      const chunkData = Buffer.from("a".repeat(1024)).toString("base64");
      await handler.uploadChunk(
        {
          transferId: upload1.transferId,
          chunkIndex: 0,
          chunkData,
        },
        context,
      );

      await handler.completeUpload({ transferId: upload1.transferId }, context);

      // 创建另一个进行中的传输
      await handler.requestUpload(
        {
          fileName: "in-progress.txt",
          fileSize: 1024,
        },
        context,
      );

      // 查询完成的传输
      const result = await handler.listTransfers(
        {
          status: "completed",
          limit: 10,
          offset: 0,
        },
        context,
      );

      expect(result.transfers.length).toBe(1);
      expect(result.transfers[0].status).toBe("completed");
      expect(result.transfers[0].file_name).toBe("completed.txt");
    });
  });

  describe("cleanupExpiredTransfers", () => {
    it("应该清理过期的传输任务", async () => {
      // 创建一个传输任务
      const uploadResult = await handler.requestUpload(
        {
          fileName: "expired.txt",
          fileSize: 1024,
        },
        { did: "did:key:test123" },
      );

      const transferId = uploadResult.transferId;

      // 手动设置为过期（修改更新时间）
      const transfer = handler.transfers.get(transferId);
      transfer.updatedAt = Date.now() - 25 * 60 * 60 * 1000; // 25小时前

      // 清理过期传输（超过24小时）
      const cleaned = await handler.cleanupExpiredTransfers(
        24 * 60 * 60 * 1000,
      );

      expect(cleaned).toBe(1);
      expect(handler.transfers.has(transferId)).toBe(false);

      // 验证数据库记录已更新
      const dbTransfer = database
        .prepare("SELECT * FROM file_transfers WHERE id = ?")
        .get(transferId);

      expect(dbTransfer.status).toBe("expired");
    });
  });
});
