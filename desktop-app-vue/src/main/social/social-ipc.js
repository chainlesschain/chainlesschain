/**
 * Social IPC 处理器
 * 负责处理社交网络相关的前后端通信
 *
 * @module social-ipc
 * @description 提供联系人管理、好友关系、动态发布、聊天消息、群聊等社交功能的 IPC 接口
 */
import electron from "electron";
import { logger } from "../utils/logger.js";

import { registerContactHandlers } from "./social-ipc-contact.js";
import { registerPostHandlers } from "./social-ipc-post.js";
import { registerChatHandlers } from "./social-ipc-chat.js";
import { registerGroupHandlers } from "./social-ipc-group.js";
import { registerFileVoiceHandlers } from "./social-ipc-file-voice.js";
import { registerAiAssistantHandlers } from "./social-ipc-ai-assistant.js";
import { registerActivityPubHandlers } from "./social-ipc-activitypub.js";

/**
 * 注册所有 Social IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contactManager - 联系人管理器
 * @param {Object} dependencies.friendManager - 好友管理器
 * @param {Object} dependencies.postManager - 动态管理器
 * @param {Object} dependencies.database - 数据库管理器（用于聊天功能）
 * @param {Object} dependencies.groupChatManager - 群聊管理器
 * @param {Object} [dependencies.ipcMain] - Injected ipcMain (for testing)
 */
function registerSocialIPC({
  contactManager,
  friendManager,
  postManager,
  database,
  groupChatManager,
  aiSocialAssistant,
  topicAnalyzer,
  socialGraph,
  activityPubBridge,
  apContentSync,
  apWebFinger,
  ipcMain: injectedIpcMain,
} = {}) {
  // electron imported at top
  const ipcMain = injectedIpcMain || electron.ipcMain;
  logger.info("[Social IPC] Registering Social IPC handlers...");

  const ctx = {
    ipcMain,
    contactManager,
    friendManager,
    postManager,
    database,
    groupChatManager,
    aiSocialAssistant,
    topicAnalyzer,
    socialGraph,
    activityPubBridge,
    apContentSync,
    apWebFinger,
  };

  registerContactHandlers(ctx);
  registerPostHandlers(ctx);
  registerChatHandlers(ctx);
  registerGroupHandlers(ctx);
  registerFileVoiceHandlers(ctx);
  registerAiAssistantHandlers(ctx);
  registerActivityPubHandlers(ctx);

  logger.info(
    "[Social IPC] ✓ All Social IPC handlers registered successfully (78 handlers)",
  );
}

export { registerSocialIPC };
