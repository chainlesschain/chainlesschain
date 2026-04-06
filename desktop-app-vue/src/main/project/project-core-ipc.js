/**
 * Project Core IPC 处理器
 * 负责项目核心管理的前后端通信
 *
 * @module project-core-ipc
 * @description 提供项目的 CRUD、文件管理、同步恢复、监听器等核心 IPC 接口
 */

const { logger } = require("../utils/logger.js");
const { app, ipcMain } = require("electron");
const crypto = require("crypto");
const path = require("path");
const FileCacheManager = require("./file-cache-manager.js");
const ConflictError = require("../errors/conflict-error.js");
const { getSyncLockManager } = require("./sync-lock-manager.js");

let databaseInitPromise = null;

async function ensureDatabase(database) {
  if (database?.db || database?.saveProject || database?.getProjectById) {
    return database;
  }

  try {
    const { getDatabase } = await import("../database.js");
    return getDatabase();
  } catch (_error) {
    // Fall through to lazy initialization.
  }

  if (!databaseInitPromise) {
    databaseInitPromise = (async () => {
      const { DatabaseManager, setDatabase } = await import("../database.js");
      const dbPath = path.join(
        app.getPath("userData"),
        "data",
        "chainlesschain.db",
      );
      await require("fs").promises.mkdir(path.dirname(dbPath), {
        recursive: true,
      });
      const manager = new DatabaseManager(dbPath, {
        password: process.env.DEFAULT_PASSWORD || "123456",
        encryptionEnabled: false,
      });
      await manager.initialize();
      setDatabase(manager);
      return manager;
    })().catch((error) => {
      databaseInitPromise = null;
      throw error;
    });
  }

  return databaseInitPromise;
}

/**
 * 注册所有 Project Core IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器
 * @param {Function} dependencies.removeUndefinedValues - 清理 undefined 值的函数
 * @param {Function} dependencies._replaceUndefinedWithNull - 替换 undefined 为 null 的函数
 */
