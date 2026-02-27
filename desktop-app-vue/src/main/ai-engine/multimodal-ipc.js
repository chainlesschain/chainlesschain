/**
 * Multimodal IPC Handlers - 多模态AI IPC处理器
 *
 * 提供12个IPC处理器用于多模态AI能力
 *
 * @module ai-engine/multimodal-ipc
 * @version 1.0.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * 注册多模态IPC处理器
 * @param {Object} deps
 * @param {Object} deps.multimodalRouter - MultimodalRouter 实例
 * @param {Object} deps.mainWindow - 主窗口实例
 */
function registerMultimodalIPC({ multimodalRouter, mainWindow }) {
  const router = multimodalRouter;

  // 1. 自动路由处理
  ipcMain.handle("multimodal:process", async (event, input) => {
    if (!router) {throw new Error("MultimodalRouter not initialized");}
    return await router.processInput(input);
  });

  // 2. 图片分析
  ipcMain.handle(
    "multimodal:analyze-image",
    async (event, { imagePath, prompt }) => {
      if (!router) {throw new Error("MultimodalRouter not initialized");}
      return await router.analyzeImage(imagePath, prompt);
    },
  );

  // 3. 音频转写
  ipcMain.handle(
    "multimodal:transcribe-audio",
    async (event, { audioPath, options }) => {
      if (!router) {throw new Error("MultimodalRouter not initialized");}
      return await router.transcribeAudio(audioPath, options);
    },
  );

  // 4. 视频分析
  ipcMain.handle(
    "multimodal:analyze-video",
    async (event, { videoPath, prompt }) => {
      if (!router) {throw new Error("MultimodalRouter not initialized");}
      return await router.analyzeVideo(videoPath, prompt);
    },
  );

  // 5. 多模态对话
  ipcMain.handle("multimodal:chat", async (event, { messages }) => {
    if (!router) {throw new Error("MultimodalRouter not initialized");}
    return await router.multimodalChat(messages);
  });

  // 6. 获取可用能力
  ipcMain.handle("multimodal:get-capabilities", async () => {
    if (!router) {return {};}
    return router.getCapabilities();
  });

  // 7. 获取会话
  ipcMain.handle("multimodal:get-session", async (event, { sessionId }) => {
    if (!router) {return null;}
    return await router.getSession(sessionId);
  });

  // 8. 列出会话
  ipcMain.handle("multimodal:list-sessions", async (event, params) => {
    if (!router) {return { sessions: [], total: 0 };}
    return await router.listSessions(params);
  });

  // 9. 删除会话
  ipcMain.handle("multimodal:delete-session", async (event, { sessionId }) => {
    if (!router) {return false;}
    return await router.deleteSession(sessionId);
  });

  // 10. 配置模态设置
  ipcMain.handle(
    "multimodal:configure",
    async (event, { modality, settings }) => {
      if (!router) {throw new Error("MultimodalRouter not initialized");}
      return await router.configure(modality, settings);
    },
  );

  // 11. 健康检查
  ipcMain.handle("multimodal:check-health", async () => {
    if (!router) {return {};}
    return await router.checkHealth();
  });

  // 12. 使用统计
  ipcMain.handle("multimodal:get-stats", async () => {
    if (!router) {return {};}
    return await router.getStats();
  });

  logger.info("[MultimodalIPC] 12个多模态IPC处理器注册成功");
}

module.exports = { registerMultimodalIPC };
