/**
 * 文件操作 IPC Handlers
 * 处理前端与文件系统之间的通信
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain, dialog } = require('electron');
const fs = require('fs').promises;
const path = require('path');

class FileIPC {
  constructor() {
    this.excelEngine = null;
    this.documentEngine = null;
    this.archiveManager = null;
    this.largeFileReader = null;
    this.handlersRegistered = false;
  }

  /**
   * 设置引擎实例
   */
  setEngines({ excelEngine, documentEngine, wordEngine, archiveManager, largeFileReader }) {
    if (excelEngine) {
      this.excelEngine = excelEngine;
    }
    if (documentEngine) {
      this.documentEngine = documentEngine;
    }
    if (wordEngine) {
      this.wordEngine = wordEngine;
    }
    if (archiveManager) {
      this.archiveManager = archiveManager;
    }
    if (largeFileReader) {
      this.largeFileReader = largeFileReader;
    }
  }

  /**
   * 注册所有IPC handlers
   * @param {BrowserWindow} mainWindow - 主窗口实例
   */
  registerHandlers(mainWindow) {
    // 防止重复注册
    if (this.handlersRegistered) {
      logger.info('[File IPC] Handlers already registered, skipping');
      return;
    }

    // ============ Excel相关操作 ============

    // 读取Excel文件
    ipcMain.handle('file:readExcel', async (event, filePath) => {
      try {
        logger.info('[File IPC] 读取Excel文件:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        // 确保excelEngine已加载
        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.readExcel(resolvedPath);

        return {
          success: true,
          data,
        };
      } catch (error) {
        logger.error('[File IPC] 读取Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入Excel文件
    ipcMain.handle('file:writeExcel', async (event, filePath, data) => {
      try {
        logger.info('[File IPC] 写入Excel文件:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.writeExcel(resolvedPath, data);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] 写入Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Excel转JSON
    ipcMain.handle('file:excelToJSON', async (event, filePath, options) => {
      try {
        logger.info('[File IPC] Excel转JSON:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.excelToJSON(resolvedPath, options);

        return {
          success: true,
          data,
        };
      } catch (error) {
        logger.error('[File IPC] Excel转JSON失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // JSON转Excel
    ipcMain.handle('file:jsonToExcel', async (event, jsonData, filePath, options) => {
      try {
        logger.info('[File IPC] JSON转Excel:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.jsonToExcel(jsonData, resolvedPath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] JSON转Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ Word相关操作 ============

    // 读取Word文档
    ipcMain.handle('file:readWord', async (event, filePath) => {
      try {
        logger.info('[File IPC] 读取Word文档:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const data = await this.wordEngine.readWord(resolvedPath);

        return {
          success: true,
          ...data,
        };
      } catch (error) {
        logger.error('[File IPC] 读取Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入Word文档
    ipcMain.handle('file:writeWord', async (event, filePath, content) => {
      try {
        logger.info('[File IPC] 写入Word文档:', filePath);

        // 解析路径（将 /data/projects/xxx 转换为绝对路径）
        const { getProjectConfig } = require('../project/project-config');
        const projectConfig = getProjectConfig();
        const resolvedPath = projectConfig.resolveProjectPath(filePath);

        logger.info('[File IPC] 解析后的路径:', resolvedPath);

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.writeWord(resolvedPath, content);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] 写入Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Markdown转Word
    ipcMain.handle('file:markdownToWord', async (event, markdown, outputPath, options) => {
      try {
        logger.info('[File IPC] Markdown转Word');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.markdownToWord(markdown, outputPath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] Markdown转Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Word转Markdown
    ipcMain.handle('file:wordToMarkdown', async (event, filePath) => {
      try {
        logger.info('[File IPC] Word转Markdown');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.wordToMarkdown(filePath);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] Word转Markdown失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // HTML转Word
    ipcMain.handle('file:htmlToWord', async (event, html, outputPath, options) => {
      try {
        logger.info('[File IPC] HTML转Word');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.htmlToWord(html, outputPath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] HTML转Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ PPT相关操作 ============

    // 读取PPT文件
    ipcMain.handle('file:readPPT', async (event, filePath) => {
      try {
        logger.info('[File IPC] 读取PPT文件:', filePath);

        if (!this.pptEngine) {
          const PPTEngine = require('../engines/ppt-engine');
          this.pptEngine = new PPTEngine();
        }

        // 注意：pptxgenjs主要用于创建PPT，读取功能有限
        // 这里返回基本文件信息
        const stats = await fs.stat(filePath);
        const fileName = path.basename(filePath);

        return {
          success: true,
          metadata: {
            fileName,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            filePath,
          },
          message: 'PPT文件已加载，使用预览模式查看内容',
        };
      } catch (error) {
        logger.error('[File IPC] 读取PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入PPT文件
    ipcMain.handle('file:writePPT', async (event, filePath, data) => {
      try {
        logger.info('[File IPC] 写入PPT文件:', filePath);

        if (!this.pptEngine) {
          const PPTEngine = require('../engines/ppt-engine');
          this.pptEngine = new PPTEngine();
        }

        // 构建PPT大纲
        const outline = {
          title: data.title || '演示文稿',
          subtitle: data.subtitle || '',
          sections: [],
        };

        // 将slides转换为sections格式
        if (data.slides && Array.isArray(data.slides)) {
          data.slides.forEach((slide, index) => {
            const section = {
              title: `幻灯片 ${index + 1}`,
              subsections: [
                {
                  title: slide.title || `内容 ${index + 1}`,
                  points: [],
                },
              ],
            };

            // 从元素中提取文本作为要点
            if (slide.elements && Array.isArray(slide.elements)) {
              slide.elements.forEach(el => {
                if (el.text && el.type !== 'title') {
                  section.subsections[0].points.push(el.text);
                }
              });
            }

            outline.sections.push(section);
          });
        }

        // 生成PPT
        const result = await this.pptEngine.generateFromOutline(outline, {
          theme: data.theme || 'business',
          author: data.author || 'ChainlessChain',
          outputPath: filePath,
        });

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] 写入PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Markdown转PPT
    ipcMain.handle('file:markdownToPPT', async (event, markdown, outputPath, options) => {
      try {
        logger.info('[File IPC] Markdown转PPT');

        if (!this.pptEngine) {
          const PPTEngine = require('../engines/ppt-engine');
          this.pptEngine = new PPTEngine();
        }

        const result = await this.pptEngine.generateFromMarkdown(markdown, {
          ...options,
          outputPath,
        });

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] Markdown转PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 创建PPT模板
    ipcMain.handle('file:createPPTTemplate', async (event, templateType, outputPath) => {
      try {
        logger.info('[File IPC] 创建PPT模板:', templateType);

        if (!this.pptEngine) {
          const PPTEngine = require('../engines/ppt-engine');
          this.pptEngine = new PPTEngine();
        }

        // 创建简单的模板大纲
        const outline = {
          title: '演示文稿',
          subtitle: '使用ChainlessChain创建',
          sections: [
            {
              title: '欢迎',
              subsections: [
                {
                  title: '介绍',
                  points: ['这是一个演示文稿模板', '您可以自由编辑内容'],
                },
              ],
            },
          ],
        };

        const result = await this.pptEngine.generateFromOutline(outline, {
          theme: templateType || 'business',
          author: 'ChainlessChain',
          outputPath,
        });

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        logger.error('[File IPC] 创建PPT模板失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 通用文件操作 ============

    // 读取文件内容（优化：大文件流式读取）
    ipcMain.handle('file:readContent', async (event, filePath) => {
      try {
        logger.info('[File IPC] ========== 读取文件 ==========');
        logger.info('[File IPC] 接收到的路径:', filePath);
        logger.info('[File IPC] 路径类型:', typeof filePath);
        logger.info('[File IPC] 是否为绝对路径:', path.isAbsolute(filePath));

        // 检查文件是否存在
        try {
          await fs.access(filePath);
          logger.info('[File IPC] ✓ 文件存在');
        } catch (err) {
          logger.error('[File IPC] ✗ 文件不存在:', err.message);
          throw new Error(`文件不存在: ${filePath}`);
        }

        // 获取文件大小
        const stats = await fs.stat(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        const LARGE_FILE_THRESHOLD = 5; // 5MB

        logger.info('[File IPC] 文件大小:', fileSizeInMB.toFixed(2), 'MB');

        // 大文件使用流式读取（优化：防止内存溢出）
        if (fileSizeInMB > LARGE_FILE_THRESHOLD) {
          logger.info('[File IPC] 使用流式读取（文件 > 5MB）');

          if (!this.largeFileReader) {
            const LargeFileReader = require('../file/large-file-reader');
            this.largeFileReader = new LargeFileReader();
          }

          // 读取文件头部（前1000行）
          const lines = await this.largeFileReader.getFileHead(filePath, 1000);
          const content = lines.join('\n');

          logger.info('[File IPC] ✓ 流式读取成功，返回前1000行');

          return {
            success: true,
            content,
            isPartial: true,
            fileSize: stats.size,
            message: `文件较大（${fileSizeInMB.toFixed(2)}MB），已加载前1000行。使用大文件查看器查看完整内容。`,
          };
        }

        // 小文件直接读取
        const content = await fs.readFile(filePath, 'utf-8');
        logger.info('[File IPC] ✓ 读取成功，内容长度:', content.length);
        logger.info('[File IPC] 内容预览:', content.substring(0, 100));

        return {
          success: true,
          content,
          isPartial: false,
          fileSize: stats.size,
        };
      } catch (error) {
        logger.error('[File IPC] ========== 读取文件失败 ==========');
        logger.error('[File IPC] 错误:', error.message);
        logger.error('[File IPC] 堆栈:', error.stack);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入文件内容
    ipcMain.handle('file:writeContent', async (event, filePath, content) => {
      try {
        logger.info('[File IPC] 写入文件:', filePath);

        // 确保目录存在
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, content, 'utf-8');

        return {
          success: true,
          filePath,
        };
      } catch (error) {
        logger.error('[File IPC] 写入文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 另存为文件
    ipcMain.handle('file:saveAs', async (event, sourceFilePath) => {
      try {
        logger.info('[File IPC] 另存为文件:', sourceFilePath);

        // 显示保存对话框
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: path.basename(sourceFilePath),
        });

        if (result.canceled || !result.filePath) {
          return {
            success: false,
            canceled: true,
          };
        }

        // 复制文件
        await fs.copyFile(sourceFilePath, result.filePath);

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        logger.error('[File IPC] 另存为失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 文件是否存在
    ipcMain.handle('file:exists', async (event, filePath) => {
      try {
        await fs.access(filePath);
        return { success: true, exists: true };
      } catch (error) {
        return { success: true, exists: false };
      }
    });

    // 获取文件信息
    ipcMain.handle('file:stat', async (event, filePath) => {
      try {
        const stats = await fs.stat(filePath);
        return {
          success: true,
          stats: {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            mtime: stats.mtime,
            ctime: stats.ctime,
          },
        };
      } catch (error) {
        logger.error('[File IPC] 获取文件信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ Office文件预览 ============

    // 预览Office文件 (Word, Excel, PowerPoint)
    ipcMain.handle('file:previewOffice', async (event, filePath, format) => {
      try {
        logger.info('[File IPC] 预览Office文件:', filePath, format);

        // 确保documentEngine已加载
        if (!this.documentEngine) {
          this.documentEngine = require('../engines/document-engine');
        }

        let data;

        switch (format) {
          case 'word':
            data = await this.previewWord(filePath);
            break;
          case 'excel':
            data = await this.previewExcel(filePath);
            break;
          case 'powerpoint':
            data = await this.previewPowerPoint(filePath);
            break;
          default:
            throw new Error(`不支持的格式: ${format}`);
        }

        return {
          success: true,
          data,
        };
      } catch (error) {
        logger.error('[File IPC] Office文件预览失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 压缩包操作 ============

    // 列出压缩包内容
    ipcMain.handle('archive:list', async (event, archivePath) => {
      try {
        logger.info('[File IPC] 列出压缩包内容:', archivePath);

        // 确保archiveManager已加载
        if (!this.archiveManager) {
          const ArchiveManager = require('../archive/archive-manager');
          this.archiveManager = new ArchiveManager();
        }

        const contents = await this.archiveManager.listContents(archivePath);

        return {
          success: true,
          data: contents,
        };
      } catch (error) {
        logger.error('[File IPC] 列出压缩包内容失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取压缩包信息
    ipcMain.handle('archive:getInfo', async (event, archivePath) => {
      try {
        logger.info('[File IPC] 获取压缩包信息:', archivePath);

        if (!this.archiveManager) {
          const ArchiveManager = require('../archive/archive-manager');
          this.archiveManager = new ArchiveManager();
        }

        const info = await this.archiveManager.getArchiveInfo(archivePath);

        return {
          success: true,
          data: info,
        };
      } catch (error) {
        logger.error('[File IPC] 获取压缩包信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 提取文件到临时目录
    ipcMain.handle('archive:extract', async (event, archivePath, filePath) => {
      try {
        logger.info('[File IPC] 提取文件:', archivePath, filePath);

        if (!this.archiveManager) {
          const ArchiveManager = require('../archive/archive-manager');
          this.archiveManager = new ArchiveManager();
        }

        const extractedPath = await this.archiveManager.extractFile(archivePath, filePath);

        return {
          success: true,
          data: {
            path: extractedPath,
          },
        };
      } catch (error) {
        logger.error('[File IPC] 提取文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 提取文件到指定位置
    ipcMain.handle('archive:extractTo', async (event, archivePath, filePath, outputPath) => {
      try {
        logger.info('[File IPC] 提取文件到:', archivePath, filePath, outputPath);

        if (!this.archiveManager) {
          const ArchiveManager = require('../archive/archive-manager');
          this.archiveManager = new ArchiveManager();
        }

        // 先提取到临时目录
        const tempPath = await this.archiveManager.extractFile(archivePath, filePath);

        // 复制到目标位置
        await fs.copyFile(tempPath, outputPath);

        return {
          success: true,
          data: {
            path: outputPath,
          },
        };
      } catch (error) {
        logger.error('[File IPC] 提取文件到指定位置失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 大文件操作 ============

    // 获取文件信息
    ipcMain.handle('largeFile:getInfo', async (event, filePath) => {
      try {
        logger.info('[File IPC] 获取大文件信息:', filePath);

        if (!this.largeFileReader) {
          const LargeFileReader = require('../file/large-file-reader');
          this.largeFileReader = new LargeFileReader();
        }

        const info = await this.largeFileReader.getFileInfo(filePath);

        return {
          success: true,
          data: info,
        };
      } catch (error) {
        logger.error('[File IPC] 获取大文件信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 读取文件行
    ipcMain.handle('largeFile:readLines', async (event, filePath, startLine, lineCount) => {
      try {
        logger.info('[File IPC] 读取文件行:', filePath, startLine, lineCount);

        if (!this.largeFileReader) {
          const LargeFileReader = require('../file/large-file-reader');
          this.largeFileReader = new LargeFileReader();
        }

        const result = await this.largeFileReader.readLines(filePath, startLine, lineCount);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.error('[File IPC] 读取文件行失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 搜索文件内容
    ipcMain.handle('largeFile:search', async (event, filePath, query, options) => {
      try {
        logger.info('[File IPC] 搜索文件:', filePath, query);

        if (!this.largeFileReader) {
          const LargeFileReader = require('../file/large-file-reader');
          this.largeFileReader = new LargeFileReader();
        }

        const result = await this.largeFileReader.searchInFile(filePath, query, options);

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        logger.error('[File IPC] 搜索文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取文件头部
    ipcMain.handle('largeFile:getHead', async (event, filePath, lineCount) => {
      try {
        logger.info('[File IPC] 获取文件头部:', filePath, lineCount);

        if (!this.largeFileReader) {
          const LargeFileReader = require('../file/large-file-reader');
          this.largeFileReader = new LargeFileReader();
        }

        const lines = await this.largeFileReader.getFileHead(filePath, lineCount);

        return {
          success: true,
          data: lines,
        };
      } catch (error) {
        logger.error('[File IPC] 获取文件头部失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取文件尾部
    ipcMain.handle('largeFile:getTail', async (event, filePath, lineCount) => {
      try {
        logger.info('[File IPC] 获取文件尾部:', filePath, lineCount);

        if (!this.largeFileReader) {
          const LargeFileReader = require('../file/large-file-reader');
          this.largeFileReader = new LargeFileReader();
        }

        const lines = await this.largeFileReader.getFileTail(filePath, lineCount);

        return {
          success: true,
          data: lines,
        };
      } catch (error) {
        logger.error('[File IPC] 获取文件尾部失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 对话框操作 ============
    // Note: 对话框处理器已在 system-ipc.js 中注册，此处不重复注册

    this.handlersRegistered = true;
    logger.info('[File IPC] 文件操作IPC处理器已注册');
  }

  /**
   * 预览Word文档
   */
  async previewWord(filePath) {
    logger.info('[FileIPC] 开始预览Word文档:', filePath);

    try {
      // 检查文件是否存在
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      // 读取文件
      const fileBuffer = await fs.readFile(filePath);
      logger.info('[FileIPC] Word文件已读取，大小:', fileBuffer.length, 'bytes');

      if (fileBuffer.length === 0) {
        throw new Error('Word文件为空');
      }

      // 创建一个临时容器来渲染docx
      const docxPreview = require('docx-preview');
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>');

      // 🔥 修复：将JSDOM的所有必要浏览器API暴露到全局，供docx-preview使用
      const originalDOMParser = global.DOMParser;
      const originalDocument = global.document;
      const originalXMLSerializer = global.XMLSerializer;
      const originalNode = global.Node;
      const originalElement = global.Element;
      const originalHTMLElement = global.HTMLElement;
      const originalWindow = global.window;

      try {
        global.DOMParser = dom.window.DOMParser;
        global.document = dom.window.document;
        global.XMLSerializer = dom.window.XMLSerializer;
        global.Node = dom.window.Node;
        global.Element = dom.window.Element;
        global.HTMLElement = dom.window.HTMLElement;
        global.window = dom.window;

        const container = dom.window.document.getElementById('container');

        await docxPreview.renderAsync(fileBuffer, container, null, {
          className: 'docx-preview',
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          debug: false,
          experimental: false,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });

        // 🔥 修复：移除docx-preview-wrapper和section标签，只保留实际内容和样式
        let htmlContent = '';

        // 1. 收集所有style标签
        const styles = container.querySelectorAll('style');
        styles.forEach(style => {
          htmlContent += style.outerHTML;
        });

        // 2. 找到section.docx-preview，取其article内容
        const section = container.querySelector('section.docx-preview');
        if (section) {
          const article = section.querySelector('article');
          if (article) {
            htmlContent += article.innerHTML;
            logger.info('[FileIPC] 已移除wrapper和section标签，只保留article内容');
          } else {
            // 如果没有article，则取section的全部内容
            htmlContent += section.innerHTML;
            logger.info('[FileIPC] 已移除wrapper标签，保留section内容');
          }
        } else {
          // 降级：如果找不到section，使用原始innerHTML
          htmlContent = container.innerHTML;
          logger.info('[FileIPC] 使用原始HTML内容');
        }

        logger.info('[FileIPC] Word预览HTML生成成功，长度:', htmlContent.length);

        return {
          html: htmlContent,
        };
      } finally {
        // 恢复全局变量
        if (originalDOMParser !== undefined) {
          global.DOMParser = originalDOMParser;
        } else {
          delete global.DOMParser;
        }
        if (originalDocument !== undefined) {
          global.document = originalDocument;
        } else {
          delete global.document;
        }
        if (originalXMLSerializer !== undefined) {
          global.XMLSerializer = originalXMLSerializer;
        } else {
          delete global.XMLSerializer;
        }
        if (originalNode !== undefined) {
          global.Node = originalNode;
        } else {
          delete global.Node;
        }
        if (originalElement !== undefined) {
          global.Element = originalElement;
        } else {
          delete global.Element;
        }
        if (originalHTMLElement !== undefined) {
          global.HTMLElement = originalHTMLElement;
        } else {
          delete global.HTMLElement;
        }
        if (originalWindow !== undefined) {
          global.window = originalWindow;
        } else {
          delete global.window;
        }
      }
    } catch (error) {
      logger.error('[FileIPC] Word预览失败:', error);
      throw error;
    }
  }

  /**
   * 预览Excel表格
   */
  async previewExcel(filePath) {
    logger.info('[FileIPC] 开始预览Excel表格:', filePath);

    try {
      // 检查文件是否存在
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      const xlsx = require('xlsx');
      const workbook = xlsx.readFile(filePath);
      logger.info('[FileIPC] Excel文件已读取，工作表数量:', workbook.SheetNames.length);

      const sheets = [];

      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
          blankrows: true,
        });

        sheets.push({
          name: sheetName,
          data: data,
        });

        logger.info(`[FileIPC] 工作表 "${sheetName}" 已解析，行数:`, data.length);
      }

      logger.info('[FileIPC] Excel预览解析完成');

      return {
        sheets,
        sheetNames: workbook.SheetNames,
      };
    } catch (error) {
      logger.error('[FileIPC] Excel预览失败:', error);
      throw error;
    }
  }

  /**
   * 预览PowerPoint
   */
  async previewPowerPoint(filePath) {
    logger.info('[FileIPC] 开始预览PowerPoint:', filePath);

    try {
      // 检查文件是否存在
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      // 🔥 使用自定义 PPTX 解析器替代 pptx2json
      const { parsePPTX } = require('../utils/pptx-parser');
      const slides = await parsePPTX(filePath);

      logger.info('[FileIPC] PowerPoint预览解析完成，幻灯片数量:', slides.length);

      return {
        slides,
        slideCount: slides.length,
      };
    } catch (error) {
      logger.error('[FileIPC] PowerPoint预览外部失败:', error);
      throw error;
    }
  }
}

module.exports = FileIPC;
