/**
 * 文件导入器
 * 支持 PDF、Word、Markdown 等多种文件格式的导入
 *
 * v0.17.0: 集成文件安全验证
 */

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const FileValidator = require('../security/file-validator');
const XSSSanitizer = require('../security/xss-sanitizer');
const { getFileHandler } = require('../utils/file-handler');

class FileImporter extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.supportedFormats = {
      markdown: ['.md', '.markdown'],
      pdf: ['.pdf'],
      word: ['.doc', '.docx'],
      text: ['.txt'],
    };
    this.enableSecurityValidation = true; // 启用安全验证
  }

  /**
   * 检查文件格式是否支持
   */
  isSupportedFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return Object.values(this.supportedFormats).flat().includes(ext);
  }

  /**
   * 获取文件类型
   */
  getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    for (const [type, extensions] of Object.entries(this.supportedFormats)) {
      if (extensions.includes(ext)) {
        return type;
      }
    }
    return null;
  }

  /**
   * 导入单个文件
   */
  async importFile(filePath, options = {}) {
    try {
      // 检查文件是否存在
      await fs.access(filePath);

      // 🔒 安全验证: 验证文件安全性
      if (this.enableSecurityValidation && !options.skipValidation) {
        console.log(`[FileImporter] 验证文件安全性: ${filePath}`);
        const validation = await FileValidator.validateFile(filePath, 'document');

        if (!validation.valid) {
          const errorMsg = `文件验证失败: ${validation.errors.join(', ')}`;
          console.error(`[FileImporter] ${errorMsg}`);
          throw new Error(errorMsg);
        }

        // 记录警告信息
        if (validation.warnings && validation.warnings.length > 0) {
          console.warn(`[FileImporter] 文件警告:`, validation.warnings);
          this.emit('import-warning', {
            filePath,
            warnings: validation.warnings,
          });
        }

        // 记录验证信息
        console.log(`[FileImporter] 文件验证通过:`, {
          hash: validation.fileInfo.hash,
          size: validation.fileInfo.size,
          category: validation.category,
        });
      }

      // 获取文件类型
      const fileType = this.getFileType(filePath);
      if (!fileType) {
        throw new Error(`不支持的文件格式: ${path.extname(filePath)}`);
      }

      this.emit('import-start', { filePath, fileType });

      let result;
      switch (fileType) {
        case 'markdown':
          result = await this.importMarkdown(filePath, options);
          break;
        case 'pdf':
          result = await this.importPDF(filePath, options);
          break;
        case 'word':
          result = await this.importWord(filePath, options);
          break;
        case 'text':
          result = await this.importText(filePath, options);
          break;
        default:
          throw new Error(`未实现的文件类型处理: ${fileType}`);
      }

      this.emit('import-success', { filePath, result });
      return result;
    } catch (error) {
      this.emit('import-error', { filePath, error });
      throw error;
    }
  }

  /**
   * 批量导入文件
   */
  async importFiles(filePaths, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: filePaths.length,
    };

    for (const filePath of filePaths) {
      try {
        const result = await this.importFile(filePath, options);
        results.success.push({ filePath, result });
        this.emit('import-progress', {
          current: results.success.length + results.failed.length,
          total: results.total,
          status: 'success',
          filePath,
        });
      } catch (error) {
        results.failed.push({ filePath, error: error.message });
        this.emit('import-progress', {
          current: results.success.length + results.failed.length,
          total: results.total,
          status: 'failed',
          filePath,
          error: error.message,
        });
      }
    }

    this.emit('import-complete', results);
    return results;
  }

  /**
   * 导入 Markdown 文件
   */
  async importMarkdown(filePath, options = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath, path.extname(filePath));

      // 解析 YAML front matter（如果存在）
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
      const metadata = {};
      let markdownContent = content;

      if (frontMatterMatch) {
        // 简单解析 YAML front matter
        const yamlContent = frontMatterMatch[1];
        const lines = yamlContent.split('\n');
        for (const line of lines) {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            metadata[match[1]] = match[2].replace(/^["']|["']$/g, '');
          }
        }
        markdownContent = content.substring(frontMatterMatch[0].length);
      }

      // 🔒 安全处理: XSS 防护 - 清理 Markdown 内容中的危险脚本
      if (this.enableSecurityValidation && !options.skipSanitization) {
        markdownContent = XSSSanitizer.sanitizeMarkdown(markdownContent);

        // 检测 XSS 威胁
        const threats = XSSSanitizer.detectXSS(markdownContent);
        if (threats.length > 0) {
          console.warn(`[FileImporter] 检测到潜在的 XSS 威胁 (已清理):`, threats);
          this.emit('import-warning', {
            filePath,
            type: 'xss_threat',
            threats,
          });
        }
      }

      // 创建知识库条目
      const knowledgeItem = {
        title: metadata.title || fileName,
        content: markdownContent.trim(),
        type: options.type || metadata.type || 'note',
        tags: options.tags || (metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : []),
        source: filePath,
      };

      // 保存到数据库
      const savedItem = this.database.addKnowledgeItem(knowledgeItem);

      return {
        id: savedItem.id,
        title: savedItem.title,
        type: savedItem.type,
        imported: true,
      };
    } catch (error) {
      console.error(`[FileImporter] 导入 Markdown 失败:`, error);
      throw new Error(`导入 Markdown 失败: ${error.message}`);
    }
  }

  /**
   * 导入 PDF 文件
   * 需要 pdf-parse 库
   *
   * v0.18.0: 新增流式导入支持（大文件优化）
   */
  async importPDF(filePath, options = {}) {
    try {
      // 检查是否安装了 pdf-parse
      let pdfParse;
      try {
        pdfParse = require('pdf-parse');
      } catch (err) {
        throw new Error('PDF 解析库未安装。请运行: npm install pdf-parse');
      }

      const fileHandler = getFileHandler();
      const fileSize = await fileHandler.getFileSize(filePath);
      const isLargeFile = fileSize > 10 * 1024 * 1024; // 10MB阈值

      let dataBuffer;
      let data;

      if (!isLargeFile) {
        // 小文件: 使用原有方式（快速、兼容性好）
        console.log(`[FileImporter] PDF小文件直接读取: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
        dataBuffer = await fs.readFile(filePath);
        data = await pdfParse(dataBuffer);
      } else {
        // 大文件: 使用流式读取 + 进度通知
        console.log(`[FileImporter] PDF大文件流式读取: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);

        const chunks = [];
        let accumulatedSize = 0;

        await fileHandler.readFileStream(
          filePath,
          async (chunk, meta) => {
            // 累积chunks
            chunks.push(chunk);
            accumulatedSize += chunk.length;

            // 发送进度事件
            this.emit('import-progress', {
              filePath,
              stage: 'reading',
              percent: meta.progress,
              processedBytes: meta.processedSize,
              totalBytes: meta.totalSize,
              processedMB: (meta.processedSize / 1024 / 1024).toFixed(2),
              totalMB: (meta.totalSize / 1024 / 1024).toFixed(2),
            });

            return chunk; // 返回chunk以便累积
          },
          {
            chunkSize: 5 * 1024 * 1024, // 5MB chunks（PDF更大块以减少开销）
            returnChunks: false,
          }
        );

        // 合并所有chunks
        this.emit('import-progress', {
          filePath,
          stage: 'parsing',
          percent: 95,
          message: '正在解析PDF内容...',
        });

        dataBuffer = Buffer.concat(chunks);
        console.log(`[FileImporter] 合并chunks完成，开始解析PDF: ${(dataBuffer.length / 1024 / 1024).toFixed(2)}MB`);

        // 解析PDF
        data = await pdfParse(dataBuffer);

        // 释放内存
        chunks.length = 0;
      }

      const fileName = path.basename(filePath, path.extname(filePath));

      // 创建知识库条目
      this.emit('import-progress', {
        filePath,
        stage: 'saving',
        percent: 98,
        message: '正在保存到数据库...',
      });

      const knowledgeItem = {
        title: options.title || fileName,
        content: data.text,
        type: options.type || 'document',
        tags: options.tags || ['pdf', 'imported'],
        source: filePath,
        metadata: {
          pages: data.numpages,
          info: data.info,
          fileSize: fileSize,
          processingMode: isLargeFile ? 'streaming' : 'direct',
        },
      };

      // 保存到数据库
      const savedItem = this.database.addKnowledgeItem(knowledgeItem);

      this.emit('import-progress', {
        filePath,
        stage: 'complete',
        percent: 100,
        message: '导入完成',
      });

      return {
        id: savedItem.id,
        title: savedItem.title,
        type: savedItem.type,
        pages: data.numpages,
        imported: true,
        fileSize: fileSize,
        processingMode: isLargeFile ? 'streaming' : 'direct',
      };
    } catch (error) {
      console.error(`[FileImporter] 导入 PDF 失败:`, error);
      throw new Error(`导入 PDF 失败: ${error.message}`);
    }
  }

  /**
   * 导入 Word 文件
   * 需要 mammoth 库
   */
  async importWord(filePath, options = {}) {
    try {
      // 检查是否安装了 mammoth
      let mammoth;
      try {
        mammoth = require('mammoth');
      } catch (err) {
        throw new Error('Word 解析库未安装。请运行: npm install mammoth');
      }

      const result = await mammoth.extractRawText({ path: filePath });
      const fileName = path.basename(filePath, path.extname(filePath));

      // 创建知识库条目
      const knowledgeItem = {
        title: options.title || fileName,
        content: result.value,
        type: options.type || 'document',
        tags: options.tags || ['word', 'imported'],
        source: filePath,
      };

      // 保存到数据库
      const savedItem = this.database.addKnowledgeItem(knowledgeItem);

      return {
        id: savedItem.id,
        title: savedItem.title,
        type: savedItem.type,
        imported: true,
      };
    } catch (error) {
      console.error(`[FileImporter] 导入 Word 失败:`, error);
      throw new Error(`导入 Word 失败: ${error.message}`);
    }
  }

  /**
   * 导入纯文本文件
   */
  async importText(filePath, options = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath, path.extname(filePath));

      // 创建知识库条目
      const knowledgeItem = {
        title: options.title || fileName,
        content: content.trim(),
        type: options.type || 'note',
        tags: options.tags || ['text', 'imported'],
        source: filePath,
      };

      // 保存到数据库
      const savedItem = this.database.addKnowledgeItem(knowledgeItem);

      return {
        id: savedItem.id,
        title: savedItem.title,
        type: savedItem.type,
        imported: true,
      };
    } catch (error) {
      console.error(`[FileImporter] 导入文本失败:`, error);
      throw new Error(`导入文本失败: ${error.message}`);
    }
  }

  /**
   * 获取支持的文件格式列表
   */
  getSupportedFormats() {
    return this.supportedFormats;
  }

  /**
   * 获取支持的文件扩展名列表（用于文件选择对话框）
   */
  getSupportedExtensions() {
    return Object.values(this.supportedFormats).flat();
  }
}

module.exports = FileImporter;
