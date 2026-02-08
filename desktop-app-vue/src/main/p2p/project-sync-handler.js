/**
 * Project Sync Handler - 项目文件同步处理器
 *
 * 功能：
 * - 处理移动端项目查询请求
 * - 同步项目列表
 * - 同步项目文件树
 * - 同步文件内容
 * - 搜索项目文件
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const fs = require("fs").promises;
const path = require("path");

class ProjectSyncHandler extends EventEmitter {
  constructor(databaseManager, p2pManager, mobileBridge) {
    super();

    this.db = databaseManager;
    this.p2pManager = p2pManager;
    this.mobileBridge = mobileBridge;

    // 同步统计
    this.stats = {
      projectsSynced: 0,
      filesSynced: 0,
      bytesTransferred: 0,
    };
  }

  /**
   * 统一消息处理入口
   */
  async handleMessage(mobilePeerId, message) {
    const { type } = message;

    switch (type) {
      case "project:list-projects":
        await this.handleListProjects(mobilePeerId, message);
        break;

      case "project:get-project":
        await this.handleGetProject(mobilePeerId, message);
        break;

      case "project:get-file-tree":
        await this.handleGetFileTree(mobilePeerId, message);
        break;

      case "project:get-file":
        await this.handleGetFile(mobilePeerId, message);
        break;

      case "project:search-files":
        await this.handleSearchFiles(mobilePeerId, message);
        break;

      default:
        logger.warn(`[ProjectSync] 未知消息类型: ${type}`);
        return {
          error: {
            code: "UNKNOWN_TYPE",
            message: `Unknown project sync message type: ${type}`,
          },
        };
    }

    return undefined;
  }

  /**
   * 处理获取项目列表请求
   */
  async handleListProjects(mobilePeerId, message) {
    logger.info("[ProjectSync] 处理项目列表请求");

    try {
      const { limit = 50, offset = 0 } = message.params || {};

      // 从数据库获取项目列表
      const projects = await this.db.all(
        `
        SELECT
          id, name, description, local_path, git_url,
          created_at, updated_at, last_commit_hash, last_commit_message
        FROM projects
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
        [limit, offset],
      );

      const { total } = await this.db.get(
        "SELECT COUNT(*) as total FROM projects",
      );

      // 统计每个项目的文件数
      for (const project of projects) {
        if (project.local_path) {
          try {
            const fileCount = await this.countProjectFiles(project.local_path);
            project.fileCount = fileCount;
          } catch (error) {
            project.fileCount = 0;
          }
        } else {
          project.fileCount = 0;
        }
      }

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "project:list-projects:response",
        requestId: message.requestId,
        data: {
          projects,
          total,
          limit,
          offset,
        },
      });

      this.stats.projectsSynced += projects.length;

      logger.info("[ProjectSync] ✅ 项目列表已发送:", projects.length);
    } catch (error) {
      logger.error("[ProjectSync] 处理项目列表请求失败:", error);

      // 如果是表不存在或列不存在错误，返回空数组
      if (
        error.message &&
        (error.message.includes("no such table") ||
          error.message.includes("no such column"))
      ) {
        await this.sendToMobile(mobilePeerId, {
          type: "project:list-projects:response",
          requestId: message.requestId,
          data: {
            projects: [],
            total: 0,
            limit: message.params?.limit || 50,
            offset: message.params?.offset || 0,
          },
        });
        logger.info("[ProjectSync] ⚠️  数据库表不存在或列缺失，返回空列表");
      } else {
        await this.sendError(mobilePeerId, message.requestId, error.message);
      }
    }
  }

  /**
   * 处理获取项目详情请求
   */
  async handleGetProject(mobilePeerId, message) {
    logger.info("[ProjectSync] 处理项目详情请求");

    try {
      const { projectId } = message.params || {};

      if (!projectId) {
        throw new Error("缺少项目ID");
      }

      // 从数据库获取项目
      const project = await this.db.get(
        `
        SELECT * FROM projects WHERE id = ?
      `,
        [projectId],
      );

      if (!project) {
        throw new Error("项目不存在");
      }

      // 获取项目统计信息
      if (project.local_path) {
        try {
          const stats = await this.getProjectStats(project.local_path);
          project.stats = stats;
        } catch (error) {
          project.stats = null;
        }
      }

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "project:get-project:response",
        requestId: message.requestId,
        data: { project },
      });

      logger.info("[ProjectSync] ✅ 项目详情已发送:", projectId);
    } catch (error) {
      logger.error("[ProjectSync] 处理项目详情请求失败:", error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理获取文件树请求
   */
  async handleGetFileTree(mobilePeerId, message) {
    logger.info("[ProjectSync] 处理文件树请求");

    try {
      const { projectId, maxDepth = 3 } = message.params || {};

      if (!projectId) {
        throw new Error("缺少项目ID");
      }

      // 获取项目路径
      const project = await this.db.get(
        "SELECT local_path FROM projects WHERE id = ?",
        [projectId],
      );

      if (!project || !project.local_path) {
        throw new Error("项目路径不存在");
      }

      // 读取文件树
      const fileTree = await this.buildFileTree(project.local_path, maxDepth);

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "project:get-file-tree:response",
        requestId: message.requestId,
        data: { fileTree },
      });

      logger.info("[ProjectSync] ✅ 文件树已发送");
    } catch (error) {
      logger.error("[ProjectSync] 处理文件树请求失败:", error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理获取文件内容请求
   */
  async handleGetFile(mobilePeerId, message) {
    logger.info("[ProjectSync] 处理文件内容请求");

    try {
      const { projectId, filePath } = message.params || {};

      if (!projectId || !filePath) {
        throw new Error("缺少项目ID或文件路径");
      }

      // 获取项目路径
      const project = await this.db.get(
        "SELECT local_path FROM projects WHERE id = ?",
        [projectId],
      );

      if (!project || !project.local_path) {
        throw new Error("项目路径不存在");
      }

      // 构建完整文件路径
      const fullPath = path.join(project.local_path, filePath);

      // 安全检查：确保文件在项目目录内
      if (!fullPath.startsWith(project.local_path)) {
        throw new Error("非法文件路径");
      }

      // 读取文件
      const content = await fs.readFile(fullPath, "utf8");

      // 获取文件信息
      const stats = await fs.stat(fullPath);

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "project:get-file:response",
        requestId: message.requestId,
        data: {
          filePath,
          content,
          size: stats.size,
          modifiedAt: stats.mtime,
          createdAt: stats.birthtime,
        },
      });

      this.stats.filesSynced++;
      this.stats.bytesTransferred += content.length;

      logger.info("[ProjectSync] ✅ 文件内容已发送:", filePath);
    } catch (error) {
      logger.error("[ProjectSync] 处理文件内容请求失败:", error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 处理搜索文件请求
   */
  async handleSearchFiles(mobilePeerId, message) {
    logger.info("[ProjectSync] 处理文件搜索请求");

    try {
      const { projectId, query, fileTypes = [] } = message.params || {};

      if (!projectId || !query) {
        throw new Error("缺少项目ID或搜索关键词");
      }

      // 获取项目路径
      const project = await this.db.get(
        "SELECT local_path FROM projects WHERE id = ?",
        [projectId],
      );

      if (!project || !project.local_path) {
        throw new Error("项目路径不存在");
      }

      // 搜索文件
      const files = await this.searchFiles(
        project.local_path,
        query,
        fileTypes,
      );

      // 发送响应
      await this.sendToMobile(mobilePeerId, {
        type: "project:search-files:response",
        requestId: message.requestId,
        data: {
          files,
          query,
          total: files.length,
        },
      });

      logger.info("[ProjectSync] ✅ 搜索结果已发送:", files.length);
    } catch (error) {
      logger.error("[ProjectSync] 处理文件搜索请求失败:", error);
      await this.sendError(mobilePeerId, message.requestId, error.message);
    }
  }

  /**
   * 统计项目文件数
   */
  async countProjectFiles(projectPath) {
    let count = 0;

    async function countRecursive(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // 忽略 node_modules, .git 等目录
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await countRecursive(fullPath);
        } else {
          count++;
        }
      }
    }

    await countRecursive(projectPath);
    return count;
  }

  /**
   * 获取项目统计信息
   */
  async getProjectStats(projectPath) {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      fileTypes: {},
    };

    async function statsRecursive(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await statsRecursive(fullPath);
        } else {
          stats.totalFiles++;

          const fileStat = await fs.stat(fullPath);
          stats.totalSize += fileStat.size;

          const ext = path.extname(entry.name).toLowerCase();
          stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;
        }
      }
    }

    await statsRecursive(projectPath);
    return stats;
  }

  /**
   * 构建文件树
   */
  async buildFileTree(rootPath, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return null;
    }

    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const tree = [];

    for (const entry of entries) {
      // 忽略特定目录
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }

      const fullPath = path.join(rootPath, entry.name);
      const node = {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        path: fullPath,
      };

      if (entry.isDirectory()) {
        const children = await this.buildFileTree(
          fullPath,
          maxDepth,
          currentDepth + 1,
        );
        if (children) {
          node.children = children;
        }
      } else {
        const stats = await fs.stat(fullPath);
        node.size = stats.size;
        node.modifiedAt = stats.mtime;
      }

      tree.push(node);
    }

    return tree;
  }

  /**
   * 搜索文件
   */
  async searchFiles(rootPath, query, fileTypes = []) {
    const results = [];
    const queryLower = query.toLowerCase();

    async function searchRecursive(dirPath) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          await searchRecursive(fullPath);
        } else {
          // 检查文件名
          const nameMatch = entry.name.toLowerCase().includes(queryLower);

          // 检查文件类型
          const ext = path.extname(entry.name).toLowerCase();
          const typeMatch = fileTypes.length === 0 || fileTypes.includes(ext);

          if (nameMatch && typeMatch) {
            const stats = await fs.stat(fullPath);
            results.push({
              name: entry.name,
              path: path.relative(rootPath, fullPath),
              size: stats.size,
              modifiedAt: stats.mtime,
            });
          }
        }
      }
    }

    await searchRecursive(rootPath);
    return results;
  }

  /**
   * 发送消息到移动端
   */
  async sendToMobile(mobilePeerId, message) {
    if (this.mobileBridge) {
      await this.mobileBridge.send({
        type: "message",
        to: mobilePeerId,
        payload: message,
      });
    } else {
      logger.error("[ProjectSync] MobileBridge未初始化");
    }
  }

  /**
   * 发送错误响应
   */
  async sendError(mobilePeerId, requestId, errorMessage) {
    await this.sendToMobile(mobilePeerId, {
      type: "error",
      requestId,
      error: errorMessage,
    });
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = ProjectSyncHandler;
