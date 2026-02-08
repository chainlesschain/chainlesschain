/**
 * 带检查点的流式项目创建
 * 支持断点续传和自动重试
 */

const { logger } = require("../utils/logger");
const CheckpointManager = require("./checkpoint-manager");
const crypto = require("crypto");
const fs = require("fs").promises;
const path = require("path");

/**
 * 流式创建项目（支持断点续传）
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} 创建结果
 */
async function createProjectWithCheckpoint(options) {
  const {
    createData,
    httpClient,
    database,
    projectConfig,
    event,
    checkpointId = null, // 如果提供，则从检查点恢复
    maxRetries = 3,
  } = options;

  const checkpointManager = new CheckpointManager(database);

  // 1. 检查是否从检查点恢复
  let checkpoint = null;
  let resumeFrom = null;

  if (checkpointId) {
    checkpoint = checkpointManager.getCheckpoint(checkpointId);
    if (checkpoint) {
      logger.info(`[StreamCheckpoint] 从检查点恢复: ${checkpointId}`);
      resumeFrom = {
        completedStages: checkpoint.completed_stages,
        completedFiles: checkpoint.completed_files,
        accumulatedData: checkpoint.accumulated_data,
      };
    }
  }

  // 2. 创建新检查点（如果不是恢复）
  if (!checkpoint) {
    checkpoint = checkpointManager.createCheckpoint({
      projectId: null, // 项目创建中，暂无ID
      operation: "create-stream",
      currentStage: "init",
      completedStages: [],
      completedFiles: [],
      accumulatedData: {
        stages: [],
        contentByStage: {},
        files: [],
        metadata: {},
      },
    });
  }

  // 3. 流式状态（从检查点恢复）
  const accumulatedData = resumeFrom
    ? resumeFrom.accumulatedData
    : {
        stages: [],
        contentByStage: {},
        files: [],
        metadata: {},
      };

  const completedStages = resumeFrom ? resumeFrom.completedStages : [];
  const completedFiles = resumeFrom ? resumeFrom.completedFiles : [];

  const retryCount = checkpoint.retry_count || 0;
  let streamControl = null;

  try {
    // 4. 启动流式创建
    streamControl = await httpClient.createProjectStream(createData, {
      // 恢复参数
      resumeFrom: resumeFrom
        ? {
            completedStages,
            completedFiles,
          }
        : null,

      // 进度回调
      onProgress: async (data) => {
        try {
          // 记录阶段
          accumulatedData.stages.push({
            stage: data.stage,
            message: data.message,
            timestamp: Date.now(),
          });

          // 更新检查点
          checkpointManager.updateCheckpoint(checkpoint.id, {
            currentStage: data.stage,
            completedStages: completedStages,
            accumulatedData,
          });

          logger.info(
            `[StreamCheckpoint] 流式进度: ${data.stage} - ${data.message}`,
          );

          // 发送流式进度事件
          event.sender.send("project:stream-chunk", {
            type: "progress",
            data: {
              ...data,
              checkpointId: checkpoint.id,
            },
          });

          // 发送任务执行事件
          event.sender.send("project:task-execute", {
            stage: data.stage,
            name: data.stage,
            message: data.message,
            status: "running",
            timestamp: Date.now(),
          });
        } catch (error) {
          logger.error("[StreamCheckpoint] 进度回调失败:", error);
        }
      },

      // 内容回调
      onContent: async (data) => {
        try {
          if (!accumulatedData.contentByStage[data.stage]) {
            accumulatedData.contentByStage[data.stage] = "";
          }
          accumulatedData.contentByStage[data.stage] += data.content;

          // 定期保存检查点（每收到 10KB 内容）
          if (
            accumulatedData.contentByStage[data.stage].length % 10240 <
            data.content.length
          ) {
            checkpointManager.updateCheckpoint(checkpoint.id, {
              accumulatedData,
            });
          }

          logger.info(
            `[StreamCheckpoint] 流式内容: ${data.stage}, 长度: ${data.content.length}`,
          );

          event.sender.send("project:stream-chunk", {
            type: "content",
            data: {
              ...data,
              checkpointId: checkpoint.id,
            },
          });
        } catch (error) {
          logger.error("[StreamCheckpoint] 内容回调失败:", error);
        }
      },

      // 文件回调（每个文件生成立即保存）
      onFile: async (file) => {
        try {
          logger.info(`[StreamCheckpoint] 文件生成: ${file.path}`);

          // 立即保存文件到累积数据
          accumulatedData.files.push(file);
          completedFiles.push(file.path);

          // 更新检查点
          checkpointManager.updateCheckpoint(checkpoint.id, {
            completedFiles,
            accumulatedData,
          });

          // 发送文件事件
          event.sender.send("project:stream-chunk", {
            type: "file",
            data: {
              ...file,
              checkpointId: checkpoint.id,
            },
          });
        } catch (error) {
          logger.error("[StreamCheckpoint] 文件回调失败:", error);
        }
      },

      // 阶段完成回调
      onStageComplete: async (stageName) => {
        try {
          logger.info(`[StreamCheckpoint] 阶段完成: ${stageName}`);

          if (!completedStages.includes(stageName)) {
            completedStages.push(stageName);
          }

          // 更新检查点
          checkpointManager.updateCheckpoint(checkpoint.id, {
            completedStages,
            accumulatedData,
          });

          // 发送阶段完成事件
          event.sender.send("project:task-complete", {
            stage: stageName,
            name: stageName,
            status: "completed",
            timestamp: Date.now(),
          });
        } catch (error) {
          logger.error("[StreamCheckpoint] 阶段完成回调失败:", error);
        }
      },

      // 完成回调
      onComplete: async (data) => {
        try {
          const result = data.result || data;
          accumulatedData.files = result.files || accumulatedData.files;
          accumulatedData.metadata = result.metadata || {};

          logger.info(
            "[StreamCheckpoint] 流式创建完成，文件数量:",
            accumulatedData.files.length,
          );

          // 保存到数据库
          const savedProject = await saveProjectToDatabase({
            createData,
            accumulatedData,
            database,
            projectConfig,
            projectType: data.project_type,
          });

          // 标记检查点为完成
          checkpointManager.markAsCompleted(checkpoint.id);

          // 发送完成事件
          event.sender.send("project:stream-chunk", {
            type: "complete",
            data: {
              project: savedProject,
              checkpointId: checkpoint.id,
            },
          });

          return savedProject;
        } catch (error) {
          logger.error("[StreamCheckpoint] 完成回调失败:", error);
          throw error;
        }
      },
    });

    // 5. 等待流式创建完成
    const result = await streamControl.promise;

    logger.info("[StreamCheckpoint] ✅ 流式创建成功");
    return result;
  } catch (error) {
    logger.error("[StreamCheckpoint] ❌ 流式创建失败:", error);

    // 6. 保存错误检查点
    checkpointManager.markAsFailed(checkpoint.id, error.message);

    // 7. 自动重试逻辑
    if (retryCount < maxRetries && isRetryableError(error)) {
      logger.info(
        `[StreamCheckpoint] 自动重试 (${retryCount + 1}/${maxRetries})...`,
      );

      // 延迟后重试
      await sleep(Math.pow(2, retryCount) * 1000); // 指数退避

      return createProjectWithCheckpoint({
        ...options,
        checkpointId: checkpoint.id,
      });
    }

    // 8. 发送错误事件
    event.sender.send("project:stream-error", {
      error: {
        message: error.message,
        checkpointId: checkpoint.id,
        canResume: true,
        retryCount,
      },
    });

    throw error;
  }
}

