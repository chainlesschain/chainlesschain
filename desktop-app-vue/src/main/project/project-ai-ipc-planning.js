/**
 * Project AI IPC handlers — planning group.
 * Split verbatim from project-ai-ipc.js registerProjectAIIPC(); ipcMain + deps via ctx.
 *
 * @module project/project-ai-ipc-planning
 */
const { logger } = require("../utils/logger.js");
const path = require("path");
const { getMessageAggregator } = require("../utils/message-aggregator.js");

function registerPlanningHandlers(ctx) {
  const {
    ipcMain,
    database,
    aiEngineManager,
    mainWindow,
    scanAndRegisterProjectFiles,
  } = ctx;

  // ============================================================
  // AI 任务规划 (Task Planning)
  // ============================================================

  /**
   * AI智能拆解任务
   * Channel: 'project:decompose-task'
   */
  ipcMain.handle(
    "project:decompose-task",
    async (_event, userRequest, projectContext) => {
      try {
        logger.info("[Main] AI任务拆解:", userRequest);

        if (!aiEngineManager) {
          const {
            getAIEngineManager,
          } = require("../ai-engine/ai-engine-manager");
          const manager = getAIEngineManager();
          await manager.initialize();
          const taskPlanner = manager.getTaskPlanner();
          return await taskPlanner.decomposeTask(userRequest, projectContext);
        }

        await aiEngineManager.initialize();
        const taskPlanner = aiEngineManager.getTaskPlanner();
        return await taskPlanner.decomposeTask(userRequest, projectContext);
      } catch (error) {
        logger.error("[Main] AI任务拆解失败:", error);
        throw error;
      }
    },
  );

  /**
   * 执行任务计划
   * Channel: 'project:execute-task-plan'
   */
  ipcMain.handle(
    "project:execute-task-plan",
    async (_event, taskPlanId, projectContext) => {
      try {
        logger.info("[Main] 执行任务计划:", taskPlanId);
        const { getProjectConfig } = require("./project-config");

        if (!aiEngineManager) {
          const {
            getAIEngineManager,
          } = require("../ai-engine/ai-engine-manager");
          const manager = getAIEngineManager();
          await manager.initialize();
        } else {
          await aiEngineManager.initialize();
        }

        const taskPlanner = aiEngineManager.getTaskPlanner();
        const taskPlan = await taskPlanner.getTaskPlan(taskPlanId);
        if (!taskPlan) {
          throw new Error(`任务计划不存在: ${taskPlanId}`);
        }

        const projectId = projectContext.projectId || projectContext.id;
        logger.info(
          "[Main] 检查项目路径 - projectId:",
          projectId,
          "root_path:",
          projectContext.root_path,
        );

        if (!projectContext.root_path) {
          const fs = require("fs").promises;
          const path = require("path");
          const projectConfig = getProjectConfig();
          const dirName = projectId || `task_${taskPlanId}`;
          const projectRootPath = path.join(
            projectConfig.getProjectsRootPath(),
            dirName,
          );

          await fs.mkdir(projectRootPath, { recursive: true });
          logger.info("[Main] 项目目录已创建:", projectRootPath);

          if (projectId) {
            database.updateProject(projectId, {
              root_path: projectRootPath,
              updated_at: Date.now(),
            });
          }

          projectContext.root_path = projectRootPath;
        }

        // ⚡ 优化：使用消息聚合器批量推送进度更新
        const messageAggregator = getMessageAggregator(mainWindow);

        const result = await taskPlanner.executeTaskPlan(
          taskPlan,
          projectContext,
          (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              // 使用聚合器推送，100ms批量发送
              messageAggregator.push("task:progress-update", progress);
            }
          },
        );

        // 任务执行完成，立即flush剩余消息
        messageAggregator.flushNow();

        if (result.success && scanAndRegisterProjectFiles) {
          try {
            let scanPath = projectContext.root_path;

            if (result.results && Array.isArray(result.results)) {
              for (const taskResult of result.results) {
                if (taskResult && taskResult.projectPath) {
                  scanPath = taskResult.projectPath;
                  break;
                }
              }
            }

            if (scanPath) {
              const filesRegistered = await scanAndRegisterProjectFiles(
                projectId,
                scanPath,
              );

              if (
                filesRegistered > 0 &&
                mainWindow &&
                !mainWindow.isDestroyed()
              ) {
                mainWindow.webContents.send("project:files-updated", {
                  projectId: projectId,
                  filesCount: filesRegistered,
                });
              }
            }
          } catch (scanError) {
            logger.error("[Main] 扫描并注册文件失败:", scanError);
          }
        }

        return result;
      } catch (error) {
        logger.error("[Main] 执行任务计划失败:", error);
        throw error;
      }
    },
  );

  /**
   * 获取任务计划
   * Channel: 'project:get-task-plan'
   */
  ipcMain.handle("project:get-task-plan", async (_event, taskPlanId) => {
    try {
      if (!aiEngineManager) {
        const {
          getAIEngineManager,
        } = require("../ai-engine/ai-engine-manager");
        const manager = getAIEngineManager();
        await manager.initialize();
        return await manager.getTaskPlanner().getTaskPlan(taskPlanId);
      }

      await aiEngineManager.initialize();
      return await aiEngineManager.getTaskPlanner().getTaskPlan(taskPlanId);
    } catch (error) {
      logger.error("[Main] 获取任务计划失败:", error);
      throw error;
    }
  });

  /**
   * 获取项目的任务计划历史
   * Channel: 'project:get-task-plan-history'
   */
  ipcMain.handle(
    "project:get-task-plan-history",
    async (_event, projectId, limit = 10) => {
      try {
        if (!aiEngineManager) {
          const {
            getAIEngineManager,
          } = require("../ai-engine/ai-engine-manager");
          const manager = getAIEngineManager();
          await manager.initialize();
          return await manager
            .getTaskPlanner()
            .getTaskPlanHistory(projectId, limit);
        }

        await aiEngineManager.initialize();
        return await aiEngineManager
          .getTaskPlanner()
          .getTaskPlanHistory(projectId, limit);
      } catch (error) {
        logger.error("[Main] 获取任务计划历史失败:", error);
        throw error;
      }
    },
  );

  /**
   * 取消任务计划
   * Channel: 'project:cancel-task-plan'
   */
  ipcMain.handle("project:cancel-task-plan", async (_event, taskPlanId) => {
    try {
      if (!aiEngineManager) {
        const {
          getAIEngineManager,
        } = require("../ai-engine/ai-engine-manager");
        const manager = getAIEngineManager();
        await manager.initialize();
        await manager.getTaskPlanner().cancelTaskPlan(taskPlanId);
        return { success: true };
      }

      await aiEngineManager.initialize();
      await aiEngineManager.getTaskPlanner().cancelTaskPlan(taskPlanId);
      return { success: true };
    } catch (error) {
      logger.error("[Main] 取消任务计划失败:", error);
      throw error;
    }
  });
}

module.exports = { registerPlanningHandlers };