function registerProjectCoreIPC({
  database,
  fileSyncManager,
  removeUndefinedValues,
  _replaceUndefinedWithNull,
}) {
  logger.info("[Project Core IPC] Registering Project Core IPC handlers...");

  let activeDatabase = database;
  let fileCacheManager = activeDatabase
    ? new FileCacheManager(activeDatabase)
    : null;

  async function getActiveDatabase() {
    activeDatabase = await ensureDatabase(activeDatabase);
    if (!fileCacheManager) {
      fileCacheManager = new FileCacheManager(activeDatabase);
    }
    return activeDatabase;
  }

  // 获取同步锁管理器实例
  const syncLockManager = getSyncLockManager();

  // ============================================================
  // 项目 CRUD 操作 (Project CRUD Operations)
  // ============================================================

  /**
   * 获取所有项目（本地SQLite，支持分页）
   * Channel: 'project:get-all'
   */
  ipcMain.handle("project:get-all", async (_event, userId, options = {}) => {
    try {
      const database = await getActiveDatabase();
      const {
        offset = 0,
        limit = 0, // 0 表示不分页，返回所有
        sortBy = "updated_at",
        sortOrder = "DESC",
      } = options;

      logger.info("[Main] ⚡ 获取项目列表:", {
        userId,
        offset,
        limit,
        sortBy,
        sortOrder,
      });

      const startTime = Date.now();

      // 获取项目列表（支持分页）
      const projects = database.getProjects(userId, {
        offset,
        limit,
        sortBy,
        sortOrder,
      });

      // 获取总数
      const total = database.getProjectsCount(userId);

      const duration = Date.now() - startTime;

      logger.info(
        `[Main] ⚡ 返回 ${projects.length}/${total} 个项目 (耗时 ${duration}ms)`,
      );

      if (!projects || projects.length === 0) {
        return {
          projects: [],
          total: 0,
          hasMore: false,
        };
      }

      // 清理数据
      const cleaned = removeUndefinedValues(projects);

      // 确保返回的是有效的数组
      if (!cleaned || !Array.isArray(cleaned)) {
        logger.warn("[Main] 清理后的结果不是数组，返回空数组");
        return {
          projects: [],
          total: 0,
          hasMore: false,
        };
      }

      return {
        projects: cleaned,
        total,
        hasMore: limit > 0 && offset + limit < total,
      };
    } catch (error) {
      logger.error("[Main] 获取项目列表失败:", error);
      logger.error("[Main] 错误堆栈:", error.stack);
      // 出错时返回空数组而不是抛出异常，避免IPC序列化错误
      return {
        projects: [],
        total: 0,
        hasMore: false,
      };
    }
  });

  /**
   * 获取单个项目
   * Channel: 'project:get'
   */
  ipcMain.handle("project:get", async (_event, projectId) => {
    try {
      const database = await getActiveDatabase();
      const project = database.getProjectById(projectId);
      return removeUndefinedValues(project);
    } catch (error) {
      logger.error("[Main] 获取项目失败:", error);
      throw error;
    }
  });

  /**
   * 创建项目（调用后端）
   * Channel: 'project:create'
   */
  ipcMain.handle("project:create", async (_event, createData) => {
    try {
      // 首先清理输入数据中的 undefined 值（IPC 已经不应该传递 undefined，但双重保险）
      const cleanedCreateData = _replaceUndefinedWithNull(createData);
      logger.info(
        "[Main] 开始创建项目，参数:",
        JSON.stringify(cleanedCreateData, null, 2),
      );

      const { getProjectHTTPClient } = require("./http-client");
      const httpClient = getProjectHTTPClient();

      // 调用后端API
      const project = await httpClient.createProject(cleanedCreateData);
      logger.info("[Main] 后端返回项目，键:", Object.keys(project || {}));

      // 保存到本地数据库
      if (project) {
        const database = await getActiveDatabase();
        // 先清理 project 中的 undefined，再保存到数据库
        const cleanedProject = _replaceUndefinedWithNull(project);
        logger.info(
          "[Main] 清理后的项目:",
          JSON.stringify(cleanedProject, null, 2),
        );

        const localProject = {
          ...cleanedProject,
          user_id: cleanedCreateData.userId || "default-user",
          sync_status: "synced",
          synced_at: Date.now(),
          file_count: cleanedProject.files ? cleanedProject.files.length : 0, // 设置文件数量
        };

        // 检查 localProject 中是否有 undefined
        logger.info("[Main] localProject 准备保存到数据库");
        Object.keys(localProject).forEach((key) => {
          const value = localProject[key];
          logger.info(
            `[Main]   ${key}: ${typeof value === "undefined" ? "UNDEFINED!" : typeof value} = ${JSON.stringify(value).substring(0, 100)}`,
          );
        });

        try {
          logger.info("[Main] 调用 saveProject...");
          await database.saveProject(localProject);
          logger.info("[Main] 项目已保存到本地数据库");
        } catch (saveError) {
          logger.error("[Main] saveProject 失败:", saveError.message);
          logger.error("[Main] saveProject 堆栈:", saveError.stack);
          throw saveError;
        }

        // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
        const projectType =
          cleanedProject.project_type || cleanedProject.projectType;
        try {
          const { getProjectConfig } = require("./project-config");
          const projectConfig = getProjectConfig();
          const projectRootPath = require("path").join(
            projectConfig.getProjectsRootPath(),
            cleanedProject.id,
          );

          logger.info(
            "[Main] 创建项目目录:",
            projectRootPath,
            "项目类型:",
            projectType,
          );
          await require("fs").promises.mkdir(projectRootPath, {
            recursive: true,
          });

          // 立即更新项目的root_path（无论项目类型和是否有文件）
          // updateProject 是同步函数
          database.updateProject(cleanedProject.id, {
            root_path: projectRootPath,
          });
          logger.info("[Main] 项目root_path已设置:", projectRootPath);
        } catch (dirError) {
          logger.error("[Main] 创建项目目录失败:", dirError);
          // 继续执行，不影响项目创建
        }

        // 保存项目文件
        if (cleanedProject.files && cleanedProject.files.length > 0) {
          try {
            logger.info(
              "[Main] 开始保存文件，数量:",
              cleanedProject.files.length,
            );
            // 清理文件数组中的 undefined
            const cleanedFiles = _replaceUndefinedWithNull(
              cleanedProject.files,
            );
            await database.saveProjectFiles(cleanedProject.id, cleanedFiles);
            logger.info("[Main] 项目文件已保存");
          } catch (fileError) {
            logger.error("[Main] saveProjectFiles 失败:", fileError.message);
            logger.error("[Main] saveProjectFiles 堆栈:", fileError.stack);
            throw fileError;
          }
        }
      }

      // 清理undefined值（IPC无法序列化undefined）
      logger.info("[Main] 开始清理 undefined 值");
      logger.info(
        "[Main] 清理前的项目键值:",
        JSON.stringify(Object.keys(project)),
      );

      // 检查每个键的值
      Object.keys(project).forEach((key) => {
        if (project[key] === undefined) {
          logger.warn(`[Main] 发现 undefined 值在键: ${key}`);
        }
      });

      const cleanProject = removeUndefinedValues(project);
      logger.info("[Main] 清理完成，返回项目");
      logger.info("[Main] 清理后的项目键:", Object.keys(cleanProject));

      // 再次检查清理后的值
      Object.keys(cleanProject).forEach((key) => {
        if (cleanProject[key] === undefined) {
          logger.error(`[Main] 清理后仍有 undefined 值在键: ${key}`);
        }
      });

      // 最终安全检查：递归替换所有undefined为null
      const safeProject = _replaceUndefinedWithNull(cleanProject);
      logger.info("[Main] 最终安全检查完成");

      return safeProject;
    } catch (error) {
      logger.error("[Main] 创建项目失败:", error);
      throw error;
    }
  });

  /**
   * 流式创建项目（SSE）
   * Channel: 'project:create-stream'
   */
  ipcMain.handle("project:create-stream", async (event, createData) => {
    const { getProjectHTTPClient } = require("./http-client");
    const httpClient = getProjectHTTPClient();
    const fs = require("fs").promises;
    const path = require("path");
    const { getProjectConfig } = require("./project-config");

    // 流式状态
    let streamControl = null;
    const accumulatedData = {
      stages: [],
      contentByStage: {},
      files: [],
      metadata: {},
    };

    try {
      // 清理输入数据中的 undefined 值
      const cleanedCreateData = _replaceUndefinedWithNull(createData);
      logger.info(
        "[Main] 开始流式创建项目，参数:",
        JSON.stringify(cleanedCreateData, null, 2),
      );

      streamControl = await httpClient.createProjectStream(cleanedCreateData, {
        // 进度回调
        onProgress: (data) => {
          accumulatedData.stages.push({
            stage: data.stage,
            message: data.message,
            timestamp: Date.now(),
          });
          logger.info(`[Main] 流式进度: ${data.stage} - ${data.message}`);

          // 发送流式进度事件
          event.sender.send("project:stream-chunk", {
            type: "progress",
            data: _replaceUndefinedWithNull(data),
          });

          // 发送任务执行事件
          event.sender.send("project:task-execute", {
            stage: data.stage,
            name: data.stage,
            message: data.message,
            status: "running",
            timestamp: Date.now(),
          });
        },

        // 内容回调
        onContent: (data) => {
          if (!accumulatedData.contentByStage[data.stage]) {
            accumulatedData.contentByStage[data.stage] = "";
          }
          accumulatedData.contentByStage[data.stage] += data.content;

          logger.info(
            `[Main] 流式内容: ${data.stage}, 长度: ${data.content.length}`,
          );
          event.sender.send("project:stream-chunk", {
            type: "content",
            data: _replaceUndefinedWithNull(data),
          });
        },

        // 完成回调
        onComplete: async (data) => {
          // 兼容不同引擎的数据结构
          // Web引擎: { type: "complete", files: [...], metadata: {...} }
          // Document/Data引擎: { type: "complete", project_type: "document", result: { files: [...], metadata: {...} } }
          const result = data.result || data;
          accumulatedData.files = result.files || [];
          accumulatedData.metadata = result.metadata || {};

          logger.info(
            "[Main] 流式创建完成，文件数量:",
            accumulatedData.files.length,
          );
          logger.info("[Main] 项目类型:", data.project_type);

          // 统一数据结构：将result中的数据提升到顶层
          if (data.result) {
            data.files = result.files;
            data.metadata = result.metadata;
          }

          // 保存到SQLite数据库
          if (database && accumulatedData.files.length > 0) {
            try {
              // 确定项目类型：优先使用后端返回的类型，然后用户指定的类型，最后默认web
              const projectType =
                data.project_type || cleanedCreateData.projectType || "web";

              // 构建项目对象
              const localProject = {
                id: crypto.randomUUID(),
                name: cleanedCreateData.name || "未命名项目",
                projectType: projectType,
                userId: cleanedCreateData.userId || "default-user",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: JSON.stringify(accumulatedData.metadata),
                user_id: cleanedCreateData.userId || "default-user",
                sync_status: "pending",
                file_count: accumulatedData.files.length, // 设置文件数量
              };

              logger.info("[Main] 保存项目到数据库，ID:", localProject.id);
              await database.saveProject(localProject);

              // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
              try {
                const projectConfig = getProjectConfig();
                const projectRootPath = path.join(
                  projectConfig.getProjectsRootPath(),
                  localProject.id,
                );

                logger.info(
                  "[Main] 创建项目目录:",
                  projectRootPath,
                  "项目类型:",
                  projectType,
                );
                await fs.mkdir(projectRootPath, { recursive: true });

                // 立即更新项目的root_path（无论项目类型和是否有文件）
                // updateProject 是同步函数
                database.updateProject(localProject.id, {
                  root_path: projectRootPath,
                });
                logger.info("[Main] 项目root_path已设置:", projectRootPath);

                // 如果有文件，写入到文件系统
                if (accumulatedData.files.length > 0) {
                  for (const file of accumulatedData.files) {
                    const filePath = path.join(projectRootPath, file.path);
                    logger.info("[Main] 写入文件:", filePath);

                    // 解码base64内容
                    let fileContent;
                    if (file.content_encoding === "base64") {
                      fileContent = Buffer.from(file.content, "base64");
                      logger.info(
                        "[Main] 已解码base64内容，大小:",
                        fileContent.length,
                        "bytes",
                      );
                    } else if (typeof file.content === "string") {
                      fileContent = Buffer.from(file.content, "utf-8");
                    } else {
                      fileContent = file.content;
                    }

                    await fs.writeFile(filePath, fileContent);
                    logger.info("[Main] 文件写入成功:", file.path);
                  }
                }
              } catch (writeError) {
                logger.error("[Main] 创建项目目录或写入文件失败:", writeError);
                logger.error("[Main] 错误堆栈:", writeError.stack);
                // 不抛出错误，继续处理
              }

              // 保存项目文件到数据库
              const cleanedFiles = _replaceUndefinedWithNull(
                accumulatedData.files,
              );
              logger.info(
                "[Main] 准备保存文件到数据库，文件数量:",
                cleanedFiles.length,
              );
              if (cleanedFiles.length > 0) {
                logger.info("[Main] 第一个文件:", {
                  path: cleanedFiles[0].path,
                  type: cleanedFiles[0].type,
                  hasContent: !!cleanedFiles[0].content,
                  contentLength: cleanedFiles[0].content
                    ? cleanedFiles[0].content.length
                    : 0,
                });
              }
              await database.saveProjectFiles(localProject.id, cleanedFiles);
              logger.info("[Main] 项目文件已保存到数据库");

              // 验证保存是否成功
              const savedFiles = database.getProjectFiles(localProject.id);
              logger.info(
                "[Main] 验证：数据库中的文件数量:",
                savedFiles?.length || 0,
              );

              // 更新项目的file_count
              if (savedFiles && savedFiles.length > 0) {
                // updateProject 是同步函数
                database.updateProject(localProject.id, {
                  file_count: savedFiles.length,
                  updated_at: Date.now(),
                });
                logger.info(
                  "[Main] 已更新项目的file_count为:",
                  savedFiles.length,
                );
              }

              // 返回包含本地ID的完整数据
              data.projectId = localProject.id;
            } catch (saveError) {
              logger.error("[Main] 保存项目失败:", saveError);
              event.sender.send("project:stream-chunk", {
                type: "error",
                error: `保存失败: ${saveError.message}`,
              });
              return;
            }
          }

          // 发送完成事件
          logger.info("[Main] ===== 发送complete事件到前端 =====");
          logger.info("[Main] Complete data keys:", Object.keys(data));
          logger.info("[Main] Complete data.projectId:", data.projectId);

          event.sender.send("project:stream-chunk", {
            type: "complete",
            data: _replaceUndefinedWithNull(data), // 清理undefined值以确保IPC序列化成功
          });

          logger.info("[Main] ===== Complete事件已发送 =====");
        },

        // 错误回调
        onError: (error) => {
          logger.error("[Main] 流式创建错误:", error);
          event.sender.send("project:stream-chunk", {
            type: "error",
            error: error.message,
          });
        },
      });

      // 监听取消事件
      const handleCancel = () => {
        logger.info("[Main] 收到取消请求");
        if (streamControl) {
          streamControl.cancel();
        }
      };
      ipcMain.once("project:stream-cancel-event", handleCancel);

      return { success: true };
    } catch (error) {
      logger.error("[Main] Stream create failed:", error);
      event.sender.send("project:stream-chunk", {
        type: "error",
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消流式创建
   * Channel: 'project:stream-cancel'
   */
  ipcMain.handle("project:stream-cancel", () => {
    logger.info("[Main] 触发取消事件");
    // 触发取消事件
    ipcMain.emit("project:stream-cancel-event");
    return { success: true };
  });

  /**
   * 快速创建项目（不使用AI）
   * Channel: 'project:create-quick'
   */
  ipcMain.handle("project:create-quick", async (_event, createData) => {
    try {
      const fs = require("fs").promises;
      const path = require("path");
      const { getProjectConfig } = require("./project-config");

      logger.info("[Main] 开始快速创建项目，参数:", createData);

      // 生成项目ID
      const projectId = crypto.randomUUID();
      const timestamp = Date.now();

      // 创建项目文件夹
      const projectConfig = getProjectConfig();
      const projectRootPath = path.join(
        projectConfig.getProjectsRootPath(),
        projectId,
      );

      logger.info("[Main] 创建项目目录:", projectRootPath);
      await fs.mkdir(projectRootPath, { recursive: true });

      // 创建一个默认的README.md文件
      const readmePath = path.join(projectRootPath, "README.md");
      const readmeContent = `# ${createData.name}\n\n${createData.description || "这是一个新建的项目。"}\n\n创建时间：${new Date().toLocaleString("zh-CN")}\n`;
      await fs.writeFile(readmePath, readmeContent, "utf-8");

      // 构建项目对象
      const project = {
        id: projectId,
        name: createData.name,
        description: createData.description || "",
        project_type: createData.projectType || "document", // 默认为document类型（允许的类型：web, document, data, app）
        user_id: createData.userId || "default-user",
        root_path: projectRootPath,
        created_at: timestamp,
        updated_at: timestamp,
        sync_status: "pending", // 使用pending状态（允许的类型：synced, pending, conflict, error）
        file_count: 1, // 包含README.md
        metadata: JSON.stringify({
          created_by: "quick-create",
          created_at: new Date().toISOString(),
        }),
      };

      // 保存到本地数据库
      if (project) {
        const database = await getActiveDatabase();
        await database.saveProject(project);
        logger.info("[Main] 项目已保存到本地数据库");

        // 保存项目文件记录
        const file = {
          project_id: projectId,
          file_name: "README.md",
          file_path: "README.md",
          file_type: "markdown",
          content: readmeContent,
          created_at: timestamp,
          updated_at: timestamp,
        };
        await database.saveProjectFiles(projectId, [file]);
        logger.info("[Main] 项目文件已保存到数据库");
      }

      logger.info("[Main] 快速创建项目成功，ID:", projectId);
      return _replaceUndefinedWithNull(project);
    } catch (error) {
      logger.error("[Main] 快速创建项目失败:", error);
      throw error;
    }
  });

  /**
   * 保存项目到本地SQLite
   * Channel: 'project:save'
   */
  ipcMain.handle("project:save", async (_event, project) => {
    try {
      const database = await getActiveDatabase();
      // 清理输入的 project 中的 undefined 值
      const cleanProject = _replaceUndefinedWithNull(project);
      const saved = database.saveProject(cleanProject);
      return removeUndefinedValues(saved);
    } catch (error) {
      logger.error("[Main] 保存项目失败:", error);
      throw error;
    }
  });

  /**
   * 更新项目
   * Channel: 'project:update'
   */
  ipcMain.handle("project:update", async (_event, projectId, updates) => {
    try {
      const database = await getActiveDatabase();

      // 清理输入的 updates 中的 undefined 值
      const cleanUpdates = _replaceUndefinedWithNull(updates);

      const updatedProject = {
        ...cleanUpdates,
        updated_at: Date.now(),
        sync_status: "pending",
      };

      const result = database.updateProject(projectId, updatedProject);
      return removeUndefinedValues(result);
    } catch (error) {
      logger.error("[Main] 更新项目失败:", error);
      throw error;
    }
  });

  /**
   * 删除项目（本地 + 后端）
   * Channel: 'project:delete'
   */
  ipcMain.handle("project:delete", async (_event, projectId) => {
    try {
      // 1. 先删除本地数据库（确保用户立即看不到）
      if (database) {
        try {
          await database.deleteProject(projectId);
          logger.info("[Main] 本地项目已删除:", projectId);
        } catch (dbError) {
          logger.warn(
            "[Main] 删除本地项目失败（继续删除后端）:",
            dbError.message,
          );
        }
      }

      // 2. 尝试删除后端（best effort，失败不影响结果）
      try {
        const { getProjectHTTPClient } = require("./http-client");
        const httpClient = getProjectHTTPClient();
        await httpClient.deleteProject(projectId);
        logger.info("[Main] 后端项目已删除:", projectId);
      } catch (httpError) {
        // 如果是"项目不存在"，视为成功（幂等性）
        if (httpError.message && httpError.message.includes("项目不存在")) {
          logger.info("[Main] 后端项目不存在，视为删除成功");
        } else {
          logger.warn(
            "[Main] 删除后端项目失败（已删除本地）:",
            httpError.message,
          );
        }
      }

      return { success: true };
    } catch (error) {
      logger.error("[Main] 删除项目失败:", error);
      throw error;
    }
  });

  /**
   * 删除本地项目
   * Channel: 'project:delete-local'
   */
  ipcMain.handle("project:delete-local", async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }
      return database.deleteProject(projectId);
    } catch (error) {
      logger.error("[Main] 删除本地项目失败:", error);
      throw error;
    }
  });

  /**
   * 从后端获取项目
   * Channel: 'project:fetch-from-backend'
   */
  ipcMain.handle("project:fetch-from-backend", async (_event, projectId) => {
    try {
      const { getProjectHTTPClient } = require("./http-client");
      const httpClient = getProjectHTTPClient();

      const project = await httpClient.getProject(projectId);

      // 保存到本地
      if (database && project) {
        await database.saveProject({
          ...project,
          sync_status: "synced",
          synced_at: Date.now(),
        });
      }

      return removeUndefinedValues(project);
    } catch (error) {
      logger.error("[Main] 从后端获取项目失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 路径修复操作 (Path Repair Operations)
  // ============================================================

  /**
   * 修复项目路径（为没有 root_path 的项目设置路径）
   * Channel: 'project:fix-path'
   */
  ipcMain.handle("project:fix-path", async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const fs = require("fs").promises;
      const path = require("path");

      // 获取项目信息
      const project = database.getProjectById(projectId);
      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      // 如果已经有 root_path，不需要修复
      if (project.root_path) {
        logger.info("[Main] 项目已有 root_path，无需修复:", project.root_path);
        return {
          success: true,
          message: "项目路径正常",
          path: project.root_path,
        };
      }

      // 创建项目目录
      const { getProjectConfig } = require("./project-config");
      const projectConfig = getProjectConfig();
      const projectRootPath = path.join(
        projectConfig.getProjectsRootPath(),
        projectId,
      );

      logger.info("[Main] 为项目创建目录:", projectRootPath);
      await fs.mkdir(projectRootPath, { recursive: true });

      // 更新项目的 root_path
      database.updateProject(projectId, {
        root_path: projectRootPath,
      });

      // 获取项目文件并写入文件系统
      const projectFiles = database.db
        .prepare("SELECT * FROM project_files WHERE project_id = ?")
        .all(projectId);

      let fileCount = 0;
      if (projectFiles && projectFiles.length > 0) {
        logger.info(`[Main] 写入 ${projectFiles.length} 个文件到文件系统`);

        for (const file of projectFiles) {
          try {
            const filePath = path.join(
              projectRootPath,
              file.file_path || file.file_name,
            );

            // 确保文件目录存在
            await fs.mkdir(path.dirname(filePath), { recursive: true });

            // 写入文件内容
            await fs.writeFile(filePath, file.content || "", "utf8");

            // 更新文件的 fs_path
            database.db.run(
              "UPDATE project_files SET fs_path = ? WHERE id = ?",
              [filePath, file.id],
            );

            fileCount++;
          } catch (fileError) {
            logger.error(`[Main] 写入文件失败: ${file.file_name}`, fileError);
          }
        }
      }

      database.saveToFile();

      logger.info("[Main] 项目路径修复完成:", projectRootPath);
      return {
        success: true,
        message: `路径已修复，写入 ${fileCount} 个文件`,
        path: projectRootPath,
        fileCount,
      };
    } catch (error) {
      logger.error("[Main] 修复项目路径失败:", error);
      throw error;
    }
  });

  /**
   * 修复项目的root_path（为document类型的项目创建目录并设置路径）
   * Channel: 'project:repair-root-path'
   */
  ipcMain.handle("project:repair-root-path", async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const project = database.db
        .prepare("SELECT * FROM projects WHERE id = ?")
        .get(projectId);
      if (!project) {
        throw new Error("项目不存在");
      }

      const projectType = project.project_type || project.projectType;
      if (projectType !== "document") {
        return { success: false, message: "只能修复document类型的项目" };
      }

      // 检查是否已有root_path
      if (project.root_path) {
        logger.info("[Main] 项目已有root_path:", project.root_path);
        return {
          success: true,
          message: "项目已有root_path",
          rootPath: project.root_path,
        };
      }

      // 创建项目目录
      const { getProjectConfig } = require("./project-config");
      const projectConfig = getProjectConfig();
      const projectRootPath = require("path").join(
        projectConfig.getProjectsRootPath(),
        projectId,
      );

      logger.info("[Main] 修复项目root_path，创建目录:", projectRootPath);
      await require("fs").promises.mkdir(projectRootPath, { recursive: true });

      // 更新数据库（updateProject 是同步函数）
      database.updateProject(projectId, {
        root_path: projectRootPath,
      });

      logger.info("[Main] 项目root_path修复完成:", projectRootPath);
      return { success: true, message: "修复成功", rootPath: projectRootPath };
    } catch (error) {
      logger.error("[Main] 修复项目root_path失败:", error);
      throw error;
    }
  });

  /**
   * 批量修复所有缺失root_path的document项目
   * Channel: 'project:repair-all-root-paths'
   */
  ipcMain.handle("project:repair-all-root-paths", async (_event) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      logger.info("[Main] ========== 开始批量修复项目root_path ==========");

      // 查找所有缺失root_path的document项目
      const brokenProjects = database.db
        .prepare(
          `
        SELECT id, name, project_type, root_path
        FROM projects
        WHERE project_type = 'document'
          AND (root_path IS NULL OR root_path = '')
        ORDER BY created_at DESC
      `,
        )
        .all();

      logger.info(`[Main] 发现 ${brokenProjects.length} 个缺失root_path的项目`);

      if (brokenProjects.length === 0) {
        return {
          success: true,
          message: "所有项目都有正确的root_path",
          fixed: 0,
          failed: 0,
          details: [],
        };
      }

      const { getProjectConfig } = require("./project-config");
      const projectConfig = getProjectConfig();
      const results = {
        success: true,
        fixed: 0,
        failed: 0,
        details: [],
      };

      // 逐个修复
      for (const project of brokenProjects) {
        try {
          const projectRootPath = require("path").join(
            projectConfig.getProjectsRootPath(),
            project.id,
          );

          logger.info(`[Main] 修复项目: ${project.name} (${project.id})`);
          logger.info(`[Main]   创建目录: ${projectRootPath}`);

          // 创建目录
          await require("fs").promises.mkdir(projectRootPath, {
            recursive: true,
          });

          // 更新数据库（updateProject 是同步函数）
          database.updateProject(project.id, {
            root_path: projectRootPath,
          });

          results.fixed++;
          results.details.push({
            id: project.id,
            name: project.name,
            status: "fixed",
            rootPath: projectRootPath,
          });

          logger.info(`[Main]   ✅ 修复成功`);
        } catch (error) {
          logger.error(`[Main]   ❌ 修复失败:`, error.message);
          results.failed++;
          results.details.push({
            id: project.id,
            name: project.name,
            status: "failed",
            error: error.message,
          });
        }
      }

      logger.info(`[Main] ========== 批量修复完成 ==========`);
      logger.info(`[Main] 修复成功: ${results.fixed} 个`);
      logger.info(`[Main] 修复失败: ${results.failed} 个`);

      results.message = `修复完成：成功 ${results.fixed} 个，失败 ${results.failed} 个`;
      return results;
    } catch (error) {
      logger.error("[Main] 批量修复失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 文件管理操作 (File Management Operations)
  // ============================================================

  /**
   * 获取项目文件列表（优化版本：使用缓存+分页）
   * Channel: 'project:get-files'
   */
  ipcMain.handle(
    "project:get-files",
    async (_event, projectId, fileType = null, pageNum = 1, pageSize = 50) => {
      try {
        logger.info(
          "[Main] ⚡ 获取项目文件(优化版), ProjectId:",
          projectId,
          ", FileType:",
          fileType,
          ", Page:",
          pageNum,
          "/",
          pageSize,
        );

        const startTime = Date.now();

        if (!database) {
          throw new Error("数据库未初始化");
        }

        // 计算分页参数
        const offset = (pageNum - 1) * pageSize;
        const limit = pageSize;

        // 使用文件缓存管理器获取文件
        const result = await fileCacheManager.getFiles(projectId, {
          offset,
          limit,
          fileType,
          parentPath: null, // 获取所有文件（不限制父路径）
          forceRefresh: false, // 不强制刷新，优先使用缓存
        });

        const duration = Date.now() - startTime;
        logger.info(
          `[Main] ⚡ 返回 ${result.files.length}/${result.total} 个文件` +
            ` (来自${result.fromCache ? "缓存" : "文件系统"}, 耗时 ${duration}ms)`,
        );

        // 返回与旧版本兼容的格式
        return {
          files: removeUndefinedValues(result.files),
          total: result.total,
          hasMore: result.hasMore,
          fromCache: result.fromCache,
        };
      } catch (error) {
        logger.error("[Main] 获取项目文件失败:", error);
        logger.error("[Main] Error details - message:", error?.message);
        logger.error("[Main] Error details - stack:", error?.stack);

        // 对于新项目或没有文件的项目，返回空结果而不是抛出错误
        if (
          error?.message?.includes("not found") ||
          error?.message?.includes("No such file") ||
          error?.message?.includes("ENOENT")
        ) {
          logger.warn("[Main] 项目文件不存在，返回空结果");
          return {
            files: [],
            total: 0,
            hasMore: false,
            fromCache: false,
          };
        }

        throw error;
      }
    },
  );

  /**
   * 刷新项目文件缓存
   * Channel: 'project:refresh-files'
   */
  ipcMain.handle("project:refresh-files", async (_event, projectId) => {
    try {
      logger.info("[Main] ⚡ 强制刷新文件缓存:", projectId);

      const result = await fileCacheManager.getFiles(projectId, {
        offset: 0,
        limit: 100,
        forceRefresh: true, // 强制刷新
      });

      logger.info(`[Main] ⚡ 缓存已刷新，共 ${result.total} 个文件`);

      return {
        success: true,
        total: result.total,
      };
    } catch (error) {
      logger.error("[Main] 刷新文件缓存失败:", error);
      throw error;
    }
  });

  /**
   * 清理项目文件缓存
   * Channel: 'project:clear-file-cache'
   */
  ipcMain.handle("project:clear-file-cache", async (_event, projectId) => {
    try {
      logger.info("[Main] ⚡ 清理文件缓存:", projectId);

      await fileCacheManager.clearCache(projectId);
      await fileCacheManager.stopFileWatcher(projectId);

      logger.info("[Main] ⚡ 缓存已清理");

      return { success: true };
    } catch (error) {
      logger.error("[Main] 清理文件缓存失败:", error);
      throw error;
    }
  });

  /**
   * 获取项目子目录文件列表（懒加载）
   * Channel: 'project:get-files-lazy'
   */
  ipcMain.handle(
    "project:get-files-lazy",
    async (_event, projectId, parentPath = "", pageNum = 1, pageSize = 100) => {
      try {
        logger.info(
          "[Main] ⚡ 懒加载文件, ProjectId:",
          projectId,
          ", ParentPath:",
          parentPath,
        );

        const offset = (pageNum - 1) * pageSize;

        const result = await fileCacheManager.getFiles(projectId, {
          offset,
          limit: pageSize,
          parentPath, // 仅加载指定目录的直接子项
          forceRefresh: false,
        });

        logger.info(`[Main] ⚡ 返回 ${result.files.length} 个子文件`);

        return {
          files: removeUndefinedValues(result.files),
          total: result.total,
          hasMore: result.hasMore,
        };
      } catch (error) {
        logger.error("[Main] 懒加载文件失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取单个文件
   * Channel: 'project:get-file'
   */
  ipcMain.handle("project:get-file", async (_event, fileId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }
      const stmt = database.db.prepare(
        "SELECT * FROM project_files WHERE id = ?",
      );
      const file = stmt.get(fileId);
      return removeUndefinedValues(file);
    } catch (error) {
      logger.error("[Main] 获取文件失败:", error);
      throw error;
    }
  });

  /**
   * 保存项目文件
   * Channel: 'project:save-files'
   */
  ipcMain.handle("project:save-files", async (_event, projectId, files) => {
    try {
      const database = await getActiveDatabase();
      database.saveProjectFiles(projectId, files);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 保存项目文件失败:", error);
      throw error;
    }
  });

  /**
   * 更新文件（支持乐观锁）
   * Channel: 'project:update-file'
   */
  ipcMain.handle("project:update-file", async (_event, fileUpdate) => {
    try {
      const { projectId, fileId, content, is_base64, expectedVersion } =
        fileUpdate;

      if (!database) {
        throw new Error("数据库未初始化");
      }

      // ✅ 乐观锁：检查版本号
      if (expectedVersion !== undefined) {
        const currentFile = database.db
          .prepare("SELECT * FROM project_files WHERE id = ?")
          .get(fileId);

        if (!currentFile) {
          throw new Error("文件不存在");
        }

        const currentVersion = currentFile.version || 1;

        // 版本不匹配，说明文件已被其他用户修改
        if (currentVersion !== expectedVersion) {
          logger.warn(
            `[Main] ⚠️ 文件版本冲突: ${fileId}, 期望版本 ${expectedVersion}, 当前版本 ${currentVersion}`,
          );

          throw new ConflictError("文件已被其他用户修改", {
            fileId,
            fileName: currentFile.file_name,
            expectedVersion,
            currentVersion,
            currentContent: currentFile.content,
            yourContent: content,
            updatedAt: currentFile.updated_at,
          });
        }
      }

      // 尝试调用后端API
      try {
        const ProjectFileAPI = require("./project-file-api");
        const result = await ProjectFileAPI.updateFile(projectId, fileId, {
          content,
          is_base64,
        });

        if (result.success && result.status !== 0) {
          // 后端成功，同时更新本地数据库并增加版本号
          database.updateProjectFile({
            ...fileUpdate,
            version: (expectedVersion || 1) + 1,
            updated_at: Date.now(),
          });

          return {
            success: true,
            version: (expectedVersion || 1) + 1,
          };
        }
      } catch (apiError) {
        logger.warn(
          "[Main] 后端API调用失败，降级到本地数据库:",
          apiError.message,
        );
      }

      // 降级到本地数据库
      logger.info("[Main] 使用本地数据库更新文件");

      // 更新并增加版本号
      const newVersion = (expectedVersion || 1) + 1;
      database.updateProjectFile({
        ...fileUpdate,
        version: newVersion,
        updated_at: Date.now(),
      });

      return {
        success: true,
        version: newVersion,
      };
    } catch (error) {
      // 如果是冲突错误，直接抛出（不降级）
      if (error instanceof ConflictError) {
        throw error;
      }

      logger.error("[Main] 更新文件失败:", error);

      // 其他错误尝试降级
      if (database) {
        try {
          database.updateProjectFile(fileUpdate);
          return { success: true };
        } catch (dbError) {
          logger.error("[Main] 降级到本地数据库也失败:", dbError);
        }
      }

      throw error;
    }
  });

  /**
   * 删除文件
   * Channel: 'project:delete-file'
   */
  ipcMain.handle("project:delete-file", async (_event, projectId, fileId) => {
    try {
      if (!database) {
        throw new Error("数据库未初始化");
      }

      const fs = require("fs").promises;
      const { getProjectConfig } = require("./project-config");
      const projectConfig = getProjectConfig();

      // 获取文件信息
      const file = database.db.get("SELECT * FROM project_files WHERE id = ?", [
        fileId,
      ]);

      if (file) {
        try {
          // 解析文件路径并删除物理文件
          const resolvedPath = projectConfig.resolveProjectPath(file.file_path);
          logger.info("[Main] 删除物理文件:", resolvedPath);
          await fs.unlink(resolvedPath);
        } catch (error) {
          logger.warn("[Main] 删除物理文件失败 (可能已不存在):", error.message);
        }
      }

      // 从数据库删除记录
      database.db.run("DELETE FROM project_files WHERE id = ?", [fileId]);

      // 更新项目的文件统计
      try {
        const totalFiles = database.db
          .prepare(
            `SELECT COUNT(*) as count FROM project_files WHERE project_id = ?`,
          )
          .get(projectId);

        const fileCount = totalFiles ? totalFiles.count : 0;
        database.db.run(
          `UPDATE projects SET file_count = ?, updated_at = ? WHERE id = ?`,
          [fileCount, Date.now(), projectId],
        );
      } catch (updateError) {
        logger.error("[Main] 更新项目file_count失败:", updateError);
      }

      database.saveToFile();

      logger.info("[Main] 文件删除成功:", fileId);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 删除文件失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 监听器操作 (Watcher Operations)
  // ============================================================

  /**
   * 索引项目对话历史
   * Channel: 'project:indexConversations'
   */
  ipcMain.handle(
    "project:indexConversations",
    async (_event, projectId, options = {}) => {
      try {
        const { getProjectRAGManager } = require("./project-rag");
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        const result = await projectRAG.indexConversationHistory(
          projectId,
          options,
        );

        logger.info("[Main] 对话历史索引完成:", result);
        return result;
      } catch (error) {
        logger.error("[Main] 索引对话历史失败:", error);
        throw error;
      }
    },
  );

  /**
   * 启动文件监听
   * Channel: 'project:startWatcher'
   */
  ipcMain.handle(
    "project:startWatcher",
    async (_event, projectId, projectPath) => {
      try {
        const { getProjectRAGManager } = require("./project-rag");
        const projectRAG = getProjectRAGManager();

        await projectRAG.initialize();

        await projectRAG.startFileWatcher(projectId, projectPath);

        logger.info("[Main] 文件监听已启动:", projectPath);
        return { success: true };
      } catch (error) {
        logger.error("[Main] 启动文件监听失败:", error);
        throw error;
      }
    },
  );

  /**
   * 停止文件监听
   * Channel: 'project:stopWatcher'
   */
  ipcMain.handle("project:stopWatcher", async (_event, projectId) => {
    try {
      const { getProjectRAGManager } = require("./project-rag");
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      projectRAG.stopFileWatcher(projectId);

      logger.info("[Main] 文件监听已停止:", projectId);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 停止文件监听失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 路径解析操作 (Path Resolution)
  // ============================================================

  /**
   * 解析项目路径
   * Channel: 'project:resolve-path'
   */
  ipcMain.handle("project:resolve-path", async (_event, relativePath) => {
    try {
      const { getProjectConfig } = require("./project-config");
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(relativePath);
      return { success: true, path: resolvedPath };
    } catch (error) {
      logger.error("[Main] 解析路径失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 同步操作 (Sync Operations)
  // ============================================================

  /**
   * 同步项目（支持防抖和锁）
   * Channel: 'project:sync'
   */
  ipcMain.handle("project:sync", async (_event, userId) => {
    // 使用全局同步锁（用户级别）
    const lockKey = `user-${userId}`;

    return syncLockManager.withLock(
      lockKey,
      "sync-all",
      async () => {
        logger.info("[Main] 🔄 开始同步所有项目, userId:", userId);

        const { getProjectHTTPClient } = require("./http-client");
        const httpClient = getProjectHTTPClient();

        // 1. 获取后端项目列表
        const response = await httpClient.listProjects(userId, 1, 1000);
        const backendProjects =
          response && response.records ? response.records : [];
        logger.info("[Main] 从后端获取到项目数量:", backendProjects.length);

        // 2. 获取本地项目
        const localProjects = database ? database.getProjects(userId) : [];

        // 3. 合并数据并同步文件
        if (database) {
          for (const project of backendProjects) {
            try {
              // 获取项目详情（包含文件列表）
              let projectDetail = project;
              if (!project.files || project.files.length === 0) {
                try {
                  projectDetail = await httpClient.getProject(project.id);
                } catch (detailError) {
                  logger.warn(
                    `[Main] 获取项目 ${project.id} 详情失败:`,
                    detailError.message,
                  );
                  projectDetail = project;
                }
              }

              const createdAt = projectDetail.createdAt
                ? new Date(projectDetail.createdAt).getTime()
                : Date.now();
              const updatedAt = projectDetail.updatedAt
                ? new Date(projectDetail.updatedAt).getTime()
                : Date.now();

              // 构建项目对象，避免 undefined 值
              const projectData = {
                id: projectDetail.id,
                user_id: projectDetail.userId,
                name: projectDetail.name,
                project_type: projectDetail.projectType,
                status: projectDetail.status || "active",
                file_count: projectDetail.fileCount || 0,
                total_size: projectDetail.totalSize || 0,
                tags: JSON.stringify(projectDetail.tags || []),
                metadata: JSON.stringify(projectDetail.metadata || {}),
                created_at: createdAt,
                updated_at: updatedAt,
                synced_at: Date.now(),
                sync_status: "synced",
              };

              // 只有当字段存在时才添加
              if (projectDetail.description) {
                projectData.description = projectDetail.description;
              }
              if (projectDetail.rootPath) {
                projectData.root_path = projectDetail.rootPath;
              }
              if (projectDetail.coverImageUrl) {
                projectData.cover_image_url = projectDetail.coverImageUrl;
              }

              database.saveProject(projectData);

              // 同步项目文件
              if (
                projectDetail.files &&
                Array.isArray(projectDetail.files) &&
                projectDetail.files.length > 0
              ) {
                try {
                  database.saveProjectFiles(
                    projectDetail.id,
                    projectDetail.files,
                  );
                } catch (fileError) {
                  logger.error(
                    `[Main] 同步项目 ${projectDetail.id} 文件失败:`,
                    fileError,
                  );
                }
              }
            } catch (projectError) {
              logger.error(`[Main] 同步项目 ${project.id} 失败:`, projectError);
            }
          }
        }

        // 4. 推送本地pending的项目到后端
        const pendingProjects = localProjects.filter(
          (p) => p.sync_status === "pending",
        );
        for (const project of pendingProjects) {
          try {
            const cleanProject = _replaceUndefinedWithNull(project);
            await httpClient.syncProject(cleanProject);

            if (database) {
              database.updateProject(project.id, {
                sync_status: "synced",
                synced_at: Date.now(),
              });
            }
          } catch (syncError) {
            logger.error(`[Main] 同步项目 ${project.id} 失败:`, syncError);
          }
        }

        logger.info("[Main] 🔄 ✅ 同步完成");
        return { success: true };
      },
      {
        throwOnLocked: false, // 不抛出错误，返回 skipped
        debounce: 2000, // 2秒防抖
      },
    );
  });

  /**
   * 同步单个项目（支持锁）
   * Channel: 'project:sync-one'
   */
  ipcMain.handle("project:sync-one", async (_event, projectId) => {
    return syncLockManager.withLock(
      projectId,
      "sync-one",
      async () => {
        logger.info("[Main] 🔄 开始同步单个项目:", projectId);

        const { getProjectHTTPClient } = require("./http-client");
        const httpClient = getProjectHTTPClient();

        if (!database) {
          throw new Error("数据库未初始化");
        }

        const project = database.getProjectById(projectId);
        if (!project) {
          throw new Error("项目不存在");
        }

        const cleanProject = _replaceUndefinedWithNull(project);
        await httpClient.syncProject(cleanProject);

        database.updateProject(projectId, {
          sync_status: "synced",
          synced_at: Date.now(),
        });

        logger.info("[Main] 🔄 ✅ 项目同步完成:", projectId);
        return { success: true };
      },
      {
        throwOnLocked: true, // 抛出错误，告知用户正在同步
        debounce: 1000, // 1秒防抖
      },
    );
  });

  // ============================================================
  // 项目恢复操作 (Project Recovery Operations)
  // ============================================================

  /**
   * 扫描可恢复的项目
   * Channel: 'project:scan-recoverable'
   */
  ipcMain.handle("project:scan-recoverable", async () => {
    try {
      const ProjectRecovery = require("../sync/project-recovery");
      const recovery = new ProjectRecovery(database);
      const recoverableProjects = recovery.scanRecoverableProjects();

      logger.info(`[Main] 扫描到 ${recoverableProjects.length} 个可恢复的项目`);
      return {
        success: true,
        projects: recoverableProjects,
      };
    } catch (error) {
      logger.error("[Main] 扫描可恢复项目失败:", error);
      return {
        success: false,
        error: error.message,
        projects: [],
      };
    }
  });

  /**
   * 恢复单个项目
   * Channel: 'project:recover'
   */
  ipcMain.handle("project:recover", async (_event, projectId) => {
    try {
      const ProjectRecovery = require("../sync/project-recovery");
      const recovery = new ProjectRecovery(database);
      const success = recovery.recoverProject(projectId);

      if (success) {
        logger.info(`[Main] 成功恢复项目: ${projectId}`);
        return { success: true };
      } else {
        throw new Error("恢复失败");
      }
    } catch (error) {
      logger.error(`[Main] 恢复项目失败: ${projectId}`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 批量恢复项目
   * Channel: 'project:recover-batch'
   */
  ipcMain.handle("project:recover-batch", async (_event, projectIds) => {
    try {
      const ProjectRecovery = require("../sync/project-recovery");
      const recovery = new ProjectRecovery(database);
      const results = recovery.recoverProjects(projectIds);

      logger.info(
        `[Main] 批量恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`,
      );
      return {
        success: true,
        results,
      };
    } catch (error) {
      logger.error("[Main] 批量恢复项目失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 自动恢复所有可恢复的项目
   * Channel: 'project:auto-recover'
   */
  ipcMain.handle("project:auto-recover", async () => {
    try {
      const ProjectRecovery = require("../sync/project-recovery");
      const recovery = new ProjectRecovery(database);
      const results = recovery.autoRecoverAll();

      logger.info(
        `[Main] 自动恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`,
      );
      return {
        success: true,
        results,
      };
    } catch (error) {
      logger.error("[Main] 自动恢复失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取恢复统计信息
   * Channel: 'project:recovery-stats'
   */
  ipcMain.handle("project:recovery-stats", async () => {
    try {
      const ProjectRecovery = require("../sync/project-recovery");
      const recovery = new ProjectRecovery(database);
      const stats = recovery.getRecoveryStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      logger.error("[Main] 获取恢复统计失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 统计操作 (Statistics Operations)
  // ============================================================

  /**
   * 启动项目统计
   * Channel: 'project:stats:start'
   */
  ipcMain.handle(
    "project:stats:start",
    async (_event, projectId, projectPath) => {
      try {
        const database = await getActiveDatabase();

        const { getStatsCollector } = require("./stats-collector");
        const statsCollector = getStatsCollector(database.db);

        if (!statsCollector) {
          logger.warn("[Main] 统计收集器初始化失败");
          return { success: false, error: "统计收集器初始化失败" };
        }

        statsCollector.startWatching(projectId, projectPath);

        logger.info("[Main] 项目统计已启动:", projectId);
        return { success: true };
      } catch (error) {
        logger.error("[Main] 启动项目统计失败:", error);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 停止项目统计
   * Channel: 'project:stats:stop'
   */
  ipcMain.handle("project:stats:stop", async (_event, projectId) => {
    try {
      const database = await getActiveDatabase();

      const { getStatsCollector } = require("./stats-collector");
      const statsCollector = getStatsCollector(database.db);

      if (!statsCollector) {
        logger.warn("[Main] 统计收集器初始化失败");
        return { success: false, error: "统计收集器初始化失败" };
      }

      statsCollector.stopWatching(projectId);

      logger.info("[Main] 项目统计已停止:", projectId);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 停止项目统计失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取项目统计
   * Channel: 'project:stats:get'
   */
  ipcMain.handle("project:stats:get", async (_event, projectId) => {
    try {
      const database = await getActiveDatabase();

      const { getStatsCollector } = require("./stats-collector");
      const statsCollector = getStatsCollector(database.db);

      if (!statsCollector) {
        throw new Error("统计收集器初始化失败");
      }

      const stats = statsCollector.getStats(projectId);

      return { success: true, stats };
    } catch (error) {
      logger.error("[Main] 获取项目统计失败:", error);
      throw error;
    }
  });

  /**
   * 更新项目统计
   * Channel: 'project:stats:update'
   */
  ipcMain.handle("project:stats:update", async (_event, projectId) => {
    try {
      const database = await getActiveDatabase();

      const { getStatsCollector } = require("./stats-collector");
      const statsCollector = getStatsCollector(database.db);

      if (!statsCollector) {
        throw new Error("统计收集器初始化失败");
      }

      await statsCollector.updateStats(projectId, "manual", "");

      logger.info("[Main] 项目统计已更新:", projectId);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 更新项目统计失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 模板管理操作 (Template Management Operations)
  // ============================================================

  /**
   * 获取所有模板（预置 + 自定义）
   * Channel: 'template:get-all'
   */
  ipcMain.handle("template:get-all", async () => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      const templates = templateLibrary.getAllTemplates();
      logger.info(`[Main] 获取所有模板，数量: ${templates.length}`);

      return {
        success: true,
        templates,
        total: templates.length,
      };
    } catch (error) {
      logger.error("[Main] 获取模板列表失败:", error);
      return {
        success: false,
        error: error.message,
        templates: [],
        total: 0,
      };
    }
  });

  /**
   * 根据ID获取模板
   * Channel: 'template:get-by-id'
   */
  ipcMain.handle("template:get-by-id", async (_event, templateId) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      const template = templateLibrary.getTemplateById(templateId);

      if (!template) {
        return {
          success: false,
          error: `模板不存在: ${templateId}`,
          template: null,
        };
      }

      logger.info(`[Main] 获取模板: ${templateId}`);
      return {
        success: true,
        template,
      };
    } catch (error) {
      logger.error("[Main] 获取模板失败:", error);
      return {
        success: false,
        error: error.message,
        template: null,
      };
    }
  });

  /**
   * 根据分类获取模板
   * Channel: 'template:get-by-category'
   */
  ipcMain.handle("template:get-by-category", async (_event, category) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      const templates = templateLibrary.getTemplatesByCategory(category);
      logger.info(
        `[Main] 获取分类 ${category} 的模板，数量: ${templates.length}`,
      );

      return {
        success: true,
        templates,
        category,
      };
    } catch (error) {
      logger.error("[Main] 获取分类模板失败:", error);
      return {
        success: false,
        error: error.message,
        templates: [],
      };
    }
  });

  /**
   * 搜索模板
   * Channel: 'template-library:search'
   */
  ipcMain.handle(
    "template-library:search",
    async (_event, query, options = {}) => {
      try {
        const { getTemplateLibrary } = require("./template-library");
        const templateLibrary = getTemplateLibrary();
        await templateLibrary.initialize();

        const templates = templateLibrary.search(query, options);
        logger.info(`[Main] 搜索模板 "${query}"，结果: ${templates.length}`);

        return {
          success: true,
          templates,
          query,
          total: templates.length,
        };
      } catch (error) {
        logger.error("[Main] 搜索模板失败:", error);
        return {
          success: false,
          error: error.message,
          templates: [],
        };
      }
    },
  );

  /**
   * 推荐模板（基于项目描述）
   * Channel: 'template-library:recommend'
   */
  ipcMain.handle(
    "template-library:recommend",
    async (_event, description, limit = 5) => {
      try {
        const { getTemplateLibrary } = require("./template-library");
        const templateLibrary = getTemplateLibrary();
        await templateLibrary.initialize();

        const templates = templateLibrary.recommend(description, limit);
        logger.info(`[Main] 推荐模板，数量: ${templates.length}`);

        return {
          success: true,
          templates,
          description,
        };
      } catch (error) {
        logger.error("[Main] 推荐模板失败:", error);
        return {
          success: false,
          error: error.message,
          templates: [],
        };
      }
    },
  );

  /**
   * 获取模板预览（树形结构）
   * Channel: 'template-library:preview'
   */
  ipcMain.handle("template-library:preview", async (_event, templateId) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      const preview = templateLibrary.getTemplatePreview(templateId);

      if (!preview) {
        return {
          success: false,
          error: `模板不存在: ${templateId}`,
          preview: null,
        };
      }

      logger.info(`[Main] 获取模板预览: ${templateId}`);
      return {
        success: true,
        preview,
      };
    } catch (error) {
      logger.error("[Main] 获取模板预览失败:", error);
      return {
        success: false,
        error: error.message,
        preview: null,
      };
    }
  });

  /**
   * 保存自定义模板
   * Channel: 'template:save-custom'
   */
  ipcMain.handle("template:save-custom", async (_event, template) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      const savedTemplate = await templateLibrary.saveCustomTemplate(template);
      logger.info(`[Main] 保存自定义模板: ${savedTemplate.id}`);

      return {
        success: true,
        template: savedTemplate,
      };
    } catch (error) {
      logger.error("[Main] 保存自定义模板失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 删除自定义模板
   * Channel: 'template:delete-custom'
   */
  ipcMain.handle("template:delete-custom", async (_event, templateId) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      await templateLibrary.deleteCustomTemplate(templateId);
      logger.info(`[Main] 删除自定义模板: ${templateId}`);

      return {
        success: true,
        templateId,
      };
    } catch (error) {
      logger.error("[Main] 删除自定义模板失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导出模板
   * Channel: 'template:export'
   */
  ipcMain.handle("template:export", async (_event, templateIds) => {
    try {
      const { getTemplateLibrary } = require("./template-library");
      const templateLibrary = getTemplateLibrary();
      await templateLibrary.initialize();

      let exportData;
      if (Array.isArray(templateIds)) {
        exportData = await templateLibrary.exportTemplates(templateIds);
      } else {
        exportData = await templateLibrary.exportTemplate(templateIds);
      }

      logger.info(`[Main] 导出模板成功`);
      return {
        success: true,
        data: exportData,
      };
    } catch (error) {
      logger.error("[Main] 导出模板失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 导入模板
   * Channel: 'template:import'
   */
  ipcMain.handle(
    "template:import",
    async (_event, importData, options = {}) => {
      try {
        const { getTemplateLibrary } = require("./template-library");
        const templateLibrary = getTemplateLibrary();
        await templateLibrary.initialize();

        const results = await templateLibrary.importTemplate(
          importData,
          options,
        );
        logger.info(
          `[Main] 导入模板完成: 成功 ${results.success.length}, 失败 ${results.failed.length}, 跳过 ${results.skipped.length}`,
        );

        return {
          success: true,
          results,
        };
      } catch (error) {
        logger.error("[Main] 导入模板失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 从项目创建模板
   * Channel: 'template:create-from-project'
   */
  ipcMain.handle(
    "template:create-from-project",
    async (_event, projectPath, templateInfo) => {
      try {
        const { getTemplateLibrary } = require("./template-library");
        const templateLibrary = getTemplateLibrary();
        await templateLibrary.initialize();

        const template = await templateLibrary.createTemplateFromProject(
          projectPath,
          templateInfo,
        );
        logger.info(`[Main] 从项目创建模板: ${template.id}`);

        return {
          success: true,
          template,
        };
      } catch (error) {
        logger.error("[Main] 从项目创建模板失败:", error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  );

  /**
   * 获取项目类型列表（与Android对齐的12种）
   * Channel: 'project-types:get-all'
   */
  ipcMain.handle("project-types:get-all", async () => {
    try {
      const {
        getProjectTypes,
        getTemplateCategories,
      } = require("./project-types");

      const projectTypes = getProjectTypes();
      const templateCategories = getTemplateCategories();

      logger.info(`[Main] 获取项目类型，数量: ${projectTypes.length}`);

      return {
        success: true,
        projectTypes,
        templateCategories,
      };
    } catch (error) {
      logger.error("[Main] 获取项目类型失败:", error);
      return {
        success: false,
        error: error.message,
        projectTypes: [],
        templateCategories: [],
      };
    }
  });

  /**
   * 从模板创建项目
   * Channel: 'project:create-from-template'
   */
  ipcMain.handle("project:create-from-template", async (_event, createData) => {
    try {
      const path = require("path");
      const crypto = require("crypto");
      const { getProjectConfig } = require("./project-config");
      const ProjectStructureManager = require("./project-structure");

      const {
        templateId,
        name,
        description,
        userId = "default-user",
      } = createData;

      logger.info(`[Main] 从模板创建项目: ${templateId}, 名称: ${name}`);

      // 生成项目ID和路径
      const projectId = crypto.randomUUID();
      const projectConfig = getProjectConfig();
      const projectRootPath = path.join(
        projectConfig.getProjectsRootPath(),
        projectId,
      );

      // 使用 ProjectStructureManager 从模板创建
      const structureManager = new ProjectStructureManager();
      const result = await structureManager.createFromTemplate(
        projectRootPath,
        templateId,
        name,
      );

      // 保存到数据库
      if (database) {
        const project = {
          id: projectId,
          name: name,
          description: description || "",
          project_type: result.projectType,
          user_id: userId,
          root_path: projectRootPath,
          created_at: Date.now(),
          updated_at: Date.now(),
          sync_status: "pending",
          file_count: result.files.length,
          metadata: JSON.stringify({
            created_from_template: templateId,
            template_name: result.templateName,
          }),
        };

        await database.saveProject(project);
        logger.info("[Main] 项目已保存到数据库, ID:", projectId);
      }

      return {
        success: true,
        projectId,
        projectPath: projectRootPath,
        templateId,
        templateName: result.templateName,
        files: result.files,
        directories: result.directories,
      };
    } catch (error) {
      logger.error("[Main] 从模板创建项目失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info(
    "[Project Core IPC] ✓ All Project Core IPC handlers registered successfully (47 handlers)",
  );
}

module.exports = {
  registerProjectCoreIPC,
};
