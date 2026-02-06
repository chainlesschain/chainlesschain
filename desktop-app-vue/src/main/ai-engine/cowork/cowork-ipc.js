/**
 * Cowork IPC 处理器
 *
 * 提供 Cowork 多代理协作系统的 IPC 接口。
 *
 * @module ai-engine/cowork/cowork-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");
const { TeammateTool } = require("./teammate-tool");
const { FileSandbox } = require("./file-sandbox");
const { LongRunningTaskManager } = require("./long-running-task-manager");
const { getSkillRegistry, SkillLoader, SkillGating } = require("./skills");

// 单例实例
let teammateTool = null;
let fileSandbox = null;
let taskManager = null;
let skillRegistry = null;
let skillLoader = null;
let skillGating = null;

/**
 * 初始化 Cowork 组件
 * @param {Object} dependencies - 依赖对象
 * @private
 */
function initializeCoworkComponents(dependencies) {
  const { database } = dependencies;

  if (!teammateTool) {
    teammateTool = new TeammateTool();
    if (database) {
      teammateTool.setDatabase(database);
    }
    logger.info("[Cowork IPC] TeammateTool 已初始化");
  }

  if (!fileSandbox) {
    fileSandbox = new FileSandbox();
    if (database) {
      fileSandbox.setDatabase(database);
    }
    logger.info("[Cowork IPC] FileSandbox 已初始化");
  }

  if (!taskManager) {
    taskManager = new LongRunningTaskManager();
    if (database) {
      taskManager.setDatabase(database);
    }
    logger.info("[Cowork IPC] LongRunningTaskManager 已初始化");
  }

  if (!skillRegistry) {
    skillRegistry = getSkillRegistry();
    skillRegistry.autoLoadBuiltinSkills();
    logger.info("[Cowork IPC] SkillRegistry 已初始化");
  }

  if (!skillLoader) {
    skillLoader = new SkillLoader();
    skillRegistry.setLoader(skillLoader);
    logger.info("[Cowork IPC] SkillLoader 已初始化");

    // 异步加载所有 SKILL.md 技能
    skillLoader
      .loadAll()
      .then((result) => {
        const instances = skillLoader.createSkillInstances();
        for (const skill of instances) {
          try {
            skillRegistry.register(skill);
          } catch (error) {
            logger.warn(
              `[Cowork IPC] 注册 SKILL.md 技能失败: ${skill.skillId} - ${error.message}`,
            );
          }
        }
        logger.info(
          `[Cowork IPC] SKILL.md 技能加载完成: ${instances.length} 个技能`,
        );
      })
      .catch((error) => {
        logger.error(`[Cowork IPC] SKILL.md 技能加载失败: ${error.message}`);
      });
  }

  if (!skillGating) {
    skillGating = new SkillGating();
    logger.info("[Cowork IPC] SkillGating 已初始化");
  }
}

/**
 * 注册 Cowork IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.mainWindow - 主窗口
 */
