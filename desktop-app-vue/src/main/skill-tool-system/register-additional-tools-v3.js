/**
 * 注册Additional Tools V3到ToolManager
 * 将29个专业领域工具Handler注册到系统中
 */

const { logger } = require("../utils/logger.js");
const path = require("path");
const DatabaseManager = require("../database");
const AdditionalToolsV3Handler = require("./additional-tools-v3-handler");
const additionalToolsV3 = require("./additional-tools-v3");

// Mock FunctionCaller for standalone execution
class MockFunctionCaller {
  constructor() {
    this.tools = new Map();
  }

  registerTool(name, handler, schema) {
    this.tools.set(name, { handler, schema });
    logger.info(`  [FunctionCaller] 注册工具: ${name}`);
  }

  unregisterTool(name) {
    this.tools.delete(name);
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  getAvailableTools() {
    return Array.from(this.tools.entries()).map(([name, { schema }]) => schema);
  }
}

class ToolRegistration {
  constructor() {
    this.db = null;
    this.handler = null;
    this.functionCaller = null;
  }

  /**
   * 初始化
   */
  async initialize() {
    try {
      logger.info("[Tool Registration] 初始化...\n");

      // 1. 初始化数据库
      const dbPath =
        process.env.DB_PATH ||
        path.join(__dirname, "../../../../data/chainlesschain.db");
      logger.info(`[Tool Registration] 数据库路径: ${dbPath}`);

      this.db = new DatabaseManager(dbPath, {
        encryptionEnabled: false,
      });

      await this.db.initialize();
      logger.info("[Tool Registration] 数据库连接成功\n");

      // 2. 初始化Handler
      const workDir = path.join(__dirname, "../../../../data/workspace");
      this.handler = new AdditionalToolsV3Handler({ workDir });
      logger.info("[Tool Registration] Handler初始化成功\n");

      // 3. 初始化FunctionCaller (如果在Electron环境中运行，应该传入真实的FunctionCaller)
      this.functionCaller = new MockFunctionCaller();
      logger.info("[Tool Registration] FunctionCaller初始化成功\n");

      return true;
    } catch (error) {
      logger.error("[Tool Registration] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 注册单个工具
   */
  async registerTool(toolMeta) {
    try {
      const now = Date.now();

      // 1. 准备数据库记录
      const toolRecord = {
        id: toolMeta.id,
        name: toolMeta.name,
        display_name: toolMeta.display_name || toolMeta.name,
        description: toolMeta.description || "",
        tool_type: "function",
        category: toolMeta.category || "general",
        parameters_schema: "{}", // 简化处理，实际应定义详细schema
        return_schema: "{}",
        is_builtin: toolMeta.is_builtin || 1,
        plugin_id: null,
        handler_path: "skill-tool-system/additional-tools-v3-handler.js",
        enabled: toolMeta.enabled !== undefined ? toolMeta.enabled : 1,
        deprecated: 0,
        config: toolMeta.config || "{}",
        examples: "[]",
        doc_path: null,
        required_permissions: "[]",
        risk_level: 1,
        usage_count: 0,
        success_count: 0,
        avg_execution_time: 0,
        last_used_at: null,
        created_at: now,
        updated_at: now,
      };

      // 2. 检查是否已存在
      const existing = await this.db.get(
        "SELECT id FROM tools WHERE id = ? OR name = ?",
        [toolRecord.id, toolRecord.name],
      );

      if (existing) {
        logger.info(
          `  ⚠️  工具已存在，跳过: ${toolRecord.name} (${toolRecord.id})`,
        );
        return existing.id;
      }

      // 3. 保存到数据库
      const sql = `
        INSERT INTO tools (
          id, name, display_name, description, tool_type, category,
          parameters_schema, return_schema, is_builtin, plugin_id,
          handler_path, enabled, deprecated, config, examples,
          doc_path, required_permissions, risk_level, usage_count,
          success_count, avg_execution_time, last_used_at,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.db.run(sql, [
        toolRecord.id,
        toolRecord.name,
        toolRecord.display_name,
        toolRecord.description,
        toolRecord.tool_type,
        toolRecord.category,
        toolRecord.parameters_schema,
        toolRecord.return_schema,
        toolRecord.is_builtin,
        toolRecord.plugin_id,
        toolRecord.handler_path,
        toolRecord.enabled,
        toolRecord.deprecated,
        toolRecord.config,
        toolRecord.examples,
        toolRecord.doc_path,
        toolRecord.required_permissions,
        toolRecord.risk_level,
        toolRecord.usage_count,
        toolRecord.success_count,
        toolRecord.avg_execution_time,
        toolRecord.last_used_at,
        toolRecord.created_at,
        toolRecord.updated_at,
      ]);

      // 4. 注册handler到FunctionCaller
      const handlerMethodName = `tool_${toolRecord.name}`;
      const handlerMethod = this.handler[handlerMethodName];

      if (!handlerMethod) {
        logger.warn(`  ⚠️  Handler方法不存在: ${handlerMethodName}`);
      } else {
        const schema = {
          name: toolRecord.name,
          description: toolRecord.description,
          parameters: {},
        };

        // 绑定handler实例的上下文
        const boundHandler = handlerMethod.bind(this.handler);
        this.functionCaller.registerTool(toolRecord.name, boundHandler, schema);
      }

      logger.info(`  ✅ 工具注册成功: ${toolRecord.name} (${toolRecord.id})`);

      return toolRecord.id;
    } catch (error) {
      logger.error(`  ❌ 工具注册失败: ${toolMeta.name}`, error.message);
      throw error;
    }
  }

  /**
   * 注册所有工具
   */
  async registerAllTools() {
    try {
      logger.info("========================================");
      logger.info("  注册Additional Tools V3");
      logger.info("  共29个专业领域工具");
      logger.info("========================================\n");

      let registered = 0;
      let skipped = 0;
      let failed = 0;

      for (const tool of additionalToolsV3) {
        try {
          const toolId = await this.registerTool(tool);
          if (toolId === tool.id) {
            registered++;
          } else {
            skipped++;
          }
        } catch (error) {
          logger.error(`  ❌ 注册失败: ${tool.name}`, error.message);
          failed++;
        }
      }

      logger.info("\n========================================");
      logger.info("  注册完成汇总");
      logger.info("========================================");
      logger.info(
        `工具: 注册 ${registered} 个, 跳过 ${skipped} 个, 失败 ${failed} 个`,
      );
      logger.info(
        `FunctionCaller: 共 ${this.functionCaller.tools.size} 个工具可用`,
      );
      logger.info("========================================\n");

      return { registered, skipped, failed };
    } catch (error) {
      logger.error("[Tool Registration] 注册所有工具失败:", error);
      throw error;
    }
  }

  /**
   * 验证注册结果
   */
  async verify() {
    try {
      logger.info("[Tool Registration] ===== 验证注册结果 =====\n");

      // 验证数据库中的工具数量
      const toolCount = await this.db.get(
        'SELECT COUNT(*) as count FROM tools WHERE handler_path LIKE "%additional-tools-v3-handler%"',
      );
      logger.info(`[Tool Registration] 数据库中V3工具数量: ${toolCount.count}`);

      // 列出所有已注册的工具
      const tools = await this.db.all(
        'SELECT id, name, display_name, category FROM tools WHERE handler_path LIKE "%additional-tools-v3-handler%" ORDER BY category, name',
      );

      logger.info("\n[Tool Registration] 已注册工具列表:\n");

      const toolsByCategory = {};
      tools.forEach((tool) => {
        if (!toolsByCategory[tool.category]) {
          toolsByCategory[tool.category] = [];
        }
        toolsByCategory[tool.category].push(tool);
      });

      Object.entries(toolsByCategory).forEach(([category, categoryTools]) => {
        logger.info(`  ${category.toUpperCase()} (${categoryTools.length}个):`);
        categoryTools.forEach((tool) => {
          logger.info(`    - ${tool.name}: ${tool.display_name}`);
        });
        logger.info("");
      });

      // 验证Handler方法
      logger.info("[Tool Registration] 验证Handler方法:\n");
      let methodsFound = 0;
      let methodsMissing = 0;

      for (const tool of tools) {
        const methodName = `tool_${tool.name}`;
        if (typeof this.handler[methodName] === "function") {
          methodsFound++;
        } else {
          logger.warn(`  ⚠️  缺失Handler方法: ${methodName}`);
          methodsMissing++;
        }
      }

      logger.info(`  ✅ Handler方法存在: ${methodsFound}个`);
      if (methodsMissing > 0) {
        logger.info(`  ❌ Handler方法缺失: ${methodsMissing}个`);
      }

      return true;
    } catch (error) {
      logger.error("[Tool Registration] 验证失败:", error);
      return false;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close() {
    try {
      if (this.db && this.db.db) {
        await this.db.db.close();
        logger.info("\n[Tool Registration] 数据库连接已关闭");
      }
    } catch (error) {
      logger.error("[Tool Registration] 关闭数据库失败:", error);
    }
  }

  /**
   * 执行完整的注册流程
   */
  async run() {
    try {
      // 1. 初始化
      await this.initialize();

      // 2. 注册所有工具
      const result = await this.registerAllTools();

      // 3. 验证结果
      await this.verify();

      return result;
    } catch (error) {
      logger.error("\n[Tool Registration] 注册失败:", error);
      return { registered: 0, skipped: 0, failed: additionalToolsV3.length };
    } finally {
      await this.close();
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const registration = new ToolRegistration();
  registration
    .run()
    .then((result) => {
      const success = result.failed === 0;
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      logger.error("Fatal error:", error);
      process.exit(1);
    });
}

module.exports = ToolRegistration;
