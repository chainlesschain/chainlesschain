/**
 * Markdown Skills IPC Handlers
 *
 * 提供 Markdown Skills 系统的 IPC 通道
 * 支持 Claude Code 风格的 /skill-name 命令调用
 *
 * @module ai-engine/cowork/skills/skills-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../../utils/logger");
const { getSkillRegistry } = require("./skill-registry");
const { SkillLoader } = require("./skill-loader");
const {
  getDefaultExternalSkillExecutor,
} = require("./external-skill-executor");
const {
  createBundledSkillFilesystemAuthorityFactory,
} = require("./bundled-skill-filesystem-authority");
const {
  createBundledSkillEnvironmentAuthorityFactory,
} = require("./bundled-skill-environment-authority");
const {
  createBundledSkillProcessAuthorityFactory,
} = require("./bundled-skill-process-authority");
const {
  createBundledSkillNetworkAuthorityFactory,
} = require("./bundled-skill-network-authority");
const {
  getBundledSkillCredentialStore,
} = require("./bundled-skill-credential-store");
const {
  registerBundledSkillCredentialIPC,
  unregisterBundledSkillCredentialIPC,
} = require("./bundled-skill-credential-ipc");
const {
  routeDesktopSkillsWithOutcomeAuthority,
} = require("./skill-retrieval-adapter");

/**
 * 注册 Markdown Skills IPC 处理器
 * @param {Object} options - 配置选项
 */
