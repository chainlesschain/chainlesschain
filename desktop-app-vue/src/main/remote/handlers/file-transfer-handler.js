/**
 * 文件传输命令处理器
 *
 * 处理文件传输相关命令：
 * - file.requestUpload: 请求上传文件（Android → PC）
 * - file.uploadChunk: 上传文件分块
 * - file.completeUpload: 完成上传
 * - file.requestDownload: 请求下载文件（PC → Android）
 * - file.downloadChunk: 下载文件分块
 * - file.cancelTransfer: 取消传输
 * - file.listTransfers: 列出传输任务
 *
 * @module remote/handlers/file-transfer-handler
 */

const { logger } = require("../../utils/logger");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const { app } = require("electron");

// 默认配置
const DEFAULT_CONFIG = {
  chunkSize: 256 * 1024, // 256KB per chunk
  maxConcurrent: 3, // 最多同时传输 3 个文件
  uploadDir: null, // 上传目录（默认为 userData/uploads）
  downloadDir: null, // 下载目录（默认为 userData/downloads）
  tempDir: null, // 临时目录（默认为 userData/temp）
  maxFileSize: 500 * 1024 * 1024, // 最大文件大小 500MB
  enableResume: true, // 启用断点续传
  verifyChecksum: true, // 启用校验和验证
};

/**
 * 文件传输命令处理器类
 */
class FileTransferHandler {
  constructor(database, options = {}) {
    this.database = database;
    this.options = { ...DEFAULT_CONFIG, ...options };

    // 初始化目录
    this.uploadDir =
      this.options.uploadDir || path.join(app.getPath("userData"), "uploads");
    this.downloadDir =
      this.options.downloadDir ||
      path.join(app.getPath("userData"), "downloads");
    this.tempDir =
      this.options.tempDir || path.join(app.getPath("userData"), "temp");

    // 传输任务映射 { transferId: TransferTask }
    this.transfers = new Map();

    // 活动传输计数
    this.activeTransfers = 0;

    logger.info("[FileTransferHandler] 文件传输处理器已初始化", {
      uploadDir: this.uploadDir,
      downloadDir: this.downloadDir,
      tempDir: this.tempDir,
      chunkSize: this.options.chunkSize,
    });

    // 确保目录存在
    this._ensureDirectories().catch((err) => {
      logger.error("[FileTransferHandler] 创建目录失败:", err);
    });
  }

