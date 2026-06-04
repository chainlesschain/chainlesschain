/**
 * Project AI IPC handlers — content group.
 * Split verbatim from project-ai-ipc.js registerProjectAIIPC(); ipcMain + deps via ctx.
 *
 * @module project/project-ai-ipc-content
 */
const { logger } = require("../utils/logger.js");

function registerContentHandlers(ctx) {
  const { ipcMain, llmManager } = ctx;

  // ============================================================
  // AI 内容处理 (Content Processing)
  // ============================================================

  /**
   * AI内容润色
   * Channel: 'project:polishContent'
   */
  ipcMain.handle("project:polishContent", async (_event, params) => {
    try {
      const { content, style } = params;
      logger.info("[Main] AI内容润色");

      const prompt = `请对以下内容进行润色，使其更加专业、流畅：

${content}

要求：
1. 保持原意不变
2. 改进表达方式
3. 修正语法错误
4. 使用恰当的专业术语
${style ? `5. 风格：${style}` : ""}`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 3000,
      });

      return {
        success: true,
        polished: response.text || response.content || response,
      };
    } catch (error) {
      logger.error("[Main] AI内容润色失败:", error);
      throw error;
    }
  });

  /**
   * AI内容扩写
   * Channel: 'project:expandContent'
   */
  ipcMain.handle("project:expandContent", async (_event, params) => {
    try {
      const { content, targetLength } = params;
      logger.info("[Main] AI内容扩写");

      const prompt = `请扩展以下内容，增加更多细节和例子${targetLength ? `，目标字数约${targetLength}字` : ""}：

${content}

要求：
1. 保持原有观点和结构
2. 增加具体例子和数据支持
3. 使内容更加详实完整`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 4000,
      });

      return {
        success: true,
        expanded: response.text || response.content || response,
      };
    } catch (error) {
      logger.error("[Main] AI内容扩写失败:", error);
      throw error;
    }
  });
}

module.exports = { registerContentHandlers };
