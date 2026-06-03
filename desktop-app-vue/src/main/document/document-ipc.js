/**
 * 文档处理 IPC
 * 处理 PPT 导出等文档操作
 *
 * @module document-ipc
 * @description 文档处理模块，提供 PPT 导出等功能
 */

const { logger } = require("../utils/logger.js");
const { ipcMain, dialog } = require("electron");

/**
 * 注册文档处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.convertSlidesToOutline - 转换幻灯片为大纲的函数
 */
function registerDocumentIPC({ convertSlidesToOutline }) {
  logger.info("[Document IPC] Registering Document IPC handlers...");

  // ============================================================
  // PPT 导出操作 (1 handler)
  // ============================================================

  /**
   * 导出 PPT
   */
  ipcMain.handle("ppt:export", async (_event, params) => {
    try {
      const {
        slides,
        title = "演示文稿",
        author = "作者",
        theme = "business",
        outputPath,
      } = params;

      logger.info(`[Document] 导出PPT: ${title}, 幻灯片数: ${slides.length}`);

      const PPTEngine = require("../engines/ppt-engine");
      const pptEngine = new PPTEngine();

      // 如果没有指定输出路径，让用户选择
      let savePath = outputPath;
      if (!savePath) {
        const result = await dialog.showSaveDialog({
          title: "导出PPT",
          defaultPath: `${title}.pptx`,
          filters: [{ name: "PowerPoint演示文稿", extensions: ["pptx"] }],
        });

        if (result.canceled) {
          return { success: false, canceled: true };
        }
        savePath = result.filePath;
      }

      // 将编辑器的幻灯片数据转换为大纲格式
      if (!convertSlidesToOutline) {
        throw new Error("convertSlidesToOutline function not available");
      }
      const outline = convertSlidesToOutline(slides, title);

      // 生成PPT
      await pptEngine.createPresentation(outline, {
        author,
        theme,
        outputPath: savePath,
      });

      logger.info("[Document] PPT导出完成:", savePath);

      return {
        success: true,
        path: savePath,
      };
    } catch (error) {
      logger.error("[Document] PPT导出失败:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Document IPC] ✓ 1 handler registered");
  logger.info("[Document IPC] - 1 PPT export handler");
}

module.exports = {
  registerDocumentIPC,
};
