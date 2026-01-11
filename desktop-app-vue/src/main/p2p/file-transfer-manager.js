/**
 * 文件传输管理器 - 支持大文件分块传输和断点续传
 *
 * 功能：
 * - 大文件分块传输
 * - 断点续传
 * - 传输进度跟踪
 * - 传输速度计算
 * - 文件完整性校验
 * - 并发传输控制
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

class FileTransferManager extends EventEmitter {
  constructor(messageManager, options = {}) {
    super();

    this.messageManager = messageManager;

    this.options = {
      // 分块配置
      chunkSize: options.chunkSize || 64 * 1024,        // 64KB per chunk
      maxConcurrentChunks: options.maxConcurrentChunks || 3,

      // 断点续传
      enableResume: options.enableResume !== false,
      resumeCheckInterval: options.resumeCheckInterval || 5000,

      // 传输配置
      timeout: options.timeout || 30000,
      maxRetries: options.maxRetries || 3,

      // 临时目录
      tempDir: options.tempDir || path.join(process.cwd(), '.temp'),

      ...options
    };

    // 传输任务
    this.uploads = new Map();    // transferId -> UploadTask
    this.downloads = new Map();  // transferId -> DownloadTask

    // 传输队列
    this.uploadQueue = [];
    this.downloadQueue = [];

    // 统计信息
    this.stats = {
      totalUploads: 0,
      totalDownloads: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      failedTransfers: 0
    };

    // 确保临时目录存在
    this.ensureTempDir();

    // 监听消息
    this.setupMessageHandlers();
  }

  /**
   * 上传文件
   * @param {string} peerId - 目标节点ID
   * @param {string} filePath - 文件路径
   * @param {Object} options - 上传选项
   */
  async uploadFile(peerId, filePath, options = {}) {
    console.log('[FileTransfer] 开始上传文件:', filePath);

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      throw new Error('文件不存在');
    }

    // 获取文件信息
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    const fileName = path.basename(filePath);

    // 生成传输ID
    const transferId = this.generateTransferId();

    // 计算文件哈希
    const fileHash = await this.calculateFileHash(filePath);

    // 计算分块数量
    const totalChunks = Math.ceil(fileSize / this.options.chunkSize);

    // 创建上传任务
    const uploadTask = {
      transferId,
      peerId,
      filePath,
      fileName,
      fileSize,
      fileHash,
      totalChunks,
      uploadedChunks: new Set(),
      startTime: Date.now(),
      bytesUploaded: 0,
      status: 'pending',
      retries: 0
    };

    this.uploads.set(transferId, uploadTask);

    try {
      // 发送传输请求
      await this.sendTransferRequest(peerId, {
        transferId,
        fileName,
        fileSize,
        fileHash,
        totalChunks,
        chunkSize: this.options.chunkSize
      });

      // 等待接收方确认
      await this.waitForTransferAccept(transferId);

      // 开始上传分块
      uploadTask.status = 'uploading';
      await this.uploadChunks(uploadTask);

      // 等待传输完成确认
      await this.waitForTransferComplete(transferId);

      uploadTask.status = 'completed';
      uploadTask.endTime = Date.now();

      console.log('[FileTransfer] ✅ 文件上传完成:', fileName);

      this.emit('upload:completed', {
        transferId,
        fileName,
        fileSize,
        duration: uploadTask.endTime - uploadTask.startTime
      });

      this.stats.totalUploads++;
      this.stats.bytesUploaded += fileSize;

      return transferId;

    } catch (error) {
      console.error('[FileTransfer] ❌ 文件上传失败:', error);

      uploadTask.status = 'failed';
      uploadTask.error = error.message;

      this.emit('upload:failed', {
        transferId,
        fileName,
        error
      });

      this.stats.failedTransfers++;

      throw error;

    } finally {
      // 清理（可选，保留用于断点续传）
      if (uploadTask.status === 'completed' || !this.options.enableResume) {
        this.uploads.delete(transferId);
      }
    }
  }

  /**
   * 下载文件
   * @param {string} peerId - 源节点ID
   * @param {string} transferId - 传输ID
   * @param {string} savePath - 保存路径
   */
  async downloadFile(peerId, transferId, savePath) {
    console.log('[FileTransfer] 开始下载文件:', transferId);

    const downloadTask = this.downloads.get(transferId);
    if (!downloadTask) {
      throw new Error('下载任务不存在');
    }

    try {
      downloadTask.status = 'downloading';
      downloadTask.savePath = savePath;
      downloadTask.startTime = Date.now();

      // 创建临时文件
      const tempPath = path.join(this.options.tempDir, `${transferId}.tmp`);
      downloadTask.tempPath = tempPath;

      // 请求缺失的分块
      await this.requestMissingChunks(downloadTask);

      // 等待所有分块接收完成
      await this.waitForAllChunks(downloadTask);

      // 组装文件
      await this.assembleFile(downloadTask);

      // 验证文件完整性
      const isValid = await this.verifyFile(downloadTask);
      if (!isValid) {
        throw new Error('文件完整性校验失败');
      }

      // 移动到最终位置
      fs.renameSync(tempPath, savePath);

      downloadTask.status = 'completed';
      downloadTask.endTime = Date.now();

      console.log('[FileTransfer] ✅ 文件下载完成:', downloadTask.fileName);

      this.emit('download:completed', {
        transferId,
        fileName: downloadTask.fileName,
        fileSize: downloadTask.fileSize,
        duration: downloadTask.endTime - downloadTask.startTime
      });

      this.stats.totalDownloads++;
      this.stats.bytesDownloaded += downloadTask.fileSize;

      return savePath;

    } catch (error) {
      console.error('[FileTransfer] ❌ 文件下载失败:', error);

      downloadTask.status = 'failed';
      downloadTask.error = error.message;

      this.emit('download:failed', {
        transferId,
        fileName: downloadTask.fileName,
        error
      });

      this.stats.failedTransfers++;

      throw error;

    } finally {
      // 清理临时文件
      if (downloadTask.tempPath && fs.existsSync(downloadTask.tempPath)) {
        if (downloadTask.status === 'completed' || !this.options.enableResume) {
          fs.unlinkSync(downloadTask.tempPath);
        }
      }

      if (downloadTask.status === 'completed' || !this.options.enableResume) {
        this.downloads.delete(transferId);
      }
    }
  }

  /**
   * 上传分块
   */
  async uploadChunks(uploadTask) {
    const { transferId, filePath, totalChunks, uploadedChunks } = uploadTask;

    // 读取文件
    const fileStream = fs.createReadStream(filePath, {
      highWaterMark: this.options.chunkSize
    });

    let chunkIndex = 0;
    const activeChunks = new Set();

    return new Promise((resolve, reject) => {
      fileStream.on('data', async (chunk) => {
        // 如果已上传，跳过
        if (uploadedChunks.has(chunkIndex)) {
          chunkIndex++;
          return;
        }

        // 控制并发
        while (activeChunks.size >= this.options.maxConcurrentChunks) {
          await new Promise(r => setTimeout(r, 100));
        }

        const currentIndex = chunkIndex++;
        activeChunks.add(currentIndex);

        // 暂停流
        fileStream.pause();

        try {
          // 发送分块
          await this.sendChunk(uploadTask, currentIndex, chunk);

          uploadedChunks.add(currentIndex);
          uploadTask.bytesUploaded += chunk.length;

          // 更新进度
          this.emit('upload:progress', {
            transferId,
            progress: uploadedChunks.size / totalChunks,
            bytesUploaded: uploadTask.bytesUploaded,
            totalBytes: uploadTask.fileSize
          });

        } catch (error) {
          console.error('[FileTransfer] 发送分块失败:', error);
          reject(error);
          return;
        } finally {
          activeChunks.delete(currentIndex);
          // 恢复流
          fileStream.resume();
        }
      });

      fileStream.on('end', () => {
        // 等待所有活动分块完成
        const checkComplete = setInterval(() => {
          if (activeChunks.size === 0) {
            clearInterval(checkComplete);
            resolve();
          }
        }, 100);
      });

      fileStream.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 发送分块
   */
  async sendChunk(uploadTask, chunkIndex, chunkData) {
    const { transferId, peerId } = uploadTask;

    await this.messageManager.sendMessage(peerId, {
      type: 'file:chunk',
      transferId,
      chunkIndex,
      data: chunkData.toString('base64')
    }, {
      priority: 'normal',
      requireAck: true
    });
  }

  /**
   * 请求缺失的分块
   */
  async requestMissingChunks(downloadTask) {
    const { transferId, peerId, totalChunks, receivedChunks } = downloadTask;

    const missingChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedChunks.has(i)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length === 0) return;

    console.log(`[FileTransfer] 请求 ${missingChunks.length} 个缺失分块`);

    await this.messageManager.sendMessage(peerId, {
      type: 'file:request-chunks',
      transferId,
      chunks: missingChunks
    }, {
      priority: 'high'
    });
  }

  /**
   * 组装文件
   */
  async assembleFile(downloadTask) {
    const { tempPath, totalChunks, chunks } = downloadTask;

    console.log('[FileTransfer] 组装文件...');

    const writeStream = fs.createWriteStream(tempPath);

    for (let i = 0; i < totalChunks; i++) {
      const chunkData = chunks.get(i);
      if (!chunkData) {
        throw new Error(`分块 ${i} 缺失`);
      }

      writeStream.write(chunkData);
    }

    return new Promise((resolve, reject) => {
      writeStream.end(() => resolve());
      writeStream.on('error', reject);
    });
  }

  /**
   * 验证文件
   */
  async verifyFile(downloadTask) {
    const { tempPath, fileHash } = downloadTask;

    const actualHash = await this.calculateFileHash(tempPath);

    return actualHash === fileHash;
  }

  /**
   * 计算文件哈希
   */
  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * 生成传输ID
   */
  generateTransferId() {
    return `transfer-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /**
   * 发送传输请求
   */
  async sendTransferRequest(peerId, metadata) {
    await this.messageManager.sendMessage(peerId, {
      type: 'file:transfer-request',
      ...metadata
    }, {
      priority: 'high',
      requireAck: true
    });
  }

  /**
   * 等待传输接受
   */
  async waitForTransferAccept(transferId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('等待传输接受超时'));
      }, this.options.timeout);

      const handler = ({ payload }) => {
        if (payload.type === 'file:transfer-accept' && payload.transferId === transferId) {
          clearTimeout(timeout);
          this.messageManager.off('message', handler);
          resolve();
        } else if (payload.type === 'file:transfer-reject' && payload.transferId === transferId) {
          clearTimeout(timeout);
          this.messageManager.off('message', handler);
          reject(new Error('传输被拒绝'));
        }
      };

      this.messageManager.on('message', handler);
    });
  }

  /**
   * 等待传输完成
   */
  async waitForTransferComplete(transferId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('等待传输完成超时'));
      }, this.options.timeout * 10); // 更长的超时时间

      const handler = ({ payload }) => {
        if (payload.type === 'file:transfer-complete' && payload.transferId === transferId) {
          clearTimeout(timeout);
          this.messageManager.off('message', handler);
          resolve();
        }
      };

      this.messageManager.on('message', handler);
    });
  }

  /**
   * 等待所有分块
   */
  async waitForAllChunks(downloadTask) {
    const { totalChunks, receivedChunks } = downloadTask;

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (receivedChunks.size === totalChunks) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // 超时
      setTimeout(() => {
        clearInterval(checkInterval);
        if (receivedChunks.size < totalChunks) {
          reject(new Error('接收分块超时'));
        }
      }, this.options.timeout * 10);
    });
  }

  /**
   * 设置消息处理器
   */
  setupMessageHandlers() {
    this.messageManager.on('message', async ({ peerId, payload }) => {
      try {
        switch (payload.type) {
          case 'file:transfer-request':
            await this.handleTransferRequest(peerId, payload);
            break;

          case 'file:chunk':
            await this.handleChunk(peerId, payload);
            break;

          case 'file:request-chunks':
            await this.handleRequestChunks(peerId, payload);
            break;

          case 'file:transfer-complete':
            await this.handleTransferComplete(peerId, payload);
            break;
        }
      } catch (error) {
        console.error('[FileTransfer] 处理消息失败:', error);
      }
    });
  }

  /**
   * 处理传输请求
   */
  async handleTransferRequest(peerId, payload) {
    const { transferId, fileName, fileSize, fileHash, totalChunks, chunkSize } = payload;

    console.log('[FileTransfer] 收到传输请求:', fileName);

    // 创建下载任务
    const downloadTask = {
      transferId,
      peerId,
      fileName,
      fileSize,
      fileHash,
      totalChunks,
      chunkSize,
      receivedChunks: new Set(),
      chunks: new Map(),
      bytesDownloaded: 0,
      status: 'pending'
    };

    this.downloads.set(transferId, downloadTask);

    // 触发事件，让用户决定是否接受
    this.emit('transfer:request', {
      transferId,
      peerId,
      fileName,
      fileSize,
      accept: async () => {
        await this.messageManager.sendMessage(peerId, {
          type: 'file:transfer-accept',
          transferId
        });
      },
      reject: async () => {
        await this.messageManager.sendMessage(peerId, {
          type: 'file:transfer-reject',
          transferId
        });
        this.downloads.delete(transferId);
      }
    });
  }

  /**
   * 处理分块
   */
  async handleChunk(peerId, payload) {
    const { transferId, chunkIndex, data } = payload;

    const downloadTask = this.downloads.get(transferId);
    if (!downloadTask) {
      console.warn('[FileTransfer] 下载任务不存在:', transferId);
      return;
    }

    // 解码分块数据
    const chunkData = Buffer.from(data, 'base64');

    // 保存分块
    downloadTask.chunks.set(chunkIndex, chunkData);
    downloadTask.receivedChunks.add(chunkIndex);
    downloadTask.bytesDownloaded += chunkData.length;

    // 更新进度
    this.emit('download:progress', {
      transferId,
      progress: downloadTask.receivedChunks.size / downloadTask.totalChunks,
      bytesDownloaded: downloadTask.bytesDownloaded,
      totalBytes: downloadTask.fileSize
    });
  }

  /**
   * 处理请求分块
   */
  async handleRequestChunks(peerId, payload) {
    const { transferId, chunks } = payload;

    const uploadTask = this.uploads.get(transferId);
    if (!uploadTask) {
      console.warn('[FileTransfer] 上传任务不存在:', transferId);
      return;
    }

    console.log(`[FileTransfer] 重新发送 ${chunks.length} 个分块`);

    // 重新发送请求的分块
    for (const chunkIndex of chunks) {
      // 读取分块数据
      const start = chunkIndex * this.options.chunkSize;
      const end = Math.min(start + this.options.chunkSize, uploadTask.fileSize);

      const chunkData = fs.readFileSync(uploadTask.filePath, {
        start,
        end: end - 1
      });

      await this.sendChunk(uploadTask, chunkIndex, chunkData);
    }
  }

  /**
   * 处理传输完成
   */
  async handleTransferComplete(peerId, payload) {
    const { transferId } = payload;

    console.log('[FileTransfer] 传输完成确认:', transferId);
  }

  /**
   * 确保临时目录存在
   */
  ensureTempDir() {
    if (!fs.existsSync(this.options.tempDir)) {
      fs.mkdirSync(this.options.tempDir, { recursive: true });
    }
  }

  /**
   * 获取传输进度
   */
  getProgress(transferId) {
    const upload = this.uploads.get(transferId);
    if (upload) {
      return {
        type: 'upload',
        progress: upload.uploadedChunks.size / upload.totalChunks,
        bytesTransferred: upload.bytesUploaded,
        totalBytes: upload.fileSize,
        status: upload.status
      };
    }

    const download = this.downloads.get(transferId);
    if (download) {
      return {
        type: 'download',
        progress: download.receivedChunks.size / download.totalChunks,
        bytesTransferred: download.bytesDownloaded,
        totalBytes: download.fileSize,
        status: download.status
      };
    }

    return null;
  }

  /**
   * 取消传输
   */
  async cancelTransfer(transferId) {
    const upload = this.uploads.get(transferId);
    if (upload) {
      upload.status = 'cancelled';
      this.uploads.delete(transferId);
      this.emit('upload:cancelled', { transferId });
      return;
    }

    const download = this.downloads.get(transferId);
    if (download) {
      download.status = 'cancelled';

      // 清理临时文件
      if (download.tempPath && fs.existsSync(download.tempPath)) {
        fs.unlinkSync(download.tempPath);
      }

      this.downloads.delete(transferId);
      this.emit('download:cancelled', { transferId });
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      activeUploads: this.uploads.size,
      activeDownloads: this.downloads.size
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.uploads.clear();
    this.downloads.clear();
    this.uploadQueue = [];
    this.downloadQueue = [];
  }
}

module.exports = FileTransferManager;
