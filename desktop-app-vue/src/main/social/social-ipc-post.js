/**
 * Social IPC handlers — post group.
 * Split verbatim from social-ipc.js registerSocialIPC(); ipcMain + managers via ctx.
 *
 * @module social/social-ipc-post
 */
import { logger } from "../utils/logger.js";

export function registerPostHandlers(ctx) {
  const { ipcMain, postManager } = ctx;

  // ============================================================
  // 动态管理 (Post/Feed Management) - 10 handlers
  // ============================================================

  /**
   * 发布动态
   * Channel: 'post:create'
   */
  ipcMain.handle("post:create", async (_event, options) => {
    try {
      if (!postManager) {
        throw new Error("动态管理器未初始化");
      }

      return await postManager.createPost(options);
    } catch (error) {
      logger.error("[Social IPC] 发布动态失败:", error);
      throw error;
    }
  });

  /**
   * 获取动态流
   * Channel: 'post:get-feed'
   */
  ipcMain.handle("post:get-feed", async (_event, options) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getFeed(options);
    } catch (error) {
      logger.error("[Social IPC] 获取动态流失败:", error);
      throw error;
    }
  });

  /**
   * 获取单条动态
   * Channel: 'post:get'
   */
  ipcMain.handle("post:get", async (_event, postId) => {
    try {
      if (!postManager) {
        return null;
      }

      return await postManager.getPost(postId);
    } catch (error) {
      logger.error("[Social IPC] 获取动态失败:", error);
      throw error;
    }
  });

  /**
   * 删除动态
   * Channel: 'post:delete'
   */
  ipcMain.handle("post:delete", async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error("动态管理器未初始化");
      }

      return await postManager.deletePost(postId);
    } catch (error) {
      logger.error("[Social IPC] 删除动态失败:", error);
      throw error;
    }
  });

  /**
   * 点赞动态
   * Channel: 'post:like'
   */
  ipcMain.handle("post:like", async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error("动态管理器未初始化");
      }

      return await postManager.likePost(postId);
    } catch (error) {
      logger.error("[Social IPC] 点赞失败:", error);
      throw error;
    }
  });

  /**
   * 取消点赞
   * Channel: 'post:unlike'
   */
  ipcMain.handle("post:unlike", async (_event, postId) => {
    try {
      if (!postManager) {
        throw new Error("动态管理器未初始化");
      }

      return await postManager.unlikePost(postId);
    } catch (error) {
      logger.error("[Social IPC] 取消点赞失败:", error);
      throw error;
    }
  });

  /**
   * 获取点赞列表
   * Channel: 'post:get-likes'
   */
  ipcMain.handle("post:get-likes", async (_event, postId) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getLikes(postId);
    } catch (error) {
      logger.error("[Social IPC] 获取点赞列表失败:", error);
      return [];
    }
  });

  /**
   * 添加评论
   * Channel: 'post:add-comment'
   */
  ipcMain.handle(
    "post:add-comment",
    async (_event, postId, content, parentId) => {
      try {
        if (!postManager) {
          throw new Error("动态管理器未初始化");
        }

        return await postManager.addComment(postId, content, parentId);
      } catch (error) {
        logger.error("[Social IPC] 添加评论失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取评论列表
   * Channel: 'post:get-comments'
   */
  ipcMain.handle("post:get-comments", async (_event, postId) => {
    try {
      if (!postManager) {
        return [];
      }

      return await postManager.getComments(postId);
    } catch (error) {
      logger.error("[Social IPC] 获取评论列表失败:", error);
      return [];
    }
  });

  /**
   * 删除评论
   * Channel: 'post:delete-comment'
   */
  ipcMain.handle("post:delete-comment", async (_event, commentId) => {
    try {
      if (!postManager) {
        throw new Error("动态管理器未初始化");
      }

      return await postManager.deleteComment(commentId);
    } catch (error) {
      logger.error("[Social IPC] 删除评论失败:", error);
      throw error;
    }
  });
}
