/**
 * PDF 处理 IPC
 * 处理 Markdown/HTML/文本转 PDF，批量转换等操作
 *
 * @module pdf-ipc
 * @description PDF 处理模块，提供各种格式文件转 PDF 的功能
 */

const { ipcMain } = require('electron');

/**
 * 注册 PDF 处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getPDFEngine - 获取 PDF 引擎的函数
 */
function registerPDFIPC({
  getPDFEngine
}) {
  console.log('[PDF IPC] Registering PDF IPC handlers...');

  // ============================================================
  // PDF 转换操作 (4 handlers)
  // ============================================================

  /**
   * Markdown 转 PDF
   */
  ipcMain.handle('pdf:markdownToPDF', async (_event, params) => {
    try {
      const { markdown, outputPath, options } = params;

      const pdfEngine = getPDFEngine();

      const result = await pdfEngine.markdownToPDF(markdown, outputPath, options || {});

      console.log('[PDF] Markdown转PDF完成:', outputPath);
      return result;
    } catch (error) {
      console.error('[PDF] Markdown转PDF失败:', error);
      throw error;
    }
  });

  /**
   * HTML 文件转 PDF
   */
  ipcMain.handle('pdf:htmlFileToPDF', async (_event, params) => {
    try {
      const { htmlPath, outputPath, options } = params;

      const pdfEngine = getPDFEngine();

      const result = await pdfEngine.htmlFileToPDF(htmlPath, outputPath, options || {});

      console.log('[PDF] HTML文件转PDF完成:', outputPath);
      return result;
    } catch (error) {
      console.error('[PDF] HTML文件转PDF失败:', error);
      throw error;
    }
  });

  /**
   * 文本文件转 PDF
   */
  ipcMain.handle('pdf:textFileToPDF', async (_event, params) => {
    try {
      const { textPath, outputPath, options } = params;

      const pdfEngine = getPDFEngine();

      const result = await pdfEngine.textFileToPDF(textPath, outputPath, options || {});

      console.log('[PDF] 文本文件转PDF完成:', outputPath);
      return result;
    } catch (error) {
      console.error('[PDF] 文本文件转PDF失败:', error);
      throw error;
    }
  });

  /**
   * 批量转换 PDF
   */
  ipcMain.handle('pdf:batchConvert', async (_event, params) => {
    try {
      const { files, outputDir, options } = params;

      const pdfEngine = getPDFEngine();

      const result = await pdfEngine.batchConvert(files, outputDir, options || {});

      console.log('[PDF] 批量转换完成:', files.length, '个文件');
      return result;
    } catch (error) {
      console.error('[PDF] 批量转换失败:', error);
      throw error;
    }
  });

  console.log('[PDF IPC] ✓ 4 handlers registered');
  console.log('[PDF IPC] - 3 single file conversion handlers');
  console.log('[PDF IPC] - 1 batch conversion handler');
}

module.exports = {
  registerPDFIPC
};
