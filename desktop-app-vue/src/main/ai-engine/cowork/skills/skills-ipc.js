/**
 * Markdown Skills IPC Handlers
 *
 * 提供 Markdown Skills 系统的 IPC 通道
 * 支持 Claude Code 风格的 /skill-name 命令调用
 *
 * @module ai-engine/cowork/skills/skills-ipc
 */

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { logger } = require('../../../utils/logger');
const { SkillRegistry, getSkillRegistry } = require('./skill-registry');
const { SkillLoader, LAYER_PRIORITY } = require('./skill-loader');
const { SkillMdParser } = require('./skill-md-parser');
const { SkillGating } = require('./skill-gating');

/**
 * 注册 Markdown Skills IPC 处理器
 * @param {Object} options - 配置选项
 */
function registerSkillsIPC(options = {}) {
  const { hookSystem, workspacePath } = options;

  // 获取或创建注册表
  const registry = getSkillRegistry();

  // 创建加载器
  const loader = new SkillLoader({
    workspacePath: workspacePath || process.cwd(),
    autoGating: true,
    strictGating: false,
  });

  // 绑定加载器到注册表
  registry.setLoader(loader);

  // Hooks 集成
  let skillHookId = null;
  if (hookSystem) {
    const { HookPriority, HookResult } = require('../../../hooks');

    skillHookId = hookSystem.register({
      event: 'PreToolUse',
      name: 'skills:execution-hook',
      priority: HookPriority.NORMAL,
      description: 'Track skill executions',
      handler: async ({ data }) => {
        // 检查是否是技能调用
        if (data.toolName && data.toolName.startsWith('skill:')) {
          const skillId = data.toolName.replace('skill:', '');
          logger.info(`[SkillsIPC] Skill invocation: ${skillId}`);
        }
        return { result: HookResult.CONTINUE };
      },
    });

    logger.info('[SkillsIPC] Hooks integration enabled');
  }

  logger.info('[SkillsIPC] Registering IPC handlers...');

  // ==================== 技能加载 ====================

  /**
   * 加载所有技能（三层加载）
   */
  ipcMain.handle('skills:load-all', async () => {
    try {
      const result = await registry.loadAllSkills();
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Load all error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 重新加载所有技能
   */
  ipcMain.handle('skills:reload', async () => {
    try {
      const result = await registry.reloadAllSkills();
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Reload error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 设置工作区路径
   */
  ipcMain.handle('skills:set-workspace', async (event, newPath) => {
    try {
      loader.setWorkspacePath(newPath);
      return { success: true };
    } catch (error) {
      logger.error('[SkillsIPC] Set workspace error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 技能查询 ====================

  /**
   * 获取所有技能列表
   */
  ipcMain.handle('skills:list', async (event, options = {}) => {
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
      logger.error('[SkillsIPC] List error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取用户可调用的技能
   */
  ipcMain.handle('skills:list-invocable', async () => {
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
      logger.error('[SkillsIPC] List invocable error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取单个技能详情
   */
  ipcMain.handle('skills:get', async (event, skillId) => {
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
        definition: skill.getDefinition ? skill.getDefinition() : null,
        body: skill.getBody ? skill.getBody() : null,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Get error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取技能的 Markdown 正文
   */
  ipcMain.handle('skills:get-body', async (event, skillId) => {
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
        skillId,
        body: skill.getBody ? skill.getBody() : '',
      };
    } catch (error) {
      logger.error('[SkillsIPC] Get body error:', error);
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
  ipcMain.handle('skills:execute', async (event, skillId, task, context = {}) => {
    try {
      // 触发 Hooks
      if (hookSystem) {
        const preResult = await hookSystem.trigger('PreToolUse', {
          toolName: `skill:${skillId}`,
          params: task,
        });

        if (preResult.prevented) {
          return {
            success: false,
            error: `Skill execution prevented: ${preResult.preventReason}`,
            prevented: true,
          };
        }
      }

      const startTime = Date.now();
      const result = await registry.executeSkill(skillId, task, context);
      const executionTime = Date.now() - startTime;

      // 触发 PostToolUse Hook
      if (hookSystem) {
        await hookSystem.trigger('PostToolUse', {
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
      logger.error('[SkillsIPC] Execute error:', error);

      // 触发 ToolError Hook
      if (hookSystem) {
        await hookSystem.trigger('ToolError', {
          toolName: `skill:${skillId}`,
          error: error.message,
        });
      }

      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 自动执行任务（选择最佳技能）
   */
  ipcMain.handle('skills:auto-execute', async (event, task, context = {}) => {
    try {
      const result = await registry.autoExecute(task, context);
      return {
        success: result.success !== false,
        result,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Auto execute error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 查找能处理任务的技能
   */
  ipcMain.handle('skills:find-for-task', async (event, task, options = {}) => {
    try {
      const matches = registry.findSkillsForTask(task, options);
      return {
        success: true,
        matches: matches.map((m) => ({
          skillId: m.skill.skillId,
          name: m.skill.name,
          score: m.score,
        })),
      };
    } catch (error) {
      logger.error('[SkillsIPC] Find for task error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 用户命令解析 ====================

  /**
   * 解析用户输入的技能命令（如 /skill-name args）
   */
  ipcMain.handle('skills:parse-command', async (event, input) => {
    try {
      // 检查是否是技能命令（以 / 开头）
      if (!input || !input.startsWith('/')) {
        return {
          success: true,
          isSkillCommand: false,
        };
      }

      // 解析命令
      const parts = input.slice(1).split(/\s+/);
      const skillName = parts[0];
      const args = parts.slice(1).join(' ');

      // 查找技能
      const skill = registry.getSkill(skillName);

      if (!skill) {
        // 检查是否有相似的技能名
        const allSkills = registry.getUserInvocableSkills();
        const suggestions = allSkills
          .filter((s) => s.skillId.includes(skillName) || (s.tags && s.tags.some((t) => t.includes(skillName))))
          .slice(0, 3)
          .map((s) => s.skillId);

        return {
          success: true,
          isSkillCommand: true,
          found: false,
          skillName,
          suggestions,
        };
      }

      // 检查是否可调用
      if (skill.userInvocable === false || skill.hidden === true) {
        return {
          success: true,
          isSkillCommand: true,
          found: true,
          invocable: false,
          skillName,
          reason: 'Skill is not user-invocable',
        };
      }

      return {
        success: true,
        isSkillCommand: true,
        found: true,
        invocable: true,
        skillName,
        args,
        skill: skill.getInfo(),
        body: skill.getBody ? skill.getBody() : '',
      };
    } catch (error) {
      logger.error('[SkillsIPC] Parse command error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== 技能管理 ====================

  /**
   * 启用/禁用技能
   */
  ipcMain.handle('skills:set-enabled', async (event, skillId, enabled) => {
    try {
      const skill = registry.getSkill(skillId);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skillId}`,
        };
      }

      skill.config.enabled = enabled;

      return {
        success: true,
        skillId,
        enabled,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Set enabled error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle('skills:get-stats', async () => {
    try {
      const stats = registry.getStats();
      const sources = registry.getSkillSources();

      return {
        success: true,
        stats,
        sources,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Get stats error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取分类列表
   */
  ipcMain.handle('skills:get-categories', async () => {
    try {
      const skills = registry.getAllSkills();
      const categories = new Map();

      for (const skill of skills) {
        const cat = skill.category || 'uncategorized';
        if (!categories.has(cat)) {
          categories.set(cat, 0);
        }
        categories.set(cat, categories.get(cat) + 1);
      }

      return {
        success: true,
        categories: Array.from(categories.entries()).map(([name, count]) => ({
          name,
          count,
        })),
      };
    } catch (error) {
      logger.error('[SkillsIPC] Get categories error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ==================== SKILL.md 创建 ====================

  /**
   * 创建新的 SKILL.md 文件
   */
  ipcMain.handle('skills:create', async (event, options) => {
    try {
      const { name, description, category, layer = 'workspace', handler = null, body = '' } = options;

      // 验证名称
      if (!name || !/^[a-z][a-z0-9-]*$/i.test(name)) {
        return {
          success: false,
          error: 'Invalid skill name. Use alphanumeric with hyphens (e.g., my-skill)',
        };
      }

      // 获取目标目录
      const paths = loader.getLayerPaths();
      const targetDir = path.join(paths[layer], name);
      const skillMdPath = path.join(targetDir, 'SKILL.md');

      // 检查是否已存在
      try {
        await fs.access(skillMdPath);
        return {
          success: false,
          error: `Skill already exists: ${skillMdPath}`,
        };
      } catch {
        // 不存在，可以创建
      }

      // 创建目录
      await fs.mkdir(targetDir, { recursive: true });

      // 生成 SKILL.md 内容
      const content = generateSkillMd({
        name,
        description: description || `${name} skill`,
        category: category || 'custom',
        handler,
        body,
      });

      // 写入文件
      await fs.writeFile(skillMdPath, content, 'utf-8');

      // 如果有 handler，创建 handler 模板
      if (handler) {
        const handlerPath = path.join(targetDir, handler);
        const handlerContent = generateHandlerTemplate(name);
        await fs.writeFile(handlerPath, handlerContent, 'utf-8');
      }

      return {
        success: true,
        path: skillMdPath,
        name,
        layer,
      };
    } catch (error) {
      logger.error('[SkillsIPC] Create error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  logger.info('[SkillsIPC] Registered 17 IPC handlers');

  return { registry, loader };
}

/**
 * 生成 SKILL.md 内容
 */
function generateSkillMd(options) {
  const { name, description, category, handler, body } = options;

  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `version: 1.0.0`,
    `category: ${category}`,
    `user-invocable: true`,
    `tags: [custom]`,
  ];

  if (handler) {
    lines.push(`handler: ${handler}`);
  }

  lines.push('---', '', body || `# ${name}`, '', 'Describe your skill here.');

  return lines.join('\n');
}

/**
 * 生成 handler 模板
 */
function generateHandlerTemplate(skillName) {
  return `/**
 * Handler for ${skillName} skill
 */

/**
 * Initialize the skill
 * @param {MarkdownSkill} skill - The skill instance
 */
async function init(skill) {
  console.log(\`[${skillName}] Initialized\`);
}

/**
 * Execute the skill
 * @param {Object} task - The task object
 * @param {Object} context - Execution context
 * @param {MarkdownSkill} skill - The skill instance
 * @returns {Promise<Object>}
 */
async function execute(task, context, skill) {
  console.log(\`[${skillName}] Executing with task:\`, task);

  // TODO: Implement your skill logic here

  return {
    success: true,
    message: \`${skillName} executed successfully\`,
    data: {},
  };
}

module.exports = {
  init,
  execute,
};
`;
}

/**
 * 注销 Skills IPC 处理器
 */
function unregisterSkillsIPC() {
  const channels = [
    'skills:load-all',
    'skills:reload',
    'skills:set-workspace',
    'skills:list',
    'skills:list-invocable',
    'skills:get',
    'skills:get-body',
    'skills:execute',
    'skills:auto-execute',
    'skills:find-for-task',
    'skills:parse-command',
    'skills:set-enabled',
    'skills:get-stats',
    'skills:get-categories',
    'skills:create',
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  logger.info('[SkillsIPC] Unregistered all IPC handlers');
}

module.exports = {
  registerSkillsIPC,
  unregisterSkillsIPC,
};