/**
 * 保存项目到数据库
 * @private
 */
async function saveProjectToDatabase(options) {
  const { createData, accumulatedData, database, projectConfig, projectType } =
    options;

  // 构建项目对象
  const localProject = {
    id: crypto.randomUUID(),
    name: createData.name || "未命名项目",
    projectType: projectType || createData.projectType || "web",
    userId: createData.userId || "default-user",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: JSON.stringify(accumulatedData.metadata),
    user_id: createData.userId || "default-user",
    sync_status: "pending",
    file_count: accumulatedData.files.length,
  };

  logger.info("[StreamCheckpoint] 保存项目到数据库，ID:", localProject.id);
  await database.saveProject(localProject);

  // 创建项目目录
  const projectRootPath = path.join(
    projectConfig.getProjectsRootPath(),
    localProject.id,
  );

  logger.info("[StreamCheckpoint] 创建项目目录:", projectRootPath);
  await fs.mkdir(projectRootPath, { recursive: true });

  // 更新 root_path
  database.updateProject(localProject.id, {
    root_path: projectRootPath,
  });

  // 写入文件
  if (accumulatedData.files.length > 0) {
    for (const file of accumulatedData.files) {
      const filePath = path.join(projectRootPath, file.path);
      logger.info("[StreamCheckpoint] 写入文件:", filePath);

      // 确保目录存在
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });

      // 解码内容
      let fileContent;
      if (file.content_encoding === "base64") {
        fileContent = Buffer.from(file.content, "base64");
      } else if (typeof file.content === "string") {
        fileContent = file.content;
      } else {
        fileContent = JSON.stringify(file.content, null, 2);
      }

      await fs.writeFile(filePath, fileContent, "utf-8");
    }

    // 保存文件到数据库
    database.saveProjectFiles(localProject.id, accumulatedData.files);
  }

  return localProject;
}

/**
 * 判断错误是否可重试
 * @private
 */
function isRetryableError(error) {
  const retryableMessages = [
    "network",
    "timeout",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "socket hang up",
  ];

  const errorMessage = error.message.toLowerCase();
  return retryableMessages.some((msg) => errorMessage.includes(msg));
}

/**
 * 延迟函数
 * @private
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  createProjectWithCheckpoint,
  CheckpointManager,
};