  /**
   * 确保必要的目录存在
   */
  async _ensureDirectories() {
    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.mkdir(this.downloadDir, { recursive: true });
    await fs.mkdir(this.tempDir, { recursive: true });
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[FileTransferHandler] 处理命令: ${action}`);

    switch (action) {
      case "requestUpload":
        return await this.requestUpload(params, context);

      case "uploadChunk":
        return await this.uploadChunk(params, context);

      case "completeUpload":
        return await this.completeUpload(params, context);

      case "requestDownload":
        return await this.requestDownload(params, context);

      case "downloadChunk":
        return await this.downloadChunk(params, context);

      case "cancelTransfer":
        return await this.cancelTransfer(params, context);

      case "listTransfers":
        return await this.listTransfers(params, context);

      // 基本文件操作
      case "read":
        return await this.readFile(params, context);

      case "write":
        return await this.writeFile(params, context);

      case "list":
        return await this.listDirectory(params, context);

      case "delete":
        return await this.deleteFile(params, context);

      case "move":
        return await this.moveFile(params, context);

      case "copy":
        return await this.copyFile(params, context);

      case "stat":
        return await this.getFileStats(params, context);

      case "exists":
        return await this.fileExists(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 请求上传文件（Android → PC）
   */
  async requestUpload(params, context) {
    const { fileName, fileSize, checksum, metadata = {} } = params;

    // 验证参数
    if (!fileName || typeof fileName !== "string") {
      throw new Error('Parameter "fileName" is required and must be a string');
    }

    if (!fileSize || typeof fileSize !== "number" || fileSize <= 0) {
      throw new Error(
        'Parameter "fileSize" is required and must be a positive number',
      );
    }

    // 检查文件大小限制
    if (fileSize > this.options.maxFileSize) {
      throw new Error(
        `File size ${fileSize} exceeds maximum allowed size ${this.options.maxFileSize}`,
      );
    }

    // 检查并发传输限制
    if (this.activeTransfers >= this.options.maxConcurrent) {
      throw new Error(
        `Maximum concurrent transfers (${this.options.maxConcurrent}) reached. Please try again later.`,
      );
    }

    logger.info(
      `[FileTransferHandler] 请求上传文件: ${fileName} (${fileSize} bytes) from ${context.did}`,
    );

    // 生成传输 ID
    const transferId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 计算总分块数
    const totalChunks = Math.ceil(fileSize / this.options.chunkSize);

    // 临时文件路径
    const tempFilePath = path.join(this.tempDir, `${transferId}.tmp`);

    // 最终文件路径
    const finalFilePath = path.join(this.uploadDir, fileName);

    // 创建传输任务
    const transfer = {
      transferId,
      direction: "upload",
      deviceDid: context.did,
      fileName,
      fileSize,
      checksum,
      chunkSize: this.options.chunkSize,
      totalChunks,
      receivedChunks: new Set(),
      tempFilePath,
      finalFilePath,
      status: "in_progress",
      progress: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      metadata,
    };

    this.transfers.set(transferId, transfer);
    this.activeTransfers++;

    // 保存到数据库
    try {
      this.database
        .prepare(
          `
          INSERT INTO file_transfers
          (id, device_did, direction, file_name, file_size, total_chunks, status, progress, created_at, updated_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          transferId,
          context.did,
          "upload",
          fileName,
          fileSize,
          totalChunks,
          "in_progress",
          0,
          Date.now(),
          Date.now(),
          JSON.stringify(metadata),
        );
    } catch (error) {
      logger.error("[FileTransferHandler] 保存传输任务到数据库失败:", error);
      // 继续执行，数据库错误不应阻止传输
    }

    // 创建临时文件（预分配空间）
    try {
      const fd = await fs.open(tempFilePath, "w");
      await fd.truncate(fileSize);
      await fd.close();
    } catch (error) {
      logger.error("[FileTransferHandler] 创建临时文件失败:", error);
      this.transfers.delete(transferId);
      this.activeTransfers--;
      throw new Error(`Failed to create temporary file: ${error.message}`);
    }

