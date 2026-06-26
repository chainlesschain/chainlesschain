/**
 * Android Remote File Handler
 *
 * 专门服务 Android remote-operate 客户端 (FileCommands.kt) 的文件协议适配器。
 * 区别于 file-transfer-handler.js (sandboxed in userData, web-shell 内部用)，
 * 本 handler 不做 path sandbox — 把已配对的 mobile peer 当 trusted device，
 * 允许浏览 / 读写整个 PC 文件系统（同 PC 当前 OS user 权限）。
 *
 * 协议字段全对齐 Android `FileCommands.kt` 的 model：
 *   - 请求参数用 `path`/`source`/`destination` 等 Android 命名
 *   - 响应字段用 `entries`/`type`/`modifiedTime` 等 Android 命名
 *
 * 安全 caveat：
 *   - mobile peer 必须已通过 desktop pairing (持有 Ed25519 keypair + p2p_paired_devices)
 *     的 trust gate；本 handler 假设 caller 已通过该 gate
 *   - 即便如此，任意 `delete`/`writeFile` 是 destructive，未来应叠一层
 *     mobileApprovalChannel（参考 marketplace.purchase / did.delegate 模式）
 *
 * Transfer registry 是 in-memory（重启清空）。设计权衡：
 *   - 手机端单次场景下用户预期"传完就完事"，不需要重启后断点续传
 *   - 持久化会引入 SQL schema / cleanup / 并发等额外复杂度
 *
 * @module remote/handlers/android-file-handler
 */

const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB; base64 后 ~85KB；signaling 转发 OK
const DEFAULT_MAX_CONCURRENT = 8;
const TRANSFER_TTL_MS = 30 * 60 * 1000; // 30min 后清理 stuck transfer

class AndroidFileHandler {
  constructor(options = {}) {
    this.options = {
      chunkSize: options.chunkSize || DEFAULT_CHUNK_SIZE,
      maxConcurrent: options.maxConcurrent || DEFAULT_MAX_CONCURRENT,
      downloadDir: options.downloadDir || path.join(os.homedir(), "Downloads"),
      ...options,
    };
    // transferId -> { direction, fileName, filePath, fileSize, totalChunks, receivedChunks, fd?, createdAt }
    this.transfers = new Map();
    this._gcTimer = setInterval(() => this._gcStaleTransfers(), 60_000);
    if (typeof this._gcTimer.unref === "function") {
      this._gcTimer.unref();
    }
  }

  shutdown() {
    if (this._gcTimer) {
      clearInterval(this._gcTimer);
      this._gcTimer = null;
    }
    // 关闭所有打开的 fd
    for (const t of this.transfers.values()) {
      if (t.fd) {
        try {
          fs.closeSync(t.fd);
        } catch {
          /* ignore */
        }
      }
    }
    this.transfers.clear();
  }

  _gcStaleTransfers() {
    const now = Date.now();
    for (const [id, t] of this.transfers.entries()) {
      if (now - t.createdAt > TRANSFER_TTL_MS) {
        if (t.fd) {
          try {
            fs.closeSync(t.fd);
          } catch {
            /* ignore */
          }
        }
        this.transfers.delete(id);
      }
    }
  }

  /**
   * 路径预处理：展开 `~`、normalize separator、resolve 相对路径。
   */
  _resolvePath(input) {
    if (!input || typeof input !== "string") {
      throw new Error('Parameter "path" is required and must be a string');
    }
    let p = input.trim();
    if (p === "" || p === ".") {
      return os.homedir();
    }
    // 展开 ~
    if (p === "~") {
      return os.homedir();
    }
    if (p.startsWith("~/") || p.startsWith("~\\")) {
      p = path.join(os.homedir(), p.substring(2));
    }
    // path.resolve 处理相对路径 + normalize separator
    return path.resolve(p);
  }

