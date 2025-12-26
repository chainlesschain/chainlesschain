/**
 * 大文件读取器
 * 支持分块读取、流式搜索，避免将整个文件加载到内存
 */

const fs = require('fs');
const readline = require('readline');
const { once } = require('events');

class LargeFileReader {
  constructor() {
    this.CHUNK_SIZE = 1024 * 1024; // 1MB per chunk
    this.LINES_PER_CHUNK = 50; // 每次加载50行
  }

  /**
   * 获取文件大小
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>} 文件大小（字节）
   */
  async getFileSize(filePath) {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  }

  /**
   * 读取文件块（按字节）
   * @param {string} filePath - 文件路径
   * @param {number} offset - 起始偏移量
   * @param {number} size - 读取大小
   * @returns {Promise<Buffer>} 文件块内容
   */
  async readChunk(filePath, offset, size) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.alloc(size);

      fs.open(filePath, 'r', (err, fd) => {
        if (err) {
          reject(err);
          return;
        }

        fs.read(fd, buffer, 0, size, offset, (err, bytesRead, buffer) => {
          fs.close(fd, (closeErr) => {
            if (err || closeErr) {
              reject(err || closeErr);
            } else {
              resolve(buffer.slice(0, bytesRead));
            }
          });
        });
      });
    });
  }

  /**
   * 读取文件行（按行数）
   * @param {string} filePath - 文件路径
   * @param {number} startLine - 起始行号（0-based）
   * @param {number} lineCount - 读取行数
   * @returns {Promise<Object>} 包含lines数组和hasMore标志
   */
  async readLines(filePath, startLine, lineCount) {
    return new Promise((resolve, reject) => {
      const lines = [];
      let currentLine = 0;
      let hasMore = false;

      const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: 64 * 1024, // 64KB buffer
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        if (currentLine >= startLine && lines.length < lineCount) {
          lines.push({
            lineNumber: currentLine + 1,
            content: line,
          });
        }

        if (lines.length >= lineCount) {
          hasMore = true;
          rl.close();
          stream.destroy();
        }

        currentLine++;
      });

      rl.on('close', () => {
        resolve({
          lines,
          hasMore: hasMore || currentLine > startLine + lineCount,
          totalLinesRead: currentLine,
        });
      });

      rl.on('error', (err) => {
        reject(err);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 计算文件总行数
   * @param {string} filePath - 文件路径
   * @returns {Promise<number>} 总行数
   */
  async countLines(filePath) {
    return new Promise((resolve, reject) => {
      let lineCount = 0;

      const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: 64 * 1024,
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      rl.on('line', () => {
        lineCount++;
      });

      rl.on('close', () => {
        resolve(lineCount);
      });

      rl.on('error', reject);
      stream.on('error', reject);
    });
  }

  /**
   * 在文件中搜索（流式搜索，不加载全文件）
   * @param {string} filePath - 文件路径
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @returns {Promise<Array>} 搜索结果
   */
  async searchInFile(filePath, query, options = {}) {
    const {
      caseSensitive = false,
      maxResults = 100,
      contextLines = 2, // 前后各显示2行上下文
    } = options;

    return new Promise((resolve, reject) => {
      const results = [];
      let lineNumber = 0;
      const linesBuffer = []; // 用于存储上下文

      const searchQuery = caseSensitive ? query : query.toLowerCase();

      const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: 64 * 1024,
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        lineNumber++;

        // 保持一个滑动窗口来存储上下文
        linesBuffer.push({ lineNumber, content: line });
        if (linesBuffer.length > contextLines * 2 + 1) {
          linesBuffer.shift();
        }

        // 搜索匹配
        const searchLine = caseSensitive ? line : line.toLowerCase();
        if (searchLine.includes(searchQuery)) {
          // 找到匹配，提取上下文
          const contextStart = Math.max(0, linesBuffer.length - contextLines - 1);
          const contextEnd = Math.min(linesBuffer.length, contextStart + contextLines * 2 + 1);

          results.push({
            lineNumber: lineNumber,
            line: line,
            context: linesBuffer.slice(contextStart, contextEnd).map(item => ({
              lineNumber: item.lineNumber,
              content: item.content,
              isMatch: item.lineNumber === lineNumber,
            })),
          });

          if (results.length >= maxResults) {
            rl.close();
            stream.destroy();
          }
        }
      });

      rl.on('close', () => {
        resolve({
          results,
          totalMatches: results.length,
          hasMore: results.length >= maxResults,
        });
      });

      rl.on('error', reject);
      stream.on('error', reject);
    });
  }

  /**
   * 获取文件的前N行（用于预览）
   * @param {string} filePath - 文件路径
   * @param {number} lineCount - 行数
   * @returns {Promise<Array>} 文件行
   */
  async getFileHead(filePath, lineCount = 100) {
    const result = await this.readLines(filePath, 0, lineCount);
    return result.lines;
  }

  /**
   * 获取文件的后N行
   * @param {string} filePath - 文件路径
   * @param {number} lineCount - 行数
   * @returns {Promise<Array>} 文件行
   */
  async getFileTail(filePath, lineCount = 100) {
    // 先计算总行数
    const totalLines = await this.countLines(filePath);
    const startLine = Math.max(0, totalLines - lineCount);
    const result = await this.readLines(filePath, startLine, lineCount);
    return result.lines;
  }

  /**
   * 获取文件元信息
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 文件信息
   */
  async getFileInfo(filePath) {
    const stats = await fs.promises.stat(filePath);

    // 快速估算行数（只读取前100KB）
    let estimatedLines = 0;
    try {
      const sampleSize = Math.min(100 * 1024, stats.size);
      const buffer = await this.readChunk(filePath, 0, sampleSize);
      const sampleText = buffer.toString('utf-8');
      const sampleLines = sampleText.split('\n').length;
      estimatedLines = Math.round((stats.size / sampleSize) * sampleLines);
    } catch (err) {
      console.warn('[Large File Reader] 估算行数失败:', err);
    }

    return {
      size: stats.size,
      estimatedLines: estimatedLines,
      isLarge: stats.size > 10 * 1024 * 1024, // >10MB 视为大文件
      created: stats.birthtime,
      modified: stats.mtime,
    };
  }

  /**
   * 流式读取文件（用于下载或传输）
   * @param {string} filePath - 文件路径
   * @param {Function} onChunk - 每块数据的回调
   * @param {Object} options - 选项
   */
  async streamFile(filePath, onChunk, options = {}) {
    const { chunkSize = this.CHUNK_SIZE } = options;

    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, {
        highWaterMark: chunkSize,
      });

      let totalBytesRead = 0;

      stream.on('data', (chunk) => {
        totalBytesRead += chunk.length;
        onChunk(chunk, totalBytesRead);
      });

      stream.on('end', () => {
        resolve({ totalBytesRead });
      });

      stream.on('error', reject);
    });
  }
}

module.exports = LargeFileReader;