    return {
      transferId,
      chunkSize: this.options.chunkSize,
      totalChunks,
      resumeSupported: this.options.enableResume,
    };
  }

  /**
   * 上传文件分块
   */
  async uploadChunk(params, context) {
    const { transferId, chunkIndex, chunkData } = params;

    // 验证参数
    if (!transferId || typeof transferId !== "string") {
      throw new Error(
        'Parameter "transferId" is required and must be a string',
      );
    }

    if (typeof chunkIndex !== "number" || chunkIndex < 0) {
      throw new Error(
        'Parameter "chunkIndex" is required and must be a non-negative number',
      );
    }

    if (!chunkData || typeof chunkData !== "string") {
      throw new Error(
        'Parameter "chunkData" is required and must be a base64 string',
      );
    }

    // 获取传输任务
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    // 验证设备
    if (transfer.deviceDid !== context.did) {
      throw new Error("Permission denied: device DID mismatch");
    }

    // 验证分块索引
    if (chunkIndex >= transfer.totalChunks) {
      throw new Error(
        `Invalid chunk index: ${chunkIndex} (total: ${transfer.totalChunks})`,
      );
    }

    // 检查是否已接收
    if (transfer.receivedChunks.has(chunkIndex)) {
      logger.warn(`[FileTransferHandler] 分块 ${chunkIndex} 已接收，跳过`);
      return {
        transferId,
        chunkIndex,
        received: true,
        progress: transfer.progress,
      };
    }

    logger.debug(
      `[FileTransferHandler] 接收分块 ${chunkIndex}/${transfer.totalChunks - 1} for ${transferId}`,
    );

    try {
      // 解码 base64 数据
      const buffer = Buffer.from(chunkData, "base64");

      // 计算分块偏移量
      const offset = chunkIndex * transfer.chunkSize;

      // 写入临时文件
      const fd = await fs.open(transfer.tempFilePath, "r+");
      await fd.write(buffer, 0, buffer.length, offset);
      await fd.close();

      // 标记分块已接收
      transfer.receivedChunks.add(chunkIndex);
      transfer.updatedAt = Date.now();

      // 更新进度
      transfer.progress =
        (transfer.receivedChunks.size / transfer.totalChunks) * 100;

      // 更新数据库
      try {
        this.database
          .prepare(
            `
            UPDATE file_transfers
            SET progress = ?, updated_at = ?
            WHERE id = ?
          `,
          )
          .run(transfer.progress, transfer.updatedAt, transferId);
      } catch (error) {
        logger.error("[FileTransferHandler] 更新数据库失败:", error);
      }

      return {
        transferId,
        chunkIndex,
        received: true,
        progress: transfer.progress,
        remainingChunks: transfer.totalChunks - transfer.receivedChunks.size,
      };
    } catch (error) {
      logger.error(`[FileTransferHandler] 写入分块 ${chunkIndex} 失败:`, error);
      throw new Error(`Failed to write chunk: ${error.message}`);
    }
  }

  /**
   * 完成上传
   */
  async completeUpload(params, context) {
    const { transferId } = params;

    // 验证参数
    if (!transferId || typeof transferId !== "string") {
      throw new Error(
        'Parameter "transferId" is required and must be a string',
      );
    }

    // 获取传输任务
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    // 验证设备
    if (transfer.deviceDid !== context.did) {
      throw new Error("Permission denied: device DID mismatch");
    }

    logger.info(
      `[FileTransferHandler] 完成上传: ${transferId} (${transfer.fileName})`,
    );

    // 检查是否所有分块都已接收
    if (transfer.receivedChunks.size !== transfer.totalChunks) {
      throw new Error(
        `Incomplete transfer: received ${transfer.receivedChunks.size}/${transfer.totalChunks} chunks`,
      );
    }

    try {
      // 验证校验和（如果提供）
      if (this.options.verifyChecksum && transfer.checksum) {
        const actualChecksum = await this._calculateChecksum(
          transfer.tempFilePath,
        );

        if (actualChecksum !== transfer.checksum) {
          throw new Error(
            `Checksum mismatch: expected ${transfer.checksum}, got ${actualChecksum}`,
          );
        }

        logger.info("[FileTransferHandler] 校验和验证通过");
      }

      // 移动临时文件到最终位置
      await fs.rename(transfer.tempFilePath, transfer.finalFilePath);

      // 更新传输状态
      transfer.status = "completed";
      transfer.progress = 100;
      transfer.completedAt = Date.now();
      transfer.updatedAt = Date.now();

      // 更新数据库
      try {
        this.database
          .prepare(
            `
            UPDATE file_transfers
            SET status = ?, progress = ?, updated_at = ?, completed_at = ?
            WHERE id = ?
          `,
          )
          .run(
            transfer.status,
            transfer.progress,
            transfer.updatedAt,
            transfer.completedAt,
            transferId,
          );
      } catch (error) {
        logger.error("[FileTransferHandler] 更新数据库失败:", error);
      }

      // 清理任务
      this.transfers.delete(transferId);
      this.activeTransfers--;

      logger.info(
        `[FileTransferHandler] 上传完成: ${transfer.fileName} saved to ${transfer.finalFilePath}`,
      );

      return {
        transferId,
        status: "completed",
        fileName: transfer.fileName,
        filePath: transfer.finalFilePath,
        fileSize: transfer.fileSize,
        duration: transfer.completedAt - transfer.startedAt,
      };
    } catch (error) {
      logger.error("[FileTransferHandler] 完成上传失败:", error);

      // 更新为失败状态
      transfer.status = "failed";
      transfer.error = error.message;
      transfer.updatedAt = Date.now();

      try {
        this.database
          .prepare(
            `
            UPDATE file_transfers
            SET status = ?, error = ?, updated_at = ?
            WHERE id = ?
          `,
          )
          .run(transfer.status, transfer.error, transfer.updatedAt, transferId);
      } catch (dbError) {
        logger.error("[FileTransferHandler] 更新数据库失败:", dbError);
      }

      // 清理任务
      this.transfers.delete(transferId);
      this.activeTransfers--;

      throw new Error(`Failed to complete upload: ${error.message}`);
    }
  }

  /**
   * 请求下载文件（PC → Android）
   */
  async requestDownload(params, context) {
    const { filePath, fileName } = params;

    // 验证参数
    if (!filePath || typeof filePath !== "string") {
      throw new Error('Parameter "filePath" is required and must be a string');
    }

    // 安全检查：确保文件在允许的目录内
    const resolvedPath = path.resolve(filePath);
    const allowedDirs = [this.uploadDir, this.downloadDir];
    const isAllowed = allowedDirs.some((dir) =>
      resolvedPath.startsWith(path.resolve(dir)),
    );

    if (!isAllowed) {
      throw new Error(
        "Access denied: file path is outside allowed directories",
      );
    }

    // 检查文件是否存在
    try {
      const stats = await fs.stat(resolvedPath);

      if (!stats.isFile()) {
        throw new Error("Path is not a file");
      }

      const fileSize = stats.size;

      // 检查文件大小限制
      if (fileSize > this.options.maxFileSize) {
        throw new Error(
          `File size ${fileSize} exceeds maximum allowed size ${this.options.maxFileSize}`,
        );
      }

      // 检查并发传输限制
      if (this.activeTransfers >= this.options.maxConcurrent) {
        throw new Error(
          `Maximum concurrent transfers (${this.options.maxConcurrent}) reached. Please try again later.`,
        );
      }

      logger.info(
        `[FileTransferHandler] 请求下载文件: ${filePath} (${fileSize} bytes) to ${context.did}`,
      );

      // 生成传输 ID
      const transferId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // 计算总分块数
      const totalChunks = Math.ceil(fileSize / this.options.chunkSize);

      // 计算校验和（如果启用）
      let checksum = null;
      if (this.options.verifyChecksum) {
        checksum = await this._calculateChecksum(resolvedPath);
      }

      // 创建传输任务
      const transfer = {
        transferId,
        direction: "download",
        deviceDid: context.did,
        fileName: fileName || path.basename(resolvedPath),
        filePath: resolvedPath,
        fileSize,
        checksum,
        chunkSize: this.options.chunkSize,
        totalChunks,
        sentChunks: new Set(),
        status: "in_progress",
        progress: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.transfers.set(transferId, transfer);
      this.activeTransfers++;

      // 保存到数据库
      try {
        this.database
          .prepare(
            `
            INSERT INTO file_transfers
            (id, device_did, direction, file_name, file_size, total_chunks, status, progress, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          )
          .run(
            transferId,
            context.did,
            "download",
            transfer.fileName,
            fileSize,
            totalChunks,
            "in_progress",
            0,
            Date.now(),
            Date.now(),
          );
      } catch (error) {
        logger.error("[FileTransferHandler] 保存传输任务到数据库失败:", error);
      }

      return {
        transferId,
        fileName: transfer.fileName,
        fileSize,
        chunkSize: this.options.chunkSize,
        totalChunks,
        checksum,
      };
    } catch (error) {
      logger.error("[FileTransferHandler] 请求下载失败:", error);
      throw new Error(`Failed to request download: ${error.message}`);
    }
  }

  /**
   * 下载文件分块（PC → Android）
   */
  async downloadChunk(params, context) {
    const { transferId, chunkIndex } = params;

    // 验证参数
    if (!transferId || typeof transferId !== "string") {
      throw new Error(
        'Parameter "transferId" is required and must be a string',
      );
    }

    if (typeof chunkIndex !== "number" || chunkIndex < 0) {
      throw new Error(
        'Parameter "chunkIndex" is required and must be a non-negative number',
      );
    }

    // 获取传输任务
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    // 验证设备
    if (transfer.deviceDid !== context.did) {
      throw new Error("Permission denied: device DID mismatch");
    }

    // 验证分块索引
    if (chunkIndex >= transfer.totalChunks) {
      throw new Error(
        `Invalid chunk index: ${chunkIndex} (total: ${transfer.totalChunks})`,
      );
    }

    logger.debug(
      `[FileTransferHandler] 发送分块 ${chunkIndex}/${transfer.totalChunks - 1} for ${transferId}`,
    );

    try {
      // 计算分块偏移量和大小
      const offset = chunkIndex * transfer.chunkSize;
      const isLastChunk = chunkIndex === transfer.totalChunks - 1;
      const chunkSize = isLastChunk
        ? transfer.fileSize - offset
        : transfer.chunkSize;

      // 读取文件分块
      const fd = await fs.open(transfer.filePath, "r");
      const buffer = Buffer.allocUnsafe(chunkSize);
      await fd.read(buffer, 0, chunkSize, offset);
      await fd.close();

      // 编码为 base64
      const chunkData = buffer.toString("base64");

      // 标记分块已发送
      transfer.sentChunks.add(chunkIndex);
      transfer.updatedAt = Date.now();

      // 更新进度
      transfer.progress =
        (transfer.sentChunks.size / transfer.totalChunks) * 100;

      // 更新数据库
      try {
        this.database
          .prepare(
            `
            UPDATE file_transfers
            SET progress = ?, updated_at = ?
            WHERE id = ?
          `,
          )
          .run(transfer.progress, transfer.updatedAt, transferId);
      } catch (error) {
        logger.error("[FileTransferHandler] 更新数据库失败:", error);
      }

      return {
        transferId,
        chunkIndex,
        chunkData,
        chunkSize,
        isLastChunk,
        progress: transfer.progress,
      };
    } catch (error) {
      logger.error(`[FileTransferHandler] 读取分块 ${chunkIndex} 失败:`, error);
      throw new Error(`Failed to read chunk: ${error.message}`);
    }
  }

  /**
   * 取消传输
   */
  async cancelTransfer(params, context) {
    const { transferId } = params;

    // 验证参数
    if (!transferId || typeof transferId !== "string") {
      throw new Error(
        'Parameter "transferId" is required and must be a string',
      );
    }

    // 获取传输任务
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      throw new Error(`Transfer not found: ${transferId}`);
    }

    // 验证设备
    if (transfer.deviceDid !== context.did) {
      throw new Error("Permission denied: device DID mismatch");
    }

    logger.info(`[FileTransferHandler] 取消传输: ${transferId}`);

    // 更新传输状态
    transfer.status = "cancelled";
    transfer.updatedAt = Date.now();

    // 更新数据库
    try {
      this.database
        .prepare(
          `
          UPDATE file_transfers
          SET status = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(transfer.status, transfer.updatedAt, transferId);
    } catch (error) {
      logger.error("[FileTransferHandler] 更新数据库失败:", error);
    }

    // 清理临时文件（仅上传）
    if (transfer.direction === "upload" && transfer.tempFilePath) {
      try {
        await fs.unlink(transfer.tempFilePath);
      } catch (error) {
        logger.warn("[FileTransferHandler] 删除临时文件失败:", error);
      }
    }

    // 清理任务
    this.transfers.delete(transferId);
    this.activeTransfers--;

    return {
      transferId,
      status: "cancelled",
    };
  }

  /**
   * 列出传输任务
   */
  async listTransfers(params, context) {
    const { status, limit = 50, offset = 0 } = params;

    logger.debug(`[FileTransferHandler] 列出传输任务 for ${context.did}`);

    try {
      let query = `
        SELECT id, device_did, direction, file_name, file_size, total_chunks, status, progress, created_at, updated_at, completed_at, error
        FROM file_transfers
        WHERE device_did = ?
      `;
      const queryParams = [context.did];

      // 按状态过滤
      if (status) {
        query += ` AND status = ?`;
        queryParams.push(status);
      }

      // 排序和分页
      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);

      const transfers = this.database.prepare(query).all(...queryParams);

      // 解析 metadata
      transfers.forEach((transfer) => {
        if (transfer.metadata) {
          try {
            transfer.metadata = JSON.parse(transfer.metadata);
          } catch (error) {
            logger.warn("[FileTransferHandler] 解析 metadata 失败:", error);
            transfer.metadata = {};
          }
        }
      });

      return {
        transfers,
        total: transfers.length,
        limit,
        offset,
      };
    } catch (error) {
      logger.error("[FileTransferHandler] 列出传输任务失败:", error);
      throw new Error(`Failed to list transfers: ${error.message}`);
    }
  }

  /**
   * 计算文件校验和（MD5）
   */
  async _calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = require("fs").createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * 清理过期传输任务（可定期调用）
   */
  async cleanupExpiredTransfers(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [transferId, transfer] of this.transfers.entries()) {
      if (now - transfer.updatedAt > maxAge) {
        logger.info(`[FileTransferHandler] 清理过期传输: ${transferId}`);

        // 清理临时文件
        if (transfer.direction === "upload" && transfer.tempFilePath) {
          try {
            await fs.unlink(transfer.tempFilePath);
          } catch (error) {
            logger.warn("[FileTransferHandler] 删除临时文件失败:", error);
          }
        }

        // 更新数据库
        try {
          this.database
            .prepare(
              `
              UPDATE file_transfers
              SET status = 'expired', updated_at = ?
              WHERE id = ?
            `,
            )
            .run(now, transferId);
        } catch (error) {
          logger.error("[FileTransferHandler] 更新数据库失败:", error);
        }

        this.transfers.delete(transferId);
        this.activeTransfers--;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`[FileTransferHandler] 清理了 ${cleaned} 个过期传输任务`);
    }

    return cleaned;
  }

  /**
   * 读取文件内容
   */
  async readFile(params, context) {
    const { filePath, encoding = "utf8" } = params;
    if (!filePath) {
      throw new Error("File path is required");
    }

    logger.info(`[FileTransferHandler] 读取文件: ${filePath}`);

    const fullPath = this._resolvePath(filePath);
    const stats = await fs.stat(fullPath);

    if (!stats.isFile()) {
      throw new Error("Path is not a file");
    }

    const content = await fs.readFile(fullPath, encoding);

    return {
      filePath,
      content,
      size: stats.size,
      encoding,
    };
  }

  /**
   * 写入文件内容
   */
  async writeFile(params, context) {
    const { filePath, content, encoding = "utf8", createDir = false } = params;
    if (!filePath) {
      throw new Error("File path is required");
    }
    if (content === undefined) {
      throw new Error("Content is required");
    }

    logger.info(`[FileTransferHandler] 写入文件: ${filePath}`);

    const fullPath = this._resolvePath(filePath);

    if (createDir) {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
    }

    await fs.writeFile(fullPath, content, encoding);

    const stats = await fs.stat(fullPath);

    return {
      filePath,
      size: stats.size,
      message: "File written successfully",
    };
  }

  /**
   * 列出目录内容
   */
  async listDirectory(params, context) {
    const { dirPath = ".", recursive = false, filter = null } = params;

    logger.info(`[FileTransferHandler] 列出目录: ${dirPath}`);

    const fullPath = this._resolvePath(dirPath);
    const stats = await fs.stat(fullPath);

    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const items = await fs.readdir(fullPath, { withFileTypes: true });
    const results = [];

    for (const item of items) {
      const itemPath = path.join(fullPath, item.name);
      const itemStats = await fs.stat(itemPath);

      const fileInfo = {
        name: item.name,
        path: path.relative(this._getBasePath(), itemPath),
        isDirectory: item.isDirectory(),
        isFile: item.isFile(),
        size: itemStats.size,
        createdAt: itemStats.birthtime.getTime(),
        modifiedAt: itemStats.mtime.getTime(),
      };

      // 应用过滤器
      if (filter && !item.name.includes(filter)) {
        continue;
      }

      results.push(fileInfo);

      // 递归列出子目录
      if (recursive && item.isDirectory()) {
        const subItems = await this.listDirectory(
          { dirPath: path.join(dirPath, item.name), recursive: true, filter },
          context,
        );
        results.push(...subItems.items);
      }
    }

    return {
      dirPath,
      items: results,
      total: results.length,
    };
  }

  /**
   * 删除文件或目录
   */
  async deleteFile(params, context) {
    const { filePath, recursive = false } = params;
    if (!filePath) {
      throw new Error("File path is required");
    }

    logger.info(`[FileTransferHandler] 删除文件: ${filePath}`);

    const fullPath = this._resolvePath(filePath);
    const stats = await fs.stat(fullPath);

    if (stats.isDirectory()) {
      if (!recursive) {
        throw new Error("Cannot delete directory without recursive flag");
      }
      await fs.rm(fullPath, { recursive: true, force: true });
    } else {
      await fs.unlink(fullPath);
    }

    return {
      filePath,
      message: "File deleted successfully",
    };
  }

  /**
   * 移动文件
   */
  async moveFile(params, context) {
    const { sourcePath, targetPath, overwrite = false } = params;
    if (!sourcePath || !targetPath) {
      throw new Error("Source and target paths are required");
    }

    logger.info(
      `[FileTransferHandler] 移动文件: ${sourcePath} -> ${targetPath}`,
    );

    const fullSourcePath = this._resolvePath(sourcePath);
    const fullTargetPath = this._resolvePath(targetPath);

    if (!overwrite) {
      try {
        await fs.access(fullTargetPath);
        throw new Error("Target file already exists");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    await fs.rename(fullSourcePath, fullTargetPath);

    return {
      sourcePath,
      targetPath,
      message: "File moved successfully",
    };
  }

  /**
   * 复制文件
   */
  async copyFile(params, context) {
    const { sourcePath, targetPath, overwrite = false } = params;
    if (!sourcePath || !targetPath) {
      throw new Error("Source and target paths are required");
    }

    logger.info(
      `[FileTransferHandler] 复制文件: ${sourcePath} -> ${targetPath}`,
    );

    const fullSourcePath = this._resolvePath(sourcePath);
    const fullTargetPath = this._resolvePath(targetPath);

    if (!overwrite) {
      try {
        await fs.access(fullTargetPath);
        throw new Error("Target file already exists");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    await fs.copyFile(fullSourcePath, fullTargetPath);

    const stats = await fs.stat(fullTargetPath);

    return {
      sourcePath,
      targetPath,
      size: stats.size,
      message: "File copied successfully",
    };
  }

  /**
   * 获取文件统计信息
   */
  async getFileStats(params, context) {
    const { filePath } = params;
    if (!filePath) {
      throw new Error("File path is required");
    }

    const fullPath = this._resolvePath(filePath);
    const stats = await fs.stat(fullPath);

    return {
      filePath,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      size: stats.size,
      createdAt: stats.birthtime.getTime(),
      modifiedAt: stats.mtime.getTime(),
      accessedAt: stats.atime.getTime(),
    };
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(params, context) {
    const { filePath } = params;
    if (!filePath) {
      throw new Error("File path is required");
    }

    const fullPath = this._resolvePath(filePath);

    try {
      await fs.access(fullPath);
      return { filePath, exists: true };
    } catch (error) {
      return { filePath, exists: false };
    }
  }

  /**
   * 解析文件路径（安全性检查）
   */
  _resolvePath(filePath) {
    const basePath = this._getBasePath();
    const resolvedPath = path.resolve(basePath, filePath);

    // 确保路径在允许的基础路径内（防止路径遍历攻击）
    if (!resolvedPath.startsWith(basePath)) {
      throw new Error("Access denied: Path outside allowed directory");
    }

    return resolvedPath;
  }

  /**
   * 获取基础路径
   */
  _getBasePath() {
    return app.getPath("userData");
  }
}

module.exports = { FileTransferHandler };