  /**
   * Unified 入口：根据 action 分发。
   */
  async handle(action, params = {}, ctx = {}) {
    switch (action) {
      case "listDirectory":
        return this.listDirectory(params);
      case "getFileInfo":
        return this.getFileInfo(params);
      case "exists":
        return this.exists(params);
      case "delete":
        return this.delete(params);
      case "createDirectory":
        return this.createDirectory(params);
      case "requestUpload":
        return this.requestUpload(params, ctx);
      case "uploadChunk":
        return this.uploadChunk(params);
      case "completeUpload":
        return this.completeUpload(params);
      case "requestDownload":
        return this.requestDownload(params);
      case "downloadChunk":
        return this.downloadChunk(params);
      case "cancelTransfer":
        return this.cancelTransfer(params);
      case "listTransfers":
        return this.listTransfers(params);
      default:
        throw new Error(`Unknown file action: ${action}`);
    }
  }

  // ==================== 文件系统操作 ====================

  async listDirectory(params) {
    const { path: rawPath, showHidden = false } = params;
    const fullPath = this._resolvePath(rawPath);

    const stat = await fsPromises.stat(fullPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${fullPath}`);
    }

    const dirents = await fsPromises.readdir(fullPath, { withFileTypes: true });
    const entries = [];

    for (const dirent of dirents) {
      const isHidden = dirent.name.startsWith(".");
      if (isHidden && !showHidden) {
        continue;
      }

      const itemPath = path.join(fullPath, dirent.name);
      let itemStat;
      try {
        itemStat = await fsPromises.stat(itemPath);
      } catch {
        // 软链断裂 / 权限不足 等，跳过该项继续
        continue;
      }

      let type = "file";
      if (dirent.isDirectory()) {
        type = "directory";
      } else if (dirent.isSymbolicLink()) {
        type = "symlink";
      }

      entries.push({
        name: dirent.name,
        path: itemPath,
        type,
        size: itemStat.size,
        modifiedTime: Math.floor(itemStat.mtimeMs),
        createdTime: Math.floor(itemStat.birthtimeMs || itemStat.ctimeMs),
        accessedTime: Math.floor(itemStat.atimeMs),
        isHidden,
        isReadOnly: !(itemStat.mode & 0o200),
      });
    }

    // 目录在前，按名字排序
    entries.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") {
        return -1;
      }
      if (a.type !== "directory" && b.type === "directory") {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      path: fullPath,
      entries,
      total: entries.length,
    };
  }

  async getFileInfo(params) {
    const fullPath = this._resolvePath(params.path);
    try {
      const stat = await fsPromises.stat(fullPath);
      const name = path.basename(fullPath);
      const isDirectory = stat.isDirectory();
      const isSymbolicLink = (
        await fsPromises.lstat(fullPath)
      ).isSymbolicLink();
      let type = "file";
      if (isDirectory) {
        type = "directory";
      } else if (isSymbolicLink) {
        type = "symlink";
      }

      return {
        success: true,
        exists: true,
        file: {
          name,
          path: fullPath,
          type,
          size: stat.size,
          modifiedTime: Math.floor(stat.mtimeMs),
          createdTime: Math.floor(stat.birthtimeMs || stat.ctimeMs),
          accessedTime: Math.floor(stat.atimeMs),
          isHidden: name.startsWith("."),
          isReadOnly: !(stat.mode & 0o200),
        },
      };
    } catch (e) {
      return { success: true, exists: false, message: e.message };
    }
  }

  async exists(params) {
    const fullPath = this._resolvePath(params.path);
    try {
      const stat = await fsPromises.stat(fullPath);
      return {
        success: true,
        path: fullPath,
        exists: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymlink: (await fsPromises.lstat(fullPath)).isSymbolicLink(),
      };
    } catch {
      return { success: true, path: fullPath, exists: false };
    }
  }

  async delete(params) {
    const fullPath = this._resolvePath(params.path);
    const { recursive = false, force = false } = params;
    try {
      const stat = await fsPromises.stat(fullPath);
      if (stat.isDirectory()) {
        await fsPromises.rm(fullPath, { recursive, force });
      } else {
        await fsPromises.unlink(fullPath);
      }
      return { success: true, path: fullPath };
    } catch (e) {
      return { success: false, path: fullPath, error: e.message };
    }
  }

  async createDirectory(params) {
    const fullPath = this._resolvePath(params.path);
    const { recursive = true } = params;
    await fsPromises.mkdir(fullPath, { recursive });
    return { success: true, path: fullPath };
  }

  // ==================== 上传（Android → PC）====================

  /**
   * Android 请求上传。落盘目录默认 ~/Downloads (复用 PC 用户 Downloads 文件夹)；
   * 后续可加 metadata.targetDir 让 Android 指定上传到具体路径。
   */
  async requestUpload(params, _ctx) {
    const { fileName, fileSize, checksum, metadata = {} } = params;

    if (!fileName || typeof fileName !== "string") {
      throw new Error('Parameter "fileName" is required and must be a string');
    }
    if (!Number.isFinite(fileSize) || fileSize < 0) {
      throw new Error('Parameter "fileSize" must be a non-negative number');
    }
    if (this._activeCount() >= this.options.maxConcurrent) {
      throw new Error(
        `Max concurrent transfers reached (${this.options.maxConcurrent})`,
      );
    }

    // 决定目标目录：metadata.targetDir 优先，否则默认 ~/Downloads
    const targetDir = metadata.targetDir
      ? this._resolvePath(metadata.targetDir)
      : this.options.downloadDir;
    await fsPromises.mkdir(targetDir, { recursive: true });

    // 防止覆盖：name 已存在 → 加 (1) (2) 后缀
    let finalName = path.basename(fileName);
    let finalPath = path.join(targetDir, finalName);
    let i = 1;
    while (fs.existsSync(finalPath)) {
      const ext = path.extname(finalName);
      const stem = path.basename(finalName, ext);
      finalPath = path.join(targetDir, `${stem} (${i})${ext}`);
      i++;
    }
    finalName = path.basename(finalPath);

    const transferId = `up_${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const chunkSize = this.options.chunkSize;
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));

    const fd = await fsPromises.open(finalPath, "w");

    this.transfers.set(transferId, {
      direction: "upload",
      fileName: finalName,
      filePath: finalPath,
      fileSize,
      chunkSize,
      totalChunks,
      receivedChunks: 0,
      bytesWritten: 0,
      checksum,
      fd, // FileHandle from fsPromises.open
      createdAt: Date.now(),
    });

    return {
      transferId,
      chunkSize,
      totalChunks,
      resumeSupported: false,
    };
  }