function registerCoworkIPC(dependencies = {}) {
  logger.info("[Cowork IPC] 开始注册 IPC 处理器...");

  // 初始化 Cowork 组件
  initializeCoworkComponents(dependencies);

  const { mainWindow, database } = dependencies;

  // ==========================================
  // TeammateTool IPC 处理器
  // ==========================================

  /**
   * 创建团队
   */
  ipcMain.handle(
    "cowork:create-team",
    async (event, { teamName, config = {} }) => {
      try {
        logger.info(`[Cowork IPC] 创建团队: ${teamName}`);
        const team = await teammateTool.spawnTeam(teamName, config);
        return { success: true, team };
      } catch (error) {
        logger.error(`[Cowork IPC] 创建团队失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 发现团队
   */
  ipcMain.handle("cowork:discover-teams", async (event, { filters = {} }) => {
    try {
      const teams = await teammateTool.discoverTeams(filters);
      return { success: true, teams };
    } catch (error) {
      logger.error(`[Cowork IPC] 发现团队失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 请求加入团队
   */
  ipcMain.handle(
    "cowork:request-join",
    async (event, { teamId, agentId, agentInfo = {} }) => {
      try {
        logger.info(`[Cowork IPC] 代理 ${agentId} 请求加入团队 ${teamId}`);
        const result = await teammateTool.requestJoin(
          teamId,
          agentId,
          agentInfo,
        );
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 请求加入团队失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 分配任务
   */
  ipcMain.handle(
    "cowork:assign-task",
    async (event, { teamId, agentId, task }) => {
      try {
        logger.info(`[Cowork IPC] 分配任务: 团队 ${teamId}, 代理 ${agentId}`);
        const result = await teammateTool.assignTask(teamId, agentId, task);
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 分配任务失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 广播消息
   */
  ipcMain.handle(
    "cowork:broadcast-message",
    async (event, { teamId, fromAgent, message }) => {
      try {
        const result = await teammateTool.broadcastMessage(
          teamId,
          fromAgent,
          message,
        );
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 广播消息失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 发送消息
   */
  ipcMain.handle(
    "cowork:send-message",
    async (event, { fromAgent, toAgent, message }) => {
      try {
        const result = await teammateTool.sendMessage(
          fromAgent,
          toAgent,
          message,
        );
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 发送消息失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 投票决策
   */
  ipcMain.handle(
    "cowork:vote-on-decision",
    async (event, { teamId, decision, votes }) => {
      try {
        logger.info(`[Cowork IPC] 投票决策: 团队 ${teamId}`);
        const result = await teammateTool.voteOnDecision(
          teamId,
          decision,
          votes,
        );
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 投票决策失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取团队状态
   */
  ipcMain.handle("cowork:get-team-status", async (event, { teamId }) => {
    try {
      const status = await teammateTool.getTeamStatus(teamId);
      return { success: true, status };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取团队状态失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 终止代理
   */
  ipcMain.handle(
    "cowork:terminate-agent",
    async (event, { agentId, reason = "" }) => {
      try {
        logger.info(`[Cowork IPC] 终止代理: ${agentId}, 原因: ${reason}`);
        const result = await teammateTool.terminateAgent(agentId, reason);
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 终止代理失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 合并结果
   */
  ipcMain.handle(
    "cowork:merge-results",
    async (event, { teamId, results, strategy = {} }) => {
      try {
        logger.info(
          `[Cowork IPC] 合并结果: 团队 ${teamId}, 策略: ${strategy.type || "aggregate"}`,
        );
        const mergedResult = await teammateTool.mergeResults(
          teamId,
          results,
          strategy,
        );
        return { success: true, mergedResult };
      } catch (error) {
        logger.error(`[Cowork IPC] 合并结果失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 创建检查点
   */
  ipcMain.handle(
    "cowork:create-checkpoint",
    async (event, { teamId, metadata = {} }) => {
      try {
        const checkpoint = await teammateTool.createCheckpoint(
          teamId,
          metadata,
        );
        return { success: true, checkpoint };
      } catch (error) {
        logger.error(`[Cowork IPC] 创建检查点失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 列出团队成员
   */
  ipcMain.handle("cowork:list-members", async (event, { teamId }) => {
    try {
      const members = await teammateTool.listMembers(teamId);
      return { success: true, members };
    } catch (error) {
      logger.error(`[Cowork IPC] 列出成员失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 更新团队配置
   */
  ipcMain.handle(
    "cowork:update-team-config",
    async (event, { teamId, config }) => {
      try {
        logger.info(`[Cowork IPC] 更新团队配置: ${teamId}`);
        const result = await teammateTool.updateTeamConfig(teamId, config);
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 更新团队配置失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 销毁团队
   */
  ipcMain.handle("cowork:destroy-team", async (event, { teamId }) => {
    try {
      logger.info(`[Cowork IPC] 销毁团队: ${teamId}`);
      const result = await teammateTool.destroyTeam(teamId);
      return { success: true, result };
    } catch (error) {
      logger.error(`[Cowork IPC] 销毁团队失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 暂停团队
   */
  ipcMain.handle("cowork:pause-team", async (event, { teamId }) => {
    try {
      logger.info(`[Cowork IPC] 暂停团队: ${teamId}`);
      const result = await teammateTool.pauseTeam(teamId);
      return { success: true, result };
    } catch (error) {
      logger.error(`[Cowork IPC] 暂停团队失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 恢复团队
   */
  ipcMain.handle("cowork:resume-team", async (event, { teamId }) => {
    try {
      logger.info(`[Cowork IPC] 恢复团队: ${teamId}`);
      const result = await teammateTool.resumeTeam(teamId);
      return { success: true, result };
    } catch (error) {
      logger.error(`[Cowork IPC] 恢复团队失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle("cowork:get-stats", async (event) => {
    try {
      const stats = teammateTool.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取统计信息失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // FileSandbox IPC 处理器
  // ==========================================

  /**
   * 请求文件访问权限
   */
  ipcMain.handle(
    "cowork:request-file-access",
    async (
      event,
      { teamId, folderPath, permissions = ["read"], options = {} },
    ) => {
      try {
        logger.info(
          `[Cowork IPC] 请求文件访问: 团队 ${teamId}, 路径 ${folderPath}`,
        );

        // 发送授权请求事件到前端
        if (mainWindow && !options.autoApprove) {
          return new Promise((resolve) => {
            // 监听一次性授权响应
            const responseChannel = `cowork:file-access-response:${teamId}`;

            ipcMain.once(
              responseChannel,
              async (responseEvent, { approved }) => {
                if (approved) {
                  await fileSandbox.grantAccess(
                    teamId,
                    folderPath,
                    permissions,
                    options,
                  );
                  resolve({ success: true, granted: true });
                } else {
                  resolve({
                    success: true,
                    granted: false,
                    reason: "user_denied",
                  });
                }
              },
            );

            // 发送授权请求到前端
            mainWindow.webContents.send("cowork:file-access-request", {
              teamId,
              folderPath,
              permissions,
              responseChannel,
            });
          });
        }

        // 自动批准模式
        const granted = await fileSandbox.requestAccess(
          teamId,
          folderPath,
          permissions,
          options,
        );
        return { success: true, granted };
      } catch (error) {
        logger.error(`[Cowork IPC] 请求文件访问失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 授予文件访问权限
   */
  ipcMain.handle(
    "cowork:grant-file-access",
    async (event, { teamId, folderPath, permissions, options = {} }) => {
      try {
        await fileSandbox.grantAccess(teamId, folderPath, permissions, options);
        return { success: true };
      } catch (error) {
        logger.error(`[Cowork IPC] 授予文件访问失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 撤销文件访问权限
   */
  ipcMain.handle(
    "cowork:revoke-file-access",
    async (event, { teamId, folderPath }) => {
      try {
        logger.info(
          `[Cowork IPC] 撤销文件访问: 团队 ${teamId}, 路径 ${folderPath}`,
        );
        await fileSandbox.revokeAccess(teamId, folderPath);
        return { success: true };
      } catch (error) {
        logger.error(`[Cowork IPC] 撤销文件访问失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 验证文件访问
   */
  ipcMain.handle(
    "cowork:validate-file-access",
    async (event, { teamId, filePath, permission = "read" }) => {
      try {
        const validation = await fileSandbox.validateAccess(
          teamId,
          filePath,
          permission,
        );
        return { success: true, validation };
      } catch (error) {
        logger.error(`[Cowork IPC] 验证文件访问失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 读取文件
   */
  ipcMain.handle(
    "cowork:read-file",
    async (event, { teamId, agentId, filePath, options = {} }) => {
      try {
        const content = await fileSandbox.readFile(
          teamId,
          agentId,
          filePath,
          options,
        );
        return { success: true, content };
      } catch (error) {
        logger.error(`[Cowork IPC] 读取文件失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 写入文件
   */
  ipcMain.handle(
    "cowork:write-file",
    async (event, { teamId, agentId, filePath, content, options = {} }) => {
      try {
        await fileSandbox.writeFile(
          teamId,
          agentId,
          filePath,
          content,
          options,
        );
        return { success: true };
      } catch (error) {
        logger.error(`[Cowork IPC] 写入文件失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 删除文件
   */
  ipcMain.handle(
    "cowork:delete-file",
    async (event, { teamId, agentId, filePath }) => {
      try {
        await fileSandbox.deleteFile(teamId, agentId, filePath);
        return { success: true };
      } catch (error) {
        logger.error(`[Cowork IPC] 删除文件失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 列出目录
   */
  ipcMain.handle(
    "cowork:list-directory",
    async (event, { teamId, agentId, dirPath }) => {
      try {
        const files = await fileSandbox.listDirectory(teamId, agentId, dirPath);
        return { success: true, files };
      } catch (error) {
        logger.error(`[Cowork IPC] 列出目录失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取允许的路径
   */
  ipcMain.handle("cowork:get-allowed-paths", async (event, { teamId }) => {
    try {
      const paths = fileSandbox.getAllowedPaths(teamId);
      return { success: true, paths };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取允许路径失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取审计日志
   */
  ipcMain.handle(
    "cowork:get-audit-log",
    async (event, { filters = {}, limit = 100 }) => {
      try {
        const logs = fileSandbox.getAuditLog(filters, limit);
        return { success: true, logs };
      } catch (error) {
        logger.error(`[Cowork IPC] 获取审计日志失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取沙箱统计
   */
  ipcMain.handle("cowork:get-sandbox-stats", async (event) => {
    try {
      const stats = fileSandbox.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取沙箱统计失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // LongRunningTaskManager IPC 处理器
  // ==========================================

  /**
   * 创建长时运行任务
   */
  ipcMain.handle("cowork:create-long-task", async (event, { taskConfig }) => {
    try {
      logger.info(`[Cowork IPC] 创建长时任务: ${taskConfig.name}`);
      const task = await taskManager.createTask(taskConfig);
      return { success: true, task };
    } catch (error) {
      logger.error(`[Cowork IPC] 创建长时任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 启动任务
   */
  ipcMain.handle("cowork:start-task", async (event, { taskId }) => {
    try {
      logger.info(`[Cowork IPC] 启动任务: ${taskId}`);

      // 设置进度监听
      taskManager.on("task-progress", ({ task, progress, message }) => {
        if (mainWindow && task.id === taskId) {
          mainWindow.webContents.send("cowork:task-progress", {
            taskId: task.id,
            progress,
            message,
          });
        }
      });

      await taskManager.startTask(taskId);
      return { success: true };
    } catch (error) {
      logger.error(`[Cowork IPC] 启动任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 暂停任务
   */
  ipcMain.handle("cowork:pause-task", async (event, { taskId }) => {
    try {
      logger.info(`[Cowork IPC] 暂停任务: ${taskId}`);
      await taskManager.pauseTask(taskId);
      return { success: true };
    } catch (error) {
      logger.error(`[Cowork IPC] 暂停任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 继续任务
   */
  ipcMain.handle("cowork:resume-task", async (event, { taskId }) => {
    try {
      logger.info(`[Cowork IPC] 继续任务: ${taskId}`);
      await taskManager.resumeTask(taskId);
      return { success: true };
    } catch (error) {
      logger.error(`[Cowork IPC] 继续任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消任务
   */
  ipcMain.handle(
    "cowork:cancel-task",
    async (event, { taskId, reason = "" }) => {
      try {
        logger.info(`[Cowork IPC] 取消任务: ${taskId}, 原因: ${reason}`);
        await taskManager.cancelTask(taskId, reason);
        return { success: true };
      } catch (error) {
        logger.error(`[Cowork IPC] 取消任务失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取任务状态
   */
  ipcMain.handle("cowork:get-task-status", async (event, { taskId }) => {
    try {
      const status = taskManager.getTaskStatus(taskId);
      return { success: true, status };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取任务状态失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取所有活跃任务
   */
  ipcMain.handle("cowork:get-active-tasks", async (event) => {
    try {
      const tasks = taskManager.getAllActiveTasks();
      return { success: true, tasks };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取活跃任务失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 从检查点恢复
   */
  ipcMain.handle(
    "cowork:restore-from-checkpoint",
    async (event, { checkpointId }) => {
      try {
        logger.info(`[Cowork IPC] 从检查点恢复: ${checkpointId}`);
        const task = await taskManager.restoreFromCheckpoint(checkpointId);
        return { success: true, task };
      } catch (error) {
        logger.error(`[Cowork IPC] 从检查点恢复失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取任务管理器统计
   */
  ipcMain.handle("cowork:get-task-manager-stats", async (event) => {
    try {
      const stats = taskManager.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取任务管理器统计失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Skills IPC 处理器
  // ==========================================

  /**
   * 执行技能
   */
  ipcMain.handle(
    "cowork:execute-skill",
    async (event, { skillId, task, context = {} }) => {
      try {
        logger.info(`[Cowork IPC] 执行技能: ${skillId}`);
        const result = await skillRegistry.executeSkill(skillId, task, context);
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 执行技能失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 自动执行任务（选择最佳技能）
   */
  ipcMain.handle(
    "cowork:auto-execute-task",
    async (event, { task, context = {} }) => {
      try {
        logger.info(`[Cowork IPC] 自动执行任务: ${task.type || "unknown"}`);
        const result = await skillRegistry.autoExecute(task, context);
        return { success: true, result };
      } catch (error) {
        logger.error(`[Cowork IPC] 自动执行任务失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 查找适合任务的技能
   */
  ipcMain.handle(
    "cowork:find-skills-for-task",
    async (event, { task, options = {} }) => {
      try {
        const skills = skillRegistry.findSkillsForTask(task, options);
        const skillList = skills.map(({ skill, score }) => ({
          skillId: skill.skillId,
          name: skill.name,
          score,
        }));
        return { success: true, skills: skillList };
      } catch (error) {
        logger.error(`[Cowork IPC] 查找技能失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取所有技能
   */
  ipcMain.handle("cowork:get-all-skills", async (event) => {
    try {
      const skills = skillRegistry.getSkillList();
      return { success: true, skills };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取技能列表失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取技能统计
   */
  ipcMain.handle("cowork:get-skill-stats", async (event) => {
    try {
      const stats = skillRegistry.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取技能统计失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // SKILL.md 三层加载 IPC 处理器
  // ==========================================

  /**
   * 获取三层目录信息
   */
  ipcMain.handle("cowork:get-skill-sources", async (event) => {
    try {
      const sources = skillLoader.getLayerPaths();
      return { success: true, sources };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取技能目录信息失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重新加载全部技能
   */
  ipcMain.handle("cowork:reload-skills", async (event) => {
    try {
      logger.info("[Cowork IPC] 开始重新加载技能...");

      // 注销所有现有的 MarkdownSkill
      for (const skill of skillRegistry.getAllSkills()) {
        if (skill.source) {
          skillRegistry.unregister(skill.skillId);
        }
      }

      // 重新加载
      const loadResult = await skillLoader.reload();
      const instances = skillLoader.createSkillInstances();

      let registered = 0;
      for (const skill of instances) {
        try {
          skillRegistry.register(skill);
          registered++;
        } catch (error) {
          logger.warn(
            `[Cowork IPC] 注册技能失败: ${skill.skillId} - ${error.message}`,
          );
        }
      }

      logger.info(`[Cowork IPC] 技能重新加载完成: ${registered} 个技能`);

      return {
        success: true,
        result: {
          loaded: loadResult.loaded,
          registered,
          errors: loadResult.errors,
        },
      };
    } catch (error) {
      logger.error(`[Cowork IPC] 重新加载技能失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取用户可调用技能
   */
  ipcMain.handle("cowork:get-invocable-skills", async (event) => {
    try {
      const skills = skillRegistry.getUserInvocableSkills();
      const skillList = skills.map((skill) => ({
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        source: skill.source || "builtin",
        tags: skill.tags || [],
        hasHandler: skill.definition?.handler ? true : false,
      }));
      return { success: true, skills: skillList };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取可调用技能失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * 检查技能门控要求
   */
  ipcMain.handle(
    "cowork:check-skill-requirements",
    async (event, { skillId }) => {
      try {
        const skill = skillRegistry.getSkill(skillId);
        if (!skill) {
          return { success: false, error: `技能不存在: ${skillId}` };
        }

        // 获取技能定义
        const definition = skill.getDefinition ? skill.getDefinition() : null;
        if (!definition) {
          // 非 MarkdownSkill，返回默认结果
          return {
            success: true,
            result: {
              passed: true,
              results: {
                platform: { passed: true },
                bins: { passed: true, missing: [] },
                env: { passed: true, missing: [] },
                enabled: { passed: skill.config?.enabled !== false },
              },
            },
          };
        }

        const result = await skillGating.checkRequirements(definition);
        return {
          success: true,
          result,
          summary: skillGating.getSummary(result),
        };
      } catch (error) {
        logger.error(`[Cowork IPC] 检查技能要求失败: ${error.message}`);
        return { success: false, error: error.message };
      }
    },
  );

  /**
   * 获取技能原始定义
   */
  ipcMain.handle("cowork:get-skill-definition", async (event, { skillId }) => {
    try {
      const skill = skillRegistry.getSkill(skillId);
      if (!skill) {
        return { success: false, error: `技能不存在: ${skillId}` };
      }

      const definition = skill.getDefinition ? skill.getDefinition() : null;
      if (!definition) {
        // 非 MarkdownSkill
        return {
          success: true,
          definition: {
            name: skill.skillId,
            description: skill.description,
            version: skill.version,
            category: skill.category,
            capabilities: skill.capabilities,
            supportedFileTypes: skill.supportedFileTypes,
            source: "code",
          },
        };
      }

      return { success: true, definition };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取技能定义失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Analytics Handlers
  // ==========================================

  /**
   * 获取分析数据
   */
  ipcMain.handle("cowork:get-analytics", async (event, data) => {
    try {
      const { startDate, endDate, teamId } = data;

      // Query tasks within date range
      let query = `
        SELECT
          t.*,
          tm.name as team_name,
          a.name as agent_name
        FROM cowork_tasks t
        LEFT JOIN cowork_teams tm ON t.team_id = tm.id
        LEFT JOIN cowork_agents a ON t.assigned_to = a.id
        WHERE t.created_at >= ? AND t.created_at <= ?
      `;

      const params = [startDate, endDate];

      if (teamId) {
        query += " AND t.team_id = ?";
        params.push(teamId);
      }

      const tasks = database.prepare(query).all(...params);

      // Calculate KPIs
      const totalTasks = tasks.length;
      const completedTasks = tasks.filter(
        (t) => t.status === "completed",
      ).length;
      const failedTasks = tasks.filter((t) => t.status === "failed").length;
      const successRate =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      // Get active agents
      const activeAgentsQuery = teamId
        ? `SELECT COUNT(*) as count FROM cowork_agents WHERE status = 'active' AND team_id = ?`
        : `SELECT COUNT(*) as count FROM cowork_agents WHERE status = 'active'`;

      const activeAgentsParams = teamId ? [teamId] : [];
      const activeAgents = database
        .prepare(activeAgentsQuery)
        .get(...activeAgentsParams).count;

      // Get total agents
      const totalAgentsQuery = teamId
        ? `SELECT COUNT(*) as count FROM cowork_agents WHERE team_id = ?`
        : `SELECT COUNT(*) as count FROM cowork_agents`;

      const totalAgentsParams = teamId ? [teamId] : [];
      const totalAgents = database
        .prepare(totalAgentsQuery)
        .get(...totalAgentsParams).count;

      // Calculate average and median execution time
      const completedTaskTimes = tasks
        .filter(
          (t) => t.status === "completed" && t.completed_at && t.created_at,
        )
        .map((t) => (t.completed_at - t.created_at) / 60000); // Convert to minutes

      const avgExecutionTime =
        completedTaskTimes.length > 0
          ? Math.round(
              completedTaskTimes.reduce((a, b) => a + b, 0) /
                completedTaskTimes.length,
            )
          : 0;

      const sortedTimes = completedTaskTimes.sort((a, b) => a - b);
      const medianTime =
        sortedTimes.length > 0
          ? Math.round(sortedTimes[Math.floor(sortedTimes.length / 2)])
          : 0;

      // Calculate task trend (compare with previous period)
      const periodDuration = endDate - startDate;
      const previousStartDate = startDate - periodDuration;
      const previousEndDate = startDate;

      const previousTasks = database
        .prepare(
          `
        SELECT COUNT(*) as count FROM cowork_tasks
        WHERE created_at >= ? AND created_at <= ?
        ${teamId ? "AND team_id = ?" : ""}
      `,
        )
        .get(
          previousStartDate,
          previousEndDate,
          ...(teamId ? [teamId] : []),
        ).count;

      const taskTrend =
        previousTasks > 0
          ? Math.round(((totalTasks - previousTasks) / previousTasks) * 100)
          : 0;

      const analyticsData = {
        totalTasks,
        completedTasks,
        failedTasks,
        successRate,
        activeAgents,
        totalAgents,
        avgExecutionTime,
        medianTime,
        taskTrend,
        tasks: tasks.slice(0, 100), // Limit to 100 most recent tasks for charts
      };

      return { success: true, data: analyticsData };
    } catch (error) {
      logger.error(`[Cowork IPC] 获取分析数据失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  logger.info("[Cowork IPC] ✓ 所有 IPC 处理器已注册（50 个处理器）");
  logger.info("[Cowork IPC]   - TeammateTool: 15 处理器");
  logger.info("[Cowork IPC]   - FileSandbox: 11 处理器");
  logger.info("[Cowork IPC]   - LongRunningTaskManager: 9 处理器");
  logger.info("[Cowork IPC]   - SkillRegistry: 5 处理器");
  logger.info("[Cowork IPC]   - SKILL.md Loader: 5 处理器");
  logger.info("[Cowork IPC]   - Analytics: 1 处理器");
  logger.info("[Cowork IPC]   - Utilities: 4 处理器");
}

module.exports = { registerCoworkIPC };