function registerSkillsIPC(options = {}) {
  const {
    hookSystem,
    workspacePath,
    trustedSkillKeySha256,
    externalHandlerExecutor,
  } = options;
  const getSkillVectorAuthority =
    typeof options.getSkillVectorAuthority === "function"
      ? options.getSkillVectorAuthority.bind(options)
      : () => options.skillVectorAuthority ?? null;
  const getSkillRetrievalRevocationReader =
    typeof options.getSkillRetrievalRevocationReader === "function"
      ? options.getSkillRetrievalRevocationReader.bind(options)
      : () => options.skillRetrievalRevocationReader ?? null;
  const hostIpcMain = options.ipcMain || ipcMain;

  // 获取或创建注册表
  const registry = getSkillRegistry({
    artifactActiveReleaseReader:
      options.artifactActiveReleaseReader || undefined,
  });
  const credentialStore =
    options.bundledSkillCredentialStore || getBundledSkillCredentialStore();

  // 创建加载器
  const loader = new SkillLoader({
    workspacePath: workspacePath || process.cwd(),
    autoGating: true,
    strictGating: false,
    trustedSkillKeySha256,
    externalHandlerExecutor:
      typeof externalHandlerExecutor === "function"
        ? externalHandlerExecutor
        : externalHandlerExecutor === null
          ? null
          : getDefaultExternalSkillExecutor(),
  });

  // 绑定加载器到注册表
  registry.setLoader(loader);
  registry.setExecutionAuthorizer(
    hookSystem
      ? async ({ skillId, task }) => {
          const preResult = await hookSystem.trigger("PreToolUse", {
            toolName: `skill:${skillId}`,
            params: task,
          });
          const failedHook = preResult.hookResults?.find(
            (result) => result.result === "error",
          );
          return preResult.prevented || failedHook
            ? {
                approved: false,
                reason:
                  preResult.preventReason ||
                  `Skill approval hook failed: ${failedHook?.hookName || "unknown"}`,
              }
            : { approved: true };
        }
      : null,
  );
  registry.setBundledSkillFilesystemAuthorityFactory(
    createBundledSkillFilesystemAuthorityFactory({
      getWorkspacePath: () => loader.options.workspacePath,
    }),
  );
  registry.setBundledSkillEnvironmentAuthorityFactory(
    createBundledSkillEnvironmentAuthorityFactory({
      getWorkspacePath: () => loader.options.workspacePath,
      getBundledSkillCredentialStore: () => credentialStore,
    }),
  );
  registry.setBundledSkillProcessAuthorityFactory(
    createBundledSkillProcessAuthorityFactory({
      getWorkspacePath: () => loader.options.workspacePath,
    }),
  );
  registry.setBundledSkillNetworkAuthorityFactory(
    createBundledSkillNetworkAuthorityFactory(),
  );

  // Hooks 集成
  let _skillHookId = null;
  if (hookSystem) {
    const { HookPriority, HookResult } = require("../../../hooks");

    _skillHookId = hookSystem.register({
      event: "PreToolUse",
      name: "skills:execution-hook",
      priority: HookPriority.NORMAL,
      description: "Track skill executions",
      handler: async ({ data }) => {
        // 检查是否是技能调用
        if (data.toolName && data.toolName.startsWith("skill:")) {
          const skillId = data.toolName.replace("skill:", "");
          logger.info(`[SkillsIPC] Skill invocation: ${skillId}`);
        }
        return { result: HookResult.CONTINUE };
      },
    });

    logger.info("[SkillsIPC] Hooks integration enabled");
  }

  logger.info("[SkillsIPC] Registering IPC handlers...");

  registerBundledSkillCredentialIPC({
    hookSystem,
    credentialStore,
    ipcMain: hostIpcMain,
  });

  // ==================== 技能查询 ====================

  /**
   * 获取所有技能列表
   */
  hostIpcMain.handle("skills:list", async (event, options = {}) => {
    try {
      const { category, source, enabledOnly = false } = options;

      let skills = registry.getAllSkills();

      // 按分类过滤
      if (category) {
        skills = skills.filter((s) => s.category === category);
      }

      // 按来源过滤
      if (source) {
        skills = skills.filter((s) => s.source === source);
      }

      // 只返回启用的
      if (enabledOnly) {
        skills = skills.filter((s) => s.config?.enabled !== false);
      }

      return {
        success: true,
        skills: skills.map((s) => s.getInfo()),
        total: skills.length,
      };
    } catch (error) {
      logger.error("[SkillsIPC] List error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取用户可调用的技能
   */
  hostIpcMain.handle("skills:list-invocable", async () => {
    try {
      const skills = registry.getUserInvocableSkills();
      return {
        success: true,
        skills: skills.map((s) => ({
          id: s.skillId,
          name: s.name,
          description: s.description,
          category: s.category,
          tags: s.tags || [],
          source: s.source,
        })),
        total: skills.length,
      };
    } catch (error) {
      logger.error("[SkillsIPC] List invocable error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  hostIpcMain.handle("skills:route", async (_event, query, filters = {}) => {
    try {
      const skills = registry
        .getUserInvocableSkills()
        .filter((skill) => skill.config?.enabled !== false);
      const result = await routeDesktopSkillsWithOutcomeAuthority({
        skills,
        query,
        filters,
        hostTarget: options.skillRoutingTarget || { os: process.platform },
        database: registry.skillMetricsCollector?.database || null,
        expectedEnvironmentDigest:
          options.skillRoutingEnvironmentDigest ?? null,
        skillVectorAuthority: getSkillVectorAuthority(),
        skillRetrievalRevocationReader: getSkillRetrievalRevocationReader(),
        buildOutcomeAuthority: options.buildDesktopSkillOutcomeAuthority,
        loadRouter: options.loadSkillRouter,
        loadVectorAuthority: options.loadSkillVectorAuthority,
      });
      return { success: true, result };
    } catch (error) {
      logger.error("[SkillsIPC] Route error:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取单个技能详情
   */
  hostIpcMain.handle("skills:get", async (event, skillId) => {
    try {
      const skill = registry.getSkill(skillId);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillId}`,
        };
      }

      return {
        success: true,
        skill: skill.getInfo(),
        definition: skill.getPublicDefinition
          ? skill.getPublicDefinition()
          : skill.getDefinition
            ? skill.getDefinition()
            : null,
        body: skill.getBody ? skill.getBody() : null,
      };
    } catch (error) {
      logger.error("[SkillsIPC] Get error:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 技能执行 ====================

  /**
   * 执行技能
   */
  hostIpcMain.handle(
    "skills:execute",
    async (event, skillId, task, context = {}) => {
      try {
        const startTime = Date.now();
        const result = await registry.executeSkill(skillId, task, context);
        const executionTime = Date.now() - startTime;

        // 触发 PostToolUse Hook
        if (hookSystem) {
          await hookSystem.trigger("PostToolUse", {
            toolName: `skill:${skillId}`,
            result,
            executionTime,
          });
        }

        return {
          success: true,
          result,
          executionTime,
        };
      } catch (error) {
        logger.error("[SkillsIPC] Execute error:", error);

        // 触发 ToolError Hook
        if (hookSystem) {
          await hookSystem.trigger("ToolError", {
            toolName: `skill:${skillId}`,
            error: error.message,
          });
        }

        return {
          success: false,
          error: error.message,
          ...(error.prevented === true ? { prevented: true } : {}),
        };
      }
    },
  );

  logger.info("[SkillsIPC] Registered 8 IPC handlers");

  return { registry, loader, credentialStore };
}

/**
 * 注销 Skills IPC 处理器
 */
function unregisterSkillsIPC(options = {}) {
  const hostIpcMain = options.ipcMain || ipcMain;
  unregisterBundledSkillCredentialIPC({ ipcMain: hostIpcMain });
  const channels = [
    "skills:list",
    "skills:list-invocable",
    "skills:route",
    "skills:get",
    "skills:execute",
  ];

  channels.forEach((channel) => {
    hostIpcMain.removeHandler(channel);
  });

  const registry = getSkillRegistry();
  registry.setExecutionAuthorizer(null);
  registry.setBundledSkillFilesystemAuthorityFactory(null);
  registry.setBundledSkillEnvironmentAuthorityFactory(null);
  registry.setBundledSkillProcessAuthorityFactory(null);
  registry.setBundledSkillNetworkAuthorityFactory(null);

  logger.info("[SkillsIPC] Unregistered all IPC handlers");
}

module.exports = {
  registerSkillsIPC,
  unregisterSkillsIPC,
};