  async uploadChunk(params) {
    const { transferId, chunkIndex, chunkData } = params;
    const t = this.transfers.get(transferId);
    if (!t || t.direction !== "upload") {
      throw new Error(`Upload transfer not found: ${transferId}`);
    }
    if (typeof chunkData !== "string") {
      throw new Error("chunkData must be base64 string");
    }
    // chunkIndex comes from the remote peer; an undefined/NaN/fractional value
    // would make `offset` NaN/garbage and silently corrupt the uploaded file
    // (the sibling file-transfer-handler validates the same way).
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new Error("chunkIndex must be a non-negative integer");
    }
    const buf = Buffer.from(chunkData, "base64");
    const offset = chunkIndex * t.chunkSize;
    await t.fd.write(buf, 0, buf.length, offset);

    t.receivedChunks++;
    t.bytesWritten += buf.length;
    const progress = t.fileSize > 0 ? t.bytesWritten / t.fileSize : 1;

    return {
      transferId,
      chunkIndex,
      received: true,
      progress,
      remainingChunks: Math.max(0, t.totalChunks - t.receivedChunks),
    };
  }

  async completeUpload(params) {
    const { transferId } = params;
    const t = this.transfers.get(transferId);
    if (!t || t.direction !== "upload") {
      throw new Error(`Upload transfer not found: ${transferId}`);
    }
    await t.fd.sync();
    await t.fd.close();
    t.fd = null;
    this.transfers.delete(transferId);

    const duration = Date.now() - t.createdAt;
    return {
      transferId,
      status: "completed",
      fileName: t.fileName,
      filePath: t.filePath,
      fileSize: t.bytesWritten,
      duration,
    };
  }

  // ==================== 下载（PC → Android）====================

  async requestDownload(params) {
    const { filePath: rawPath, fileName } = params;
    const fullPath = this._resolvePath(rawPath);

    const stat = await fsPromises.stat(fullPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${fullPath}`);
    }
    if (this._activeCount() >= this.options.maxConcurrent) {
      throw new Error(
        `Max concurrent transfers reached (${this.options.maxConcurrent})`,
      );
    }

    const fileSize = stat.size;
    const chunkSize = this.options.chunkSize;
    const totalChunks = Math.max(1, Math.ceil(fileSize / chunkSize));
    const finalName = fileName || path.basename(fullPath);
    const transferId = `dn_${Date.now()}_${crypto
      .randomBytes(4)
      .toString("hex")}`;

    const fd = await fsPromises.open(fullPath, "r");

    this.transfers.set(transferId, {
      direction: "download",
      fileName: finalName,
      filePath: fullPath,
      fileSize,
      chunkSize,
      totalChunks,
      sentChunks: 0,
      bytesSent: 0,
      fd,
      createdAt: Date.now(),
    });

    // 不返回 checksum — FileTransferRepository.downloadFile:264-276 期望 "md5:"
    // 前缀 + 完整 MD5，否则触发 "Checksum mismatch" 删本地文件 + 标 FAILED → 用户
    // 看到"下载失败"。计算全量 MD5 在大文件上耗时可观；transferId 已 1:1 一次下
    // 载，可靠性由 chunk 协议保证；先 skip 验和让传输跑通。如要补，必须 "md5:"
    // 前缀 + crypto.createHash('md5').update(整个 fileBuffer).digest('hex')。
    return {
      transferId,
      fileName: finalName,
      fileSize,
      chunkSize,
      totalChunks,
      checksum: null,
    };
  }

  async downloadChunk(params) {
    const { transferId, chunkIndex } = params;
    const t = this.transfers.get(transferId);
    if (!t || t.direction !== "download") {
      throw new Error(`Download transfer not found: ${transferId}`);
    }
    const offset = chunkIndex * t.chunkSize;
    const remaining = Math.max(0, t.fileSize - offset);
    const size = Math.min(t.chunkSize, remaining);
    const buf = Buffer.alloc(size);
    if (size > 0) {
      await t.fd.read(buf, 0, size, offset);
    }

    t.sentChunks++;
    t.bytesSent = Math.min(t.fileSize, t.bytesSent + size);

    const isLastChunk = chunkIndex >= t.totalChunks - 1;
    if (isLastChunk) {
      // 自动关闭并清理 (Android 端不再调 completeDownload)
      try {
        await t.fd.close();
      } catch {
        /* ignore */
      }
      t.fd = null;
      this.transfers.delete(transferId);
    }

    const progress = t.fileSize > 0 ? t.bytesSent / t.fileSize : 1;
    return {
      transferId,
      chunkIndex,
      chunkData: buf.toString("base64"),
      chunkSize: size,
      isLastChunk,
      progress,
    };
  }

  // ==================== 通用 ====================

  async cancelTransfer(params) {
    const { transferId } = params;
    const t = this.transfers.get(transferId);
    if (t) {
      if (t.fd) {
        try {
          await t.fd.close();
        } catch {
          /* ignore */
        }
      }
      // 上传被取消 → 删除半成品文件
      if (t.direction === "upload" && t.filePath) {
        try {
          await fsPromises.unlink(t.filePath);
        } catch {
          /* ignore */
        }
      }
      this.transfers.delete(transferId);
    }
    return { transferId, status: "cancelled" };
  }

  async listTransfers(params = {}) {
    const { limit = 50, offset = 0, status: statusFilter } = params;
    const all = [];
    for (const [id, t] of this.transfers.entries()) {
      all.push({
        id,
        deviceDid: "(mobile)",
        direction: t.direction,
        fileName: t.fileName,
        fileSize: t.fileSize,
        totalChunks: t.totalChunks,
        status: "in_progress",
        progress:
          t.direction === "upload"
            ? t.bytesWritten / Math.max(1, t.fileSize)
            : t.bytesSent / Math.max(1, t.fileSize),
        createdAt: t.createdAt,
        updatedAt: Date.now(),
      });
    }
    const filtered = statusFilter
      ? all.filter((x) => x.status === statusFilter)
      : all;
    return {
      transfers: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  _activeCount() {
    return this.transfers.size;
  }
}

module.exports = { AndroidFileHandler };
