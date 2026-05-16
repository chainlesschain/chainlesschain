/**
 * AndroidFileHandler 单元 + 集成测试
 *
 * 覆盖 11 个 action + 2026-05-17 一晚修的 6 个 bug 全部回归。
 *
 * 用真实 fs (os.tmpdir() 隔离) 而非 vi.mock("fs") — 后者在 vitest forks pool
 * 对 Node built-in 不可靠 (see .claude/rules/testing.md)。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import os from "os";

import { AndroidFileHandler } from "../handlers/android-file-handler";

describe("AndroidFileHandler", () => {
  let handler;
  let tmpRoot;
  let downloadDir;

  beforeEach(async () => {
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "afh-test-"));
    downloadDir = path.join(tmpRoot, "downloads");
    await fsPromises.mkdir(downloadDir, { recursive: true });
    handler = new AndroidFileHandler({
      chunkSize: 16, // 小 chunk 让 multi-chunk 测试容易
      maxConcurrent: 4,
      downloadDir,
    });
  });

  afterEach(async () => {
    handler.shutdown();
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  // ==================== _resolvePath ====================

  describe("_resolvePath", () => {
    it("expands ~ to homedir", () => {
      expect(handler._resolvePath("~")).toBe(os.homedir());
    });

    it("expands ~/ prefix to homedir-relative", () => {
      const out = handler._resolvePath("~/foo");
      expect(out).toBe(path.join(os.homedir(), "foo"));
    });

    it("treats '.' as homedir", () => {
      expect(handler._resolvePath(".")).toBe(os.homedir());
    });

    it("absolute path passes through normalized", () => {
      expect(handler._resolvePath(tmpRoot)).toBe(path.resolve(tmpRoot));
    });

    it("throws on null/non-string", () => {
      expect(() => handler._resolvePath(null)).toThrow();
      expect(() => handler._resolvePath(42)).toThrow();
    });
  });

  // ==================== listDirectory ====================

  describe("listDirectory", () => {
    // 用 tmpRoot 下一个 clean 子目录避免被 beforeEach 创建的 downloads/ 污染。
    let testDir;
    beforeEach(async () => {
      testDir = path.join(tmpRoot, "ls-test");
      await fsPromises.mkdir(testDir);
    });

    it("returns entries with Android-aligned fields (type, modifiedTime, ...)", async () => {
      await fsPromises.writeFile(path.join(testDir, "file1.txt"), "hello");
      await fsPromises.mkdir(path.join(testDir, "subdir"));

      const res = await handler.listDirectory({ path: testDir });

      expect(res.success).toBe(true);
      expect(res.total).toBe(2);
      expect(res.entries).toHaveLength(2);

      const entry = res.entries[0];
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("type"); // "file" | "directory" | "symlink"
      expect(entry).toHaveProperty("size");
      expect(entry).toHaveProperty("modifiedTime");
      expect(entry).toHaveProperty("isHidden");
      // 不应该有 isDirectory / isFile / modifiedAt 这些 PC 端 FileTransferHandler 字段
      expect(entry).not.toHaveProperty("isDirectory");
      expect(entry).not.toHaveProperty("modifiedAt");
    });

    it("sorts directories before files", async () => {
      await fsPromises.writeFile(path.join(testDir, "zfile.txt"), "z");
      await fsPromises.mkdir(path.join(testDir, "adir"));

      const res = await handler.listDirectory({ path: testDir });
      expect(res.entries[0].type).toBe("directory");
      expect(res.entries[0].name).toBe("adir");
      expect(res.entries[1].type).toBe("file");
    });

    it("hides dotfiles by default; shows when showHidden=true", async () => {
      await fsPromises.writeFile(path.join(testDir, ".secret"), "x");
      await fsPromises.writeFile(path.join(testDir, "public.txt"), "y");

      const hidden = await handler.listDirectory({ path: testDir });
      expect(hidden.entries.find((e) => e.name === ".secret")).toBeUndefined();

      const shown = await handler.listDirectory({
        path: testDir,
        showHidden: true,
      });
      expect(shown.entries.find((e) => e.name === ".secret")).toBeDefined();
    });

    it("throws when path is not a directory", async () => {
      const file = path.join(testDir, "f.txt");
      await fsPromises.writeFile(file, "x");
      await expect(handler.listDirectory({ path: file })).rejects.toThrow(
        /not a directory/,
      );
    });

    it("skips items whose stat() throws (broken symlinks, perm errors)", async () => {
      // 构造一个指向不存在目标的 symlink
      try {
        await fsPromises.symlink(
          path.join(testDir, "ghost"),
          path.join(testDir, "broken"),
        );
      } catch {
        // Windows non-admin 不能创 symlink — 跳过该 assertion
        return;
      }
      await fsPromises.writeFile(path.join(testDir, "alive.txt"), "x");
      const res = await handler.listDirectory({ path: testDir });
      const names = res.entries.map((e) => e.name);
      expect(names).toContain("alive.txt"); // 主流程不中断
    });
  });

  // ==================== getFileInfo / exists ====================

  describe("getFileInfo / exists", () => {
    it("getFileInfo returns file metadata", async () => {
      const f = path.join(tmpRoot, "foo.txt");
      await fsPromises.writeFile(f, "hello");
      const info = await handler.getFileInfo({ path: f });
      expect(info.exists).toBe(true);
      expect(info.file.type).toBe("file");
      expect(info.file.size).toBe(5);
    });

    it("getFileInfo returns exists=false (not throw) for missing", async () => {
      const info = await handler.getFileInfo({
        path: path.join(tmpRoot, "ghost"),
      });
      expect(info.exists).toBe(false);
      expect(info.message).toBeDefined();
    });

    it("exists returns isFile/isDirectory flags", async () => {
      await fsPromises.mkdir(path.join(tmpRoot, "d"));
      const r = await handler.exists({ path: path.join(tmpRoot, "d") });
      expect(r.exists).toBe(true);
      expect(r.isDirectory).toBe(true);
      expect(r.isFile).toBe(false);
    });
  });

  // ==================== createDirectory / delete ====================

  describe("createDirectory / delete", () => {
    it("createDirectory recursive creates parents", async () => {
      const p = path.join(tmpRoot, "a/b/c");
      const r = await handler.createDirectory({ path: p, recursive: true });
      expect(r.success).toBe(true);
      const stat = await fsPromises.stat(p);
      expect(stat.isDirectory()).toBe(true);
    });

    it("delete file (via handle dispatch)", async () => {
      const f = path.join(tmpRoot, "x.txt");
      await fsPromises.writeFile(f, "x");
      const r = await handler.handle("delete", { path: f }, {});
      expect(r.success).toBe(true);
      await expect(fsPromises.stat(f)).rejects.toThrow();
    });

    it("delete directory (recursive=true)", async () => {
      const d = path.join(tmpRoot, "d");
      await fsPromises.mkdir(d);
      await fsPromises.writeFile(path.join(d, "x"), "x");

      const r = await handler.handle(
        "delete",
        { path: d, recursive: true },
        {},
      );
      expect(r.success).toBe(true);
      await expect(fsPromises.stat(d)).rejects.toThrow();
    });
  });

  // ==================== Upload roundtrip ====================

  describe("upload roundtrip (request → chunks → complete)", () => {
    it("end-to-end 3-chunk upload reconstructs file content", async () => {
      const content = "abcdefghijklmnopqrstuvwxyzABCDE"; // 31 bytes
      const fileName = "hello.txt";

      // request
      const req = await handler.requestUpload({
        fileName,
        fileSize: content.length,
      });
      expect(req.transferId).toMatch(/^up_/);
      expect(req.chunkSize).toBe(16);
      expect(req.totalChunks).toBe(2); // ceil(31/16) = 2
      expect(req.resumeSupported).toBe(false);

      // chunks
      const buf = Buffer.from(content, "utf-8");
      for (let i = 0; i < req.totalChunks; i++) {
        const slice = buf.subarray(i * 16, (i + 1) * 16);
        const r = await handler.uploadChunk({
          transferId: req.transferId,
          chunkIndex: i,
          chunkData: slice.toString("base64"),
        });
        expect(r.received).toBe(true);
        expect(r.remainingChunks).toBe(req.totalChunks - i - 1);
      }

      // complete
      const done = await handler.completeUpload({ transferId: req.transferId });
      expect(done.status).toBe("completed");
      expect(done.fileSize).toBe(content.length);
      expect(done.filePath.endsWith(fileName)).toBe(true);

      // 落盘内容正确
      const written = await fsPromises.readFile(done.filePath, "utf-8");
      expect(written).toBe(content);
    });

    it("collision-suffix: existing fileName triggers ' (1)' suffix", async () => {
      const name = "dup.bin";
      await fsPromises.writeFile(path.join(downloadDir, name), "preexisting");

      const req = await handler.requestUpload({
        fileName: name,
        fileSize: 4,
      });
      await handler.uploadChunk({
        transferId: req.transferId,
        chunkIndex: 0,
        chunkData: Buffer.from("test").toString("base64"),
      });
      const done = await handler.completeUpload({
        transferId: req.transferId,
      });
      expect(done.fileName).toBe("dup (1).bin");
      expect(done.filePath.endsWith("dup (1).bin")).toBe(true);
      // 老文件没被覆盖
      const oldContent = await fsPromises.readFile(
        path.join(downloadDir, name),
        "utf-8",
      );
      expect(oldContent).toBe("preexisting");
    });

    it("uploadChunk throws on unknown transferId", async () => {
      await expect(
        handler.uploadChunk({
          transferId: "ghost",
          chunkIndex: 0,
          chunkData: Buffer.from("x").toString("base64"),
        }),
      ).rejects.toThrow(/not found/);
    });

    it("uploadChunk throws on non-string chunkData", async () => {
      const req = await handler.requestUpload({
        fileName: "bad.bin",
        fileSize: 1,
      });
      await expect(
        handler.uploadChunk({
          transferId: req.transferId,
          chunkIndex: 0,
          chunkData: Buffer.from("x"), // 错传 Buffer
        }),
      ).rejects.toThrow(/base64 string/);
    });

    it("requestUpload throws when maxConcurrent reached", async () => {
      handler = new AndroidFileHandler({
        chunkSize: 16,
        maxConcurrent: 1,
        downloadDir,
      });
      await handler.requestUpload({ fileName: "a", fileSize: 1 });
      await expect(
        handler.requestUpload({ fileName: "b", fileSize: 1 }),
      ).rejects.toThrow(/Max concurrent/);
    });

    it("metadata.targetDir overrides default downloadDir", async () => {
      const altDir = path.join(tmpRoot, "alt");
      await fsPromises.mkdir(altDir);
      const req = await handler.requestUpload({
        fileName: "to-alt.bin",
        fileSize: 3,
        metadata: { targetDir: altDir },
      });
      await handler.uploadChunk({
        transferId: req.transferId,
        chunkIndex: 0,
        chunkData: Buffer.from("xyz").toString("base64"),
      });
      const done = await handler.completeUpload({
        transferId: req.transferId,
      });
      expect(path.dirname(done.filePath)).toBe(path.resolve(altDir));
    });
  });

  // ==================== Download roundtrip ====================

  describe("download roundtrip (request → chunks)", () => {
    it("end-to-end 3-chunk download base64 streams correctly", async () => {
      const content = "the quick brown fox jumps over"; // 30 bytes, chunk=16 → 2 chunks
      const src = path.join(tmpRoot, "src.txt");
      await fsPromises.writeFile(src, content);

      const req = await handler.requestDownload({ filePath: src });
      expect(req.transferId).toMatch(/^dn_/);
      expect(req.fileSize).toBe(content.length);
      expect(req.totalChunks).toBe(2);

      // BUG 回归：checksum 必须 null（不然 Repository 用 MD5 比对 fail 自删文件）
      expect(req.checksum).toBeNull();

      const chunks = [];
      for (let i = 0; i < req.totalChunks; i++) {
        const r = await handler.downloadChunk({
          transferId: req.transferId,
          chunkIndex: i,
        });
        chunks.push(Buffer.from(r.chunkData, "base64"));
        if (i < req.totalChunks - 1) {
          expect(r.isLastChunk).toBe(false);
        } else {
          expect(r.isLastChunk).toBe(true);
        }
      }
      expect(Buffer.concat(chunks).toString("utf-8")).toBe(content);

      // 最后一块到了 transfer 应该已被清理（fd 关 + map delete）
      expect(handler._activeCount()).toBe(0);
    });

    it("requestDownload throws when path is not a file", async () => {
      await expect(
        handler.requestDownload({ filePath: tmpRoot }),
      ).rejects.toThrow(/not a file/);
    });

    it("downloadChunk throws on unknown transferId", async () => {
      await expect(
        handler.downloadChunk({ transferId: "ghost", chunkIndex: 0 }),
      ).rejects.toThrow(/not found/);
    });
  });

  // ==================== cancelTransfer ====================

  describe("cancelTransfer", () => {
    it("upload cancel removes half-written file", async () => {
      const req = await handler.requestUpload({
        fileName: "half.bin",
        fileSize: 32,
      });
      const fullPath = path.join(downloadDir, "half.bin");
      // 写一块
      await handler.uploadChunk({
        transferId: req.transferId,
        chunkIndex: 0,
        chunkData: Buffer.from("0123456789ABCDEF").toString("base64"),
      });
      expect(fs.existsSync(fullPath)).toBe(true);

      const r = await handler.cancelTransfer({ transferId: req.transferId });
      expect(r.status).toBe("cancelled");
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it("cancelling unknown transferId is no-op (no throw)", async () => {
      const r = await handler.cancelTransfer({ transferId: "ghost" });
      expect(r.status).toBe("cancelled");
    });
  });

  // ==================== handle() dispatch ====================

  describe("handle() dispatch", () => {
    it("dispatches all 11 actions", async () => {
      const actions = [
        "listDirectory",
        "getFileInfo",
        "exists",
        "delete",
        "createDirectory",
        "requestUpload",
        "uploadChunk",
        "completeUpload",
        "requestDownload",
        "downloadChunk",
        "cancelTransfer",
        "listTransfers",
      ];
      // 简单 smoke：unknown 抛特定错；known 不抛 Unknown
      for (const a of actions) {
        try {
          await handler.handle(a, {}, {});
        } catch (e) {
          expect(e.message).not.toMatch(/Unknown file action/);
        }
      }
    });

    it("throws on unknown action", async () => {
      await expect(handler.handle("foo.bar", {}, {})).rejects.toThrow(
        /Unknown file action/,
      );
    });
  });

  // ==================== listTransfers ====================

  describe("listTransfers", () => {
    it("returns in-progress transfers with Android-shape fields", async () => {
      await handler.requestUpload({ fileName: "a.bin", fileSize: 100 });
      const list = await handler.listTransfers({});
      expect(list.total).toBe(1);
      expect(list.transfers[0]).toHaveProperty("id");
      expect(list.transfers[0]).toHaveProperty("direction");
      expect(list.transfers[0]).toHaveProperty("status");
      expect(list.transfers[0]).toHaveProperty("progress");
    });
  });
});
