/**
 * 文件操作 IPC Handlers
 * 处理前端与文件系统之间的通信
 */

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
      console.log('[File IPC] Handlers already registered, skipping');
      return;
    }

    // ============ Excel相关操作 ============

    // 读取Excel文件
    ipcMain.handle('file:readExcel', async (event, filePath) => {
      try {
        console.log('[File IPC] 读取Excel文件:', filePath);

        // 确保excelEngine已加载
        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.readExcel(filePath);

        return {
          success: true,
          data,
        };
      } catch (error) {
        console.error('[File IPC] 读取Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入Excel文件
    ipcMain.handle('file:writeExcel', async (event, filePath, data) => {
      try {
        console.log('[File IPC] 写入Excel文件:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.writeExcel(filePath, data);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 写入Excel失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Excel转JSON
    ipcMain.handle('file:excelToJSON', async (event, filePath, options) => {
      try {
        console.log('[File IPC] Excel转JSON:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const data = await this.excelEngine.excelToJSON(filePath, options);

        return {
          success: true,
          data,
        };
      } catch (error) {
        console.error('[File IPC] Excel转JSON失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // JSON转Excel
    ipcMain.handle('file:jsonToExcel', async (event, jsonData, filePath, options) => {
      try {
        console.log('[File IPC] JSON转Excel:', filePath);

        if (!this.excelEngine) {
          this.excelEngine = require('../engines/excel-engine');
        }

        const result = await this.excelEngine.jsonToExcel(jsonData, filePath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] JSON转Excel失败:', error);
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
        console.log('[File IPC] 读取Word文档:', filePath);

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const data = await this.wordEngine.readWord(filePath);

        return {
          success: true,
          ...data,
        };
      } catch (error) {
        console.error('[File IPC] 读取Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入Word文档
    ipcMain.handle('file:writeWord', async (event, filePath, content) => {
      try {
        console.log('[File IPC] 写入Word文档:', filePath);

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.writeWord(filePath, content);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 写入Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Markdown转Word
    ipcMain.handle('file:markdownToWord', async (event, markdown, outputPath, options) => {
      try {
        console.log('[File IPC] Markdown转Word');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.markdownToWord(markdown, outputPath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] Markdown转Word失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Word转Markdown
    ipcMain.handle('file:wordToMarkdown', async (event, filePath) => {
      try {
        console.log('[File IPC] Word转Markdown');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.wordToMarkdown(filePath);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] Word转Markdown失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // HTML转Word
    ipcMain.handle('file:htmlToWord', async (event, html, outputPath, options) => {
      try {
        console.log('[File IPC] HTML转Word');

        if (!this.wordEngine) {
          this.wordEngine = require('../engines/word-engine');
        }

        const result = await this.wordEngine.htmlToWord(html, outputPath, options);

        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] HTML转Word失败:', error);
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
        console.log('[File IPC] 读取PPT文件:', filePath);

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
        console.error('[File IPC] 读取PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入PPT文件
    ipcMain.handle('file:writePPT', async (event, filePath, data) => {
      try {
        console.log('[File IPC] 写入PPT文件:', filePath);

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
        console.error('[File IPC] 写入PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Markdown转PPT
    ipcMain.handle('file:markdownToPPT', async (event, markdown, outputPath, options) => {
      try {
        console.log('[File IPC] Markdown转PPT');

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
        console.error('[File IPC] Markdown转PPT失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 创建PPT模板
    ipcMain.handle('file:createPPTTemplate', async (event, templateType, outputPath) => {
      try {
        console.log('[File IPC] 创建PPT模板:', templateType);

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
        console.error('[File IPC] 创建PPT模板失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 通用文件操作 ============

    // 读取文件内容
    ipcMain.handle('file:readContent', async (event, filePath) => {
      try {
        console.log('[File IPC] 读取文件:', filePath);
        const content = await fs.readFile(filePath, 'utf-8');

        return {
          success: true,
          content,
        };
      } catch (error) {
        console.error('[File IPC] 读取文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 写入文件内容
    ipcMain.handle('file:writeContent', async (event, filePath, content) => {
      try {
        console.log('[File IPC] 写入文件:', filePath);

        // 确保目录存在
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        await fs.writeFile(filePath, content, 'utf-8');

        return {
          success: true,
          filePath,
        };
      } catch (error) {
        console.error('[File IPC] 写入文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 另存为文件
    ipcMain.handle('file:saveAs', async (event, sourceFilePath) => {
      try {
        console.log('[File IPC] 另存为文件:', sourceFilePath);

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
        console.error('[File IPC] 另存为失败:', error);
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
        console.error('[File IPC] 获取文件信息失败:', error);
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
        console.log('[File IPC] 预览Office文件:', filePath, format);

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
        console.error('[File IPC] Office文件预览失败:', error);
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
        console.log('[File IPC] 列出压缩包内容:', archivePath);

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
        console.error('[File IPC] 列出压缩包内容失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取压缩包信息
    ipcMain.handle('archive:getInfo', async (event, archivePath) => {
      try {
        console.log('[File IPC] 获取压缩包信息:', archivePath);

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
        console.error('[File IPC] 获取压缩包信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 提取文件到临时目录
    ipcMain.handle('archive:extract', async (event, archivePath, filePath) => {
      try {
        console.log('[File IPC] 提取文件:', archivePath, filePath);

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
        console.error('[File IPC] 提取文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 提取文件到指定位置
    ipcMain.handle('archive:extractTo', async (event, archivePath, filePath, outputPath) => {
      try {
        console.log('[File IPC] 提取文件到:', archivePath, filePath, outputPath);

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
        console.error('[File IPC] 提取文件到指定位置失败:', error);
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
        console.log('[File IPC] 获取大文件信息:', filePath);

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
        console.error('[File IPC] 获取大文件信息失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 读取文件行
    ipcMain.handle('largeFile:readLines', async (event, filePath, startLine, lineCount) => {
      try {
        console.log('[File IPC] 读取文件行:', filePath, startLine, lineCount);

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
        console.error('[File IPC] 读取文件行失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 搜索文件内容
    ipcMain.handle('largeFile:search', async (event, filePath, query, options) => {
      try {
        console.log('[File IPC] 搜索文件:', filePath, query);

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
        console.error('[File IPC] 搜索文件失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取文件头部
    ipcMain.handle('largeFile:getHead', async (event, filePath, lineCount) => {
      try {
        console.log('[File IPC] 获取文件头部:', filePath, lineCount);

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
        console.error('[File IPC] 获取文件头部失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 获取文件尾部
    ipcMain.handle('largeFile:getTail', async (event, filePath, lineCount) => {
      try {
        console.log('[File IPC] 获取文件尾部:', filePath, lineCount);

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
        console.error('[File IPC] 获取文件尾部失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // ============ 对话框操作 ============

    // 显示打开文件对话框
    ipcMain.handle('dialog:showOpenDialog', async (event, options) => {
      try {
        const result = await dialog.showOpenDialog(mainWindow, options);
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 打开文件对话框失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // 显示保存文件对话框
    ipcMain.handle('dialog:showSaveDialog', async (event, options) => {
      try {
        const result = await dialog.showSaveDialog(mainWindow, options);
        return {
          success: true,
          ...result,
        };
      } catch (error) {
        console.error('[File IPC] 保存文件对话框失败:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    });

    this.handlersRegistered = true;
    console.log('[File IPC] 文件操作IPC处理器已注册');
  }

  /**
   * 预览Word文档
   */
  async previewWord(filePath) {
    const docxPreview = require('docx-preview');
    const fileBuffer = await fs.readFile(filePath);

    // 创建一个临时容器来渲染docx
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>');
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

    return {
      html: container.innerHTML,
    };
  }

  /**
   * 预览Excel表格
   */
  async previewExcel(filePath) {
    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(filePath);

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
    }

    return {
      sheets,
      sheetNames: workbook.SheetNames,
    };
  }

  /**
   * 预览PowerPoint
   */
  async previewPowerPoint(filePath) {
    const pptx2json = require('pptx2json');

    return new Promise((resolve, reject) => {
      pptx2json(filePath, (err, json) => {
        if (err) {
          reject(err);
          return;
        }

        // 转换pptx2json的输出为我们需要的格式
        const slides = [];

        if (json && Array.isArray(json)) {
          for (const slideData of json) {
            const slide = {
              title: slideData.title || '',
              content: [],
            };

            // 提取文本内容
            if (slideData.content && Array.isArray(slideData.content)) {
              slide.content = slideData.content.map(item => {
                if (typeof item === 'string') {
                  return item;
                } else if (item && item.text) {
                  return item.text;
                }
                return String(item);
              });
            }

            slides.push(slide);
          }
        }

        resolve({
          slides,
          slideCount: slides.length,
        });
      });
    });
  }
}

module.exports = FileIPC;
